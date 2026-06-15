import { pool } from "../db.js";
import { decryptJson, encryptJson } from "../services/encryption.js";

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
    gmailHistoryId: row.gmail_history_id
  };
}

export async function upsertGoogleUser({ email, name, googleId, gmailTokens }) {
  await pool.execute(
    `INSERT INTO users (email, name, google_id, gmail_tokens)
     VALUES (:email, :name, :googleId, :gmailTokens)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       google_id = VALUES(google_id),
       gmail_tokens = VALUES(gmail_tokens)`,
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
  await pool.execute("UPDATE users SET last_gmail_scan_at = :date WHERE id = :id", {
    id,
    date: date.toISOString().slice(0, 19).replace("T", " ")
  });
}

export async function updateUserGmailSyncState(id, { lastScanAt = new Date(), historyId } = {}) {
  await pool.execute(
    `UPDATE users
     SET last_gmail_scan_at = :lastScanAt,
         gmail_history_id = COALESCE(:historyId, gmail_history_id)
     WHERE id = :id`,
    {
      id,
      lastScanAt: lastScanAt.toISOString().slice(0, 19).replace("T", " "),
      historyId: historyId ? String(historyId) : null
    }
  );
}
