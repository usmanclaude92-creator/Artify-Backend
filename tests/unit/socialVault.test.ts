import { afterEach, describe, expect, it, vi } from "vitest";

// The real config is frozen; give this suite a mutable copy so key rings / flags can be varied.
vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config } };
});
import { config } from "../../server/config/env";
import { activeKeyVersion, redactSecrets, tokenVault } from "../../server/services/social/tokenVault";

const mutable = config as unknown as { socialVaultKeys: string; socialVaultActiveKeyVersion: number | undefined };
const K1 = "k".repeat(40);
const K2 = "z".repeat(40);
const tokens = { accessToken: "EAAB-secret-access-token-123456", refreshToken: "rt-secret-refresh-token-987654", expiresAt: "2030-01-01T00:00:00.000Z" };

afterEach(() => {
  mutable.socialVaultKeys = "";
  mutable.socialVaultActiveKeyVersion = undefined;
});

describe("tokenVault", () => {
  it("round-trips a token set and never stores plaintext", () => {
    const { ciphertext, keyVersion } = tokenVault.encrypt(tokens, "acct-1");
    expect(ciphertext.startsWith("sv1.")).toBe(true);
    expect(ciphertext).not.toContain("secret-access");
    expect(keyVersion).toBe(1);
    expect(tokenVault.decrypt(ciphertext, keyVersion, "acct-1")).toEqual(tokens);
  });

  it("uses a fresh IV each time", () => {
    expect(tokenVault.encrypt(tokens, "a").ciphertext).not.toBe(tokenVault.encrypt(tokens, "a").ciphertext);
  });

  it("binds ciphertext to the account id and detects tampering", () => {
    const { ciphertext, keyVersion } = tokenVault.encrypt(tokens, "acct-1");
    expect(() => tokenVault.decrypt(ciphertext, keyVersion, "acct-2")).toThrow(/could not be decrypted/);
    const parts = ciphertext.split(".");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("AA") ? "BB" : "AA");
    expect(() => tokenVault.decrypt(parts.join("."), keyVersion, "acct-1")).toThrow(/could not be decrypted/);
    expect(() => tokenVault.decrypt("garbage", 1, "acct-1")).toThrow();
  });

  it("supports key rotation: old versions still decrypt, new writes use the active version, rotate() re-encrypts", () => {
    mutable.socialVaultKeys = `1:${K1}`;
    const old = tokenVault.encrypt(tokens, "acct-1");
    expect(old.keyVersion).toBe(1);

    mutable.socialVaultKeys = `1:${K1},2:${K2}`;
    expect(activeKeyVersion()).toBe(2); // highest by default
    expect(tokenVault.decrypt(old.ciphertext, 1, "acct-1")).toEqual(tokens);
    expect(tokenVault.needsRotation(1)).toBe(true);
    const rotated = tokenVault.rotate(old.ciphertext, 1, "acct-1");
    expect(rotated.keyVersion).toBe(2);
    expect(tokenVault.decrypt(rotated.ciphertext, 2, "acct-1")).toEqual(tokens);

    // pinning the active version
    mutable.socialVaultActiveKeyVersion = 1;
    expect(tokenVault.encrypt(tokens, "x").keyVersion).toBe(1);
    mutable.socialVaultActiveKeyVersion = 9;
    expect(() => tokenVault.encrypt(tokens, "x")).toThrow(/ACTIVE_KEY_VERSION/);
  });

  it("cannot decrypt after the key it used is removed, and rejects malformed rings", () => {
    mutable.socialVaultKeys = `3:${K1}`;
    const { ciphertext } = tokenVault.encrypt(tokens, "a");
    mutable.socialVaultKeys = `4:${K2}`;
    expect(() => tokenVault.decrypt(ciphertext, 3, "a")).toThrow(/not available/);
    mutable.socialVaultKeys = "1:short";
    expect(() => tokenVault.encrypt(tokens, "a")).toThrow(/SOCIAL_VAULT_KEYS/);
  });
});

describe("redactSecrets", () => {
  it("removes bearer tokens, token fields, codes and explicitly known secrets", () => {
    const text = redactSecrets(new Error(`Request failed: Authorization: Bearer abcdef1234567890 access_token=ZZZZZZZZZZ1234 code=AUTHCODE12345 and ${tokens.refreshToken}`), [tokens.refreshToken]);
    expect(text).not.toContain("abcdef1234567890");
    expect(text).not.toContain("ZZZZZZZZZZ1234");
    expect(text).not.toContain("AUTHCODE12345");
    expect(text).not.toContain(tokens.refreshToken);
    expect(text).toContain("[redacted]");
  });

  it("handles objects and leaves harmless text alone", () => {
    expect(redactSecrets({ message: "rate limited" })).toContain("rate limited");
    expect(redactSecrets("nothing secret here")).toBe("nothing secret here");
  });
});
