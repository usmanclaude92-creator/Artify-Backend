/** Step 15: signed_request verification against hand-built fixtures (signatures made with openssl, not with the application code). */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseSignedRequest, signForTest, SignedRequestError } from "../../server/services/meta/signedRequest";

const fx = JSON.parse(readFileSync(new URL("../fixtures/meta/signed_requests.json", import.meta.url), "utf8"));
const now = new Date(fx.validAt * 1000);
const reason = (raw: unknown, secret = fx.appSecret, at = now) => { try { parseSignedRequest(raw, secret, at); return "ok"; } catch (e) { return (e as SignedRequestError).reason; } };

describe("parseSignedRequest", () => {
  it("accepts the documented format and returns the payload", () => {
    const p = parseSignedRequest(fx.valid.signed_request, fx.appSecret, now);
    expect(p.user_id).toBe(fx.valid.user_id);
    expect(p.algorithm).toBe("HMAC-SHA256");
  });
  it("produces byte-identical output to the openssl fixture", () => {
    expect(signForTest({ algorithm: "HMAC-SHA256", issued_at: 1791540000, user_id: "1234567890123456" }, fx.appSecret)).toBe(fx.valid.signed_request);
  });
  it("rejects a tampered payload", () => expect(reason(fx.tamperedPayload.signed_request)).toBe("bad_signature"));
  it("rejects a signature made with another secret", () => expect(reason(fx.wrongSecret.signed_request)).toBe("bad_signature"));
  it("rejects when the app secret is different or not configured", () => {
    expect(reason(fx.valid.signed_request, "something-else")).toBe("bad_signature");
    expect(reason(fx.valid.signed_request, "")).toBe("not_configured");
  });
  it("rejects an expired request, and one issued in the future", () => {
    expect(reason(fx.expired.signed_request)).toBe("expired");
    expect(reason(fx.valid.signed_request, fx.appSecret, new Date((fx.validAt - 3600) * 1000))).toBe("expired");
    expect(reason(fx.valid.signed_request, fx.appSecret, new Date((fx.validAt + 4 * 24 * 3600) * 1000))).toBe("expired");
  });
  it("rejects a non-HMAC-SHA256 algorithm even with a valid-looking structure", () => expect(reason(fx.wrongAlgorithm.signed_request)).toBe("unsupported_algorithm"));
  it("rejects a valid signature with no user id", () => expect(reason(fx.noUser.signed_request)).toBe("no_user"));
  it("rejects missing, empty, malformed and oversized input", () => {
    for (const raw of [undefined, null, "", 42, {}]) expect(reason(raw)).toBe("missing");
    for (const raw of ["abc", "a.b.c", ".", "a.", ".b", "sig$.payload!", "x".repeat(5000), fx.notJson.signed_request]) expect(reason(raw)).toBe("malformed");
  });
});
