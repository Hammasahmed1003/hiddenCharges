import { pool } from "../db.js";

function toMysqlDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapSubscription(row) {
  return {
    _id: String(row.id),
    id: row.id,
    userId: row.user_id,
    merchantName: row.merchant_name,
    amount: Number(row.amount),
    currency: row.currency,
    cadence: row.cadence,
    category: row.category,
    nextBillingDate: row.next_billing_date,
    lastChargedAt: row.last_charged_at,
    confidence: Number(row.confidence),
    status: row.status,
    paymentState: row.payment_state || "paid",
    memoryNote: row.memory_note || "",
    evidence: parseJson(row.evidence, []),
    sourceEmail: parseJson(row.source_email, {}),
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listSubscriptionsByUser(userId) {
  const [rows] = await pool.execute(
    `SELECT *
     FROM subscriptions
     WHERE user_id = :userId
       AND status = 'verified'
     ORDER BY next_billing_date IS NULL, next_billing_date ASC, updated_at DESC`,
    { userId }
  );

  return rows.map(mapSubscription);
}

export async function listReportSubscriptions({ userIds, startDate, endDate }) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];

  const placeholders = userIds.map(() => "?").join(", ");
  const [rows] = await pool.execute(
    `SELECT subscriptions.*, users.email AS account_email, users.name AS account_name
     FROM subscriptions
     JOIN users ON users.id = subscriptions.user_id
     WHERE subscriptions.user_id IN (${placeholders})
       AND subscriptions.status = 'verified'
       AND subscriptions.last_charged_at >= ?
       AND subscriptions.last_charged_at <= ?
     ORDER BY subscriptions.last_charged_at ASC, subscriptions.id ASC`,
    [...userIds, toMysqlDate(startDate), toMysqlDate(endDate)]
  );

  return rows.map((row) => ({
    ...mapSubscription(row),
    accountEmail: row.account_email,
    accountName: row.account_name
  }));
}

export async function upsertSubscription(userId, item) {
  if (item.status !== "verified") return null;

  await pool.execute(
    `INSERT INTO subscriptions (
       user_id, merchant_name, amount, currency, cadence, category,
       next_billing_date, last_charged_at, confidence, status, payment_state, evidence,
       source_email, fingerprint, created_at, updated_at
     )
     VALUES (
       :userId, :merchantName, :amount, :currency, :cadence, :category,
       :nextBillingDate, :lastChargedAt, :confidence, :status, :paymentState, :evidence,
       :sourceEmail, :fingerprint, NOW(), NOW()
     )
     ON DUPLICATE KEY UPDATE
       merchant_name = VALUES(merchant_name),
       amount = VALUES(amount),
       currency = VALUES(currency),
       cadence = VALUES(cadence),
       category = VALUES(category),
       next_billing_date = VALUES(next_billing_date),
       last_charged_at = VALUES(last_charged_at),
       confidence = VALUES(confidence),
       status = VALUES(status),
       payment_state = VALUES(payment_state),
       evidence = VALUES(evidence),
       source_email = VALUES(source_email),
       updated_at = NOW()`,
    {
      userId,
      merchantName: item.merchantName,
      amount: item.amount,
      currency: item.currency || "PKR",
      cadence: item.cadence || "unknown",
      category: item.category || "Uncategorized",
      nextBillingDate: toMysqlDate(item.nextBillingDate),
      lastChargedAt: toMysqlDate(item.lastChargedAt),
      confidence: item.confidence || 0,
      status: item.status || "needs_review",
      paymentState: item.paymentState || "paid",
      evidence: JSON.stringify(item.evidence || []),
      sourceEmail: JSON.stringify(item.sourceEmail || {}),
      fingerprint: item.fingerprint
    }
  );

  const [rows] = await pool.execute(
    `SELECT *
     FROM subscriptions
     WHERE user_id = :userId AND fingerprint = :fingerprint
     LIMIT 1`,
    { userId, fingerprint: item.fingerprint }
  );

  return rows[0] ? mapSubscription(rows[0]) : null;
}

export async function verifySubscription(userId, id) {
  await pool.execute(
    `UPDATE subscriptions
     SET status = 'verified', confidence = 1
     WHERE id = :id AND user_id = :userId`,
    { id, userId }
  );

  const [rows] = await pool.execute(
    "SELECT * FROM subscriptions WHERE id = :id AND user_id = :userId LIMIT 1",
    { id, userId }
  );

  return rows[0] ? mapSubscription(rows[0]) : null;
}

export async function updateSubscriptionMemoryNote(userId, id, note) {
  await pool.execute(
    `UPDATE subscriptions
     SET memory_note = :note,
         updated_at = NOW()
     WHERE id = :id
       AND user_id = :userId
       AND status = 'verified'`,
    { id, userId, note: note || null }
  );

  const [rows] = await pool.execute(
    "SELECT * FROM subscriptions WHERE id = :id AND user_id = :userId LIMIT 1",
    { id, userId }
  );

  return rows[0] ? mapSubscription(rows[0]) : null;
}
