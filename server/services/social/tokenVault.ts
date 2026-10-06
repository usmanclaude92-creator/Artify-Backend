/**
 * Social token vault. Encrypts the credential blob (access/refresh tokens) at rest with AES-256-GCM:
 *  - Versioned key ring from SOCIAL_VAULT_KEYS ("1:<secret>,2:<secret>"); new data uses the active version, old
 *    versions stay decryptable so keys can be rotated without downtime (`rotate()` re-encrypts).
 *  - With no ring configured, key version 1 is HKDF-derived from INTEGRATIONS_ENCRYPTION_KEY / SESSION_SECRET using
 *    a social-specific label — never the same key as the integrations secret box.
 *  - The account id is bound as AAD, so a ciphertext copied onto another account fails to decrypt.
 * Stored format: `sv1.<iv>.<tag>.<ciphertext>` (base64url); the key version lives in its own column.
 * Plaintext is never logged; use `redactSecrets` for anything that might reach a log, error or audit entry.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { config } from "../../config/env";

const FORMAT = "sv1";

export interface SocialTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string | null;
  scopes?: string[];
  [extra: string]: unknown;
}

function keyRing(): Map<number, Buffer> {
  const ring = new Map<number, Buffer>();
  for (const entry of config.socialVaultKeys.split(",").map((e) => e.trim()).filter(Boolean)) {
    const sep = entry.indexOf(":");
    const version = Number(entry.slice(0, sep));
    const secret = entry.slice(sep + 1);
    if (!Number.isInteger(version) || version < 1 || secret.length < 32) {
      throw new Error("SOCIAL_VAULT_KEYS must look like '1:<secret>,2:<secret>' with secrets of at least 32 characters.");
    }
    ring.set(version, Buffer.from(hkdfSync("sha256", secret, "artify-social-vault-salt", `artify/social/token-vault/v${version}`, 32)));
  }
  if (ring.size === 0) {
    const ikm = config.integrationsEncryptionKey || config.sessionSecret;
    ring.set(1, Buffer.from(hkdfSync("sha256", ikm, "artify-social-vault-salt", "artify/social/token-vault/derived", 32)));
  }
  return ring;
}

export function activeKeyVersion(): number {
  const ring = keyRing();
  const wanted = config.socialVaultActiveKeyVersion ?? Math.max(...ring.keys());
  if (!ring.has(wanted)) throw new Error(`SOCIAL_VAULT_ACTIVE_KEY_VERSION ${wanted} is not in SOCIAL_VAULT_KEYS.`);
  return wanted;
}

export const tokenVault = {
  encrypt(tokens: SocialTokenSet, accountId: string): { ciphertext: string; keyVersion: number } {
    const keyVersion = activeKeyVersion();
    const key = keyRing().get(keyVersion)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(accountId));
    const ct = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
    const ciphertext = [FORMAT, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    return { ciphertext, keyVersion };
  },

  decrypt(ciphertext: string, keyVersion: number, accountId: string): SocialTokenSet {
    const key = keyRing().get(keyVersion);
    if (!key) throw new Error(`Social vault key version ${keyVersion} is not available.`);
    const [format, iv, tag, ct] = ciphertext.split(".");
    if (format !== FORMAT || !iv || !tag || !ct) throw new Error("Unsupported credential format.");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(accountId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    // Deliberately a generic message: never echo anything derived from the payload.
    try {
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8")) as SocialTokenSet;
    } catch {
      throw new Error("Stored credentials could not be decrypted.");
    }
  },

  /** True when a record is encrypted with a key version other than the active one. */
  needsRotation(keyVersion: number): boolean {
    return keyVersion !== activeKeyVersion();
  },

  /** Re-encrypts a record under the active key version. */
  rotate(ciphertext: string, keyVersion: number, accountId: string): { ciphertext: string; keyVersion: number } {
    return this.encrypt(this.decrypt(ciphertext, keyVersion, accountId), accountId);
  },
};

const PATTERNS: RegExp[] = [
  /(bearer\s+)[a-z0-9._~+/=-]{8,}/gi,
  /((?:access|refresh|id)_?token["'\s:=]+)[a-z0-9._~+/=-]{8,}/gi,
  /((?:client_)?secret["'\s:=]+)[a-z0-9._~+/=-]{8,}/gi,
  /(code=)[a-z0-9._~+/=-]{8,}/gi,
];

/** Removes token-looking material (and any explicitly supplied secrets) from text bound for logs, errors or storage. */
export function redactSecrets(input: unknown, knownSecrets: Array<string | undefined> = []): string {
  let text = input instanceof Error ? input.message : typeof input === "string" ? input : JSON.stringify(input) ?? "";
  for (const secret of knownSecrets) if (secret && secret.length >= 6) text = text.split(secret).join("[redacted]");
  for (const pattern of PATTERNS) text = text.replace(pattern, "$1[redacted]");
  return text;
}
