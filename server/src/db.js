import mysql from "mysql2/promise";
import { config } from "./config.js";

function mysqlConnectionOptions(includeDatabase = true) {
  return {
    ...(config.mysql.socketPath
      ? { socketPath: config.mysql.socketPath }
      : { host: config.mysql.host, port: config.mysql.port }),
    user: config.mysql.user,
    password: config.mysql.password,
    ...(includeDatabase ? { database: config.mysql.database } : {})
  };
}

export const pool = mysql.createPool({
  ...mysqlConnectionOptions(true),
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true
});

export async function initializeDatabase() {
  try {
    const bootstrap = await mysql.createConnection(mysqlConnectionOptions(false));
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.mysql.database}\`
       CHARACTER SET utf8mb4
       COLLATE utf8mb4_unicode_ci`
    );
    await bootstrap.end();
  } catch (error) {
    console.warn(
      `Skipping database creation for ${config.mysql.database}. Using existing hosted database.`
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255) NULL,
      google_id VARCHAR(255) NULL,
      gmail_tokens LONGTEXT NULL,
      last_gmail_scan_at DATETIME NULL,
      gmail_history_id VARCHAR(64) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY users_email_unique (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing("users", "last_gmail_scan_at", "DATETIME NULL");
  await addColumnIfMissing("users", "gmail_history_id", "VARCHAR(64) NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NOT NULL,
      merchant_name VARCHAR(255) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'PKR',
      cadence ENUM('weekly', 'monthly', 'quarterly', 'yearly', 'unknown') NOT NULL DEFAULT 'unknown',
      category VARCHAR(120) NOT NULL DEFAULT 'Uncategorized',
      next_billing_date DATETIME NULL,
      last_charged_at DATETIME NULL,
      confidence DECIMAL(4,3) NOT NULL DEFAULT 0,
      status ENUM('verified', 'needs_review', 'rejected') NOT NULL DEFAULT 'needs_review',
      payment_state ENUM('paid', 'failed') NOT NULL DEFAULT 'paid',
      evidence LONGTEXT NULL,
      source_email LONGTEXT NULL,
      fingerprint CHAR(64) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY subscriptions_user_fingerprint_unique (user_id, fingerprint),
      KEY subscriptions_user_date_index (user_id, next_billing_date),
      CONSTRAINT subscriptions_user_id_foreign
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await addColumnIfMissing(
    "subscriptions",
    "payment_state",
    "ENUM('paid', 'failed') NOT NULL DEFAULT 'paid'"
  );

  await pool.query(`
    UPDATE users
    JOIN (
      SELECT user_id, MAX(updated_at) AS last_scan_at
      FROM subscriptions
      GROUP BY user_id
    ) saved_scans ON saved_scans.user_id = users.id
    SET users.last_gmail_scan_at = saved_scans.last_scan_at
    WHERE users.last_gmail_scan_at IS NULL
  `);

  await pool.query("DELETE FROM subscriptions WHERE status <> 'verified'");

  console.log("MySQL connected and schema ready");
}

async function addColumnIfMissing(table, column, definition) {
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = :database
       AND TABLE_NAME = :table
       AND COLUMN_NAME = :column`,
    { database: config.mysql.database, table, column }
  );

  if (rows.length === 0) {
    await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}
