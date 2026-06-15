import crypto from "node:crypto";
import { config } from "../config.js";

const ALGORITHM = "aes-256-gcm";
const VERSION = 1;

function keyBuffer() {
  return crypto.createHash("sha256").update(String(config.security.encryptionKey)).digest();
}

export function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer(), iv);
  const plaintext = Buffer.from(JSON.stringify(value || {}), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    __encrypted: true,
    version: VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64")
  };
}

export function decryptJson(value, fallback = null) {
  if (!value?.__encrypted) return value ?? fallback;

  try {
    const decipher = crypto.createDecipheriv(
      value.algorithm || ALGORITHM,
      keyBuffer(),
      Buffer.from(value.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString("utf8"));
  } catch {
    return fallback;
  }
}
