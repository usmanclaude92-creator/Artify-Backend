/**
 * Reversible encryption for secrets that must be recovered to be used
 * (third-party integration credentials, outbound-webhook signing secrets).
 * Secrets that are only ever *verified* (API keys, session tokens) are not
 * stored here — they are hashed (server/utils/crypto.ts hashToken).
 *
 * AES-256-GCM with a random 96-bit IV per value; the auth tag makes any
 * tampering fail loudly on decrypt. The 256-bit key is HKDF-derived from
 * INTEGRATIONS_ENCRYPTION_KEY when set, otherwise from SESSION_SECRET, with a
 * purpose label so the derived key is never reused for anything else.
 *
 * Stored format: `v1.<iv b64url>.<tag b64url>.<ciphertext b64url>` — the
 * version prefix leaves room for key rotation without a data migration.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { config } from "../config/env";

const VERSION = "v1";
const INFO = "artify/integrations/secret-box/v1";

function key(): Buffer {
  const ikm = config.integrationsEncryptionKey || config.sessionSecret;
  return Buffer.from(hkdfSync("sha256", ikm, "artify-secret-box-salt", INFO, 32));
}

export function encryptionKeySource(): "dedicated" | "derived-from-session-secret" {
  return config.integrationsEncryptionKey ? "dedicated" : "derived-from-session-secret";
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ct) throw new Error("Unsupported secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Last four characters only — the sole fragment of a secret any API ever returns. */
export function last4(secret: string): string {
  return secret.slice(-4);
}
