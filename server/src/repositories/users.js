import { pool } from "../db.js";
import { decryptJson, encryptJson } from "../services/encryption.js";
import { publicPlan } from "../services/plans.js";

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapUser(row) {
  if (!row) return null;
  const storedTokens = parseJson(row.gmail_tokens, {});
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    googleId: row.google_id,
    gmailTokens: decryptJson(storedTokens, {}),
    lastGmailScanAt: row.last_gmail_scan_at,
    gmailHistoryId: row.gmail_history_id,
    plan: row.plan || "free",
    planStatus: row.plan_status || "free",
    lemonCustomerId: row.lemon_customer_id,
    lemonSubscriptionId: row.lemon_subscription_id,
    lemonVariantId: row.lemon_variant_id,
    currentPeriodEndsAt: row.current_period_ends_at
  };
}

function mapAccount(row, activeUserId) {
  const user = mapUser(row);
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: row.role || "member",
    isPrimary: Boolean(row.is_primary),
    isActive: String(user.id) === String(activeUserId),
    gmailConnected: Boolean(user.gmailTokens?.access_token || user.gmailTokens?.refresh_token)
  };
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    gmailConnected: Boolean(user.gmailTokens?.access_token || user.gmailTokens?.refresh_token),
    plan: publicPlan({
      plan: user.plan,
      status: user.planStatus,
      currentPeriodEndsAt: user.currentPeriodEndsAt
    })
  };
}

export async function upsertGoogleUser({ email, name, googleId, gmailTokens }) {
  await pool.execute(
    `INSERT INTO users (email, name, google_id, gmail_tokens, created_at, updated_at)
     VALUES (:email, :name, :googleId, :gmailTokens, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       google_id = VALUES(google_id),
       gmail_tokens = VALUES(gmail_tokens),
       updated_at = NOW()`,
    {
      email,
      name: name || null,
      googleId: googleId || null,
      gmailTokens: JSON.stringify(encryptJson(gmailTokens || {}))
    }
  );

  return findUserByEmail(email);
}

export async function findUserByEmail(email) {
  const [rows] = await pool.execute("SELECT * FROM users WHERE email = :email LIMIT 1", { email });
  return mapUser(rows[0]);
}

export async function findUserById(id) {
  const [rows] = await pool.execute("SELECT * FROM users WHERE id = :id LIMIT 1", { id });
  return mapUser(rows[0]);
}

export async function ensureOwnerMembership(userId) {
  await pool.execute(
    `INSERT INTO account_memberships
       (owner_user_id, member_user_id, role, is_primary, created_at, updated_at)
     VALUES (:userId, :userId, 'owner', 1, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       owner_user_id = VALUES(owner_user_id),
       role = 'owner',
       is_primary = 1,
       updated_at = NOW()`,
    { userId }
  );
}

export async function linkUserToOwner(ownerUserId, memberUserId) {
  await ensureOwnerMembership(ownerUserId);

  if (String(ownerUserId) === String(memberUserId)) {
    return;
  }

  await pool.execute(
    `INSERT INTO account_memberships
       (owner_user_id, member_user_id, role, is_primary, created_at, updated_at)
     VALUES (:ownerUserId, :memberUserId, 'member', 0, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       owner_user_id = VALUES(owner_user_id),
       role = 'member',
       is_primary = 0,
       updated_at = NOW()`,
    { ownerUserId, memberUserId }
  );
}

export async function findOwnerIdForMember(memberUserId) {
  const [rows] = await pool.execute(
    "SELECT owner_user_id FROM account_memberships WHERE member_user_id = :memberUserId LIMIT 1",
    { memberUserId }
  );
  return rows[0]?.owner_user_id || null;
}

export async function listAccountsForOwner(ownerUserId, activeUserId = ownerUserId) {
  const [rows] = await pool.execute(
    `SELECT users.*, account_memberships.role, account_memberships.is_primary
     FROM account_memberships
     JOIN users ON users.id = account_memberships.member_user_id
     WHERE account_memberships.owner_user_id = :ownerUserId
     ORDER BY account_memberships.is_primary DESC, users.created_at ASC, users.email ASC`,
    { ownerUserId }
  );

  return rows.map((row) => mapAccount(row, activeUserId)).filter(Boolean);
}

export async function accountBelongsToOwner(ownerUserId, memberUserId) {
  const [rows] = await pool.execute(
    `SELECT member_user_id
     FROM account_memberships
     WHERE owner_user_id = :ownerUserId
       AND member_user_id = :memberUserId
     LIMIT 1`,
    { ownerUserId, memberUserId }
  );
  return rows.length > 0;
}

export async function updateOwnerPlan(
  ownerUserId,
  { plan, status, lemonCustomerId, lemonSubscriptionId, lemonVariantId, currentPeriodEndsAt }
) {
  await pool.execute(
    `UPDATE users
     SET plan = :plan,
         plan_status = :status,
         lemon_customer_id = COALESCE(:lemonCustomerId, lemon_customer_id),
         lemon_subscription_id = COALESCE(:lemonSubscriptionId, lemon_subscription_id),
         lemon_variant_id = COALESCE(:lemonVariantId, lemon_variant_id),
         current_period_ends_at = :currentPeriodEndsAt,
         updated_at = NOW()
     WHERE id = :ownerUserId`,
    {
      ownerUserId,
      plan,
      status,
      lemonCustomerId: lemonCustomerId || null,
      lemonSubscriptionId: lemonSubscriptionId || null,
      lemonVariantId: lemonVariantId || null,
      currentPeriodEndsAt: currentPeriodEndsAt || null
    }
  );
}

export async function findOwnerByLemonSubscriptionId(subscriptionId) {
  const [rows] = await pool.execute(
    "SELECT * FROM users WHERE lemon_subscription_id = :subscriptionId LIMIT 1",
    { subscriptionId }
  );
  return mapUser(rows[0]);
}

export async function findOwnerByEmail(email) {
  return findUserByEmail(email);
}

export async function clearUserGoogleTokens(id) {
  await pool.execute(
    "UPDATE users SET gmail_tokens = NULL, last_gmail_scan_at = NULL, gmail_history_id = NULL WHERE id = :id",
    { id }
  );
}

export async function deleteUserAccountData(id) {
  await pool.execute("DELETE FROM users WHERE id = :id", { id });
}

export async function updateUserLastGmailScanAt(id, date = new Date()) {
  await pool.execute("UPDATE users SET last_gmail_scan_at = :date, updated_at = NOW() WHERE id = :id", {
    id,
    date: date.toISOString().slice(0, 19).replace("T", " ")
  });
}

export async function updateUserGmailSyncState(id, { lastScanAt = new Date(), historyId } = {}) {
  await pool.execute(
    `UPDATE users
     SET last_gmail_scan_at = :lastScanAt,
         gmail_history_id = COALESCE(:historyId, gmail_history_id),
         updated_at = NOW()
     WHERE id = :id`,
    {
      id,
      lastScanAt: lastScanAt.toISOString().slice(0, 19).replace("T", " "),
      historyId: historyId ? String(historyId) : null
    }
  );
}
