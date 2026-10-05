/** Phase 17 — credential encryption and SSRF guard primitives. */
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, last4 } from "../../server/utils/secretBox";
import { assertSafeOutboundUrl } from "../../server/utils/outboundUrl";

describe("secretBox (AES-256-GCM)", () => {
  it("round-trips, never contains the plaintext, and uses a fresh IV each time", () => {
    const secret = "sk_live_abcdef1234567890";
    const a = encryptSecret(secret);
    const b = encryptSecret(secret);
    expect(decryptSecret(a)).toBe(secret);
    expect(a).not.toBe(b);
    expect(a).not.toContain(secret);
    expect(a.startsWith("v1.")).toBe(true);
  });

  it("detects tampering and malformed input instead of returning garbage", () => {
    const parts = encryptSecret("hello world").split(".");
    const flipped = [parts[0], parts[1], parts[2], Buffer.from("tampered!").toString("base64url")].join(".");
    expect(() => decryptSecret(flipped)).toThrow();
    expect(() => decryptSecret("v1.only.three")).toThrow();
    expect(() => decryptSecret("v2.a.b.c")).toThrow();
  });

  it("last4 returns only the final four characters", () => {
    expect(last4("whsec_0123456789abcdef")).toBe("cdef");
  });
});

describe("assertSafeOutboundUrl", () => {
  const blocked = [
    "http://169.254.169.254/latest/meta-data",
    "http://10.1.2.3/x",
    "http://172.16.0.1/x",
    "http://192.168.1.1/x",
    "http://100.64.0.1/x",
    "http://0.0.0.0/x",
    "http://[::ffff:10.0.0.1]/x",
    "http://[fd00::1]/x",
    "http://[fe80::1]/x",
  ];
  it.each(blocked)("rejects %s", async (url) => {
    await expect(assertSafeOutboundUrl(url)).rejects.toThrow();
  });

  it("rejects non-http(s) schemes, embedded credentials and unparseable URLs", async () => {
    await expect(assertSafeOutboundUrl("ftp://example.com/x")).rejects.toThrow();
    await expect(assertSafeOutboundUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertSafeOutboundUrl("http://user:pass@127.0.0.1/x")).rejects.toThrow();
    await expect(assertSafeOutboundUrl("not a url")).rejects.toThrow();
  });

  it("accepts a public address literal", async () => {
    await expect(assertSafeOutboundUrl("https://93.184.216.34/hook")).resolves.toBeInstanceOf(URL);
  });
});
