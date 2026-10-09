/**
 * Meta `signed_request` verification (deauthorize and data-deletion callbacks).
 *
 * Format (Meta for Developers, "Facebook Login → manual flow → signed request" and "Data Deletion Callback"):
 *   signed_request = base64url(HMAC-SHA256(payloadPart, appSecret)) + "." + payloadPart,  payloadPart = base64url(JSON)
 *   JSON payload = { "algorithm": "HMAC-SHA256", "issued_at": <unix seconds>, "user_id": "<app-scoped user id>" }
 * Fails closed: anything that is not a well-formed, correctly signed, HMAC-SHA256 payload from the last MAX_AGE seconds with a user id is rejected.
 * The signature is compared in constant time over the exact payload text received (never over re-serialised JSON).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type SignedRequestFailure = "missing" | "malformed" | "unsupported_algorithm" | "bad_signature" | "expired" | "no_user" | "not_configured";
export class SignedRequestError extends Error {
  constructor(public readonly reason: SignedRequestFailure) {
    super(`Invalid signed_request: ${reason}`);
    this.name = "SignedRequestError";
  }
}

export interface SignedRequestPayload { algorithm: string; user_id: string; issued_at?: number; [k: string]: unknown }

/** Callbacks older than this are rejected (replay protection). Generous on purpose: Meta may retry after our own downtime. */
export const SIGNED_REQUEST_MAX_AGE_SECONDS = 3 * 24 * 3600;
const FUTURE_SKEW_SECONDS = 300;

const b64urlToBuf = (s: string): Buffer => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export function parseSignedRequest(raw: unknown, appSecret: string, now: Date = new Date(), maxAgeSeconds = SIGNED_REQUEST_MAX_AGE_SECONDS): SignedRequestPayload {
  if (!appSecret) throw new SignedRequestError("not_configured");
  if (typeof raw !== "string" || raw.length === 0) throw new SignedRequestError("missing");
  if (raw.length > 4096) throw new SignedRequestError("malformed");
  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !B64URL.test(parts[0]) || !B64URL.test(parts[1])) throw new SignedRequestError("malformed");
  const [sigPart, payloadPart] = parts as [string, string];

  let payload: SignedRequestPayload;
  try {
    const parsed = JSON.parse(b64urlToBuf(payloadPart).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    payload = parsed as SignedRequestPayload;
  } catch {
    throw new SignedRequestError("malformed");
  }
  if (typeof payload.algorithm !== "string" || payload.algorithm.toUpperCase() !== "HMAC-SHA256") throw new SignedRequestError("unsupported_algorithm");

  const expected = createHmac("sha256", appSecret).update(payloadPart).digest();
  const given = b64urlToBuf(sigPart);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new SignedRequestError("bad_signature");

  // Signature is valid from here on; now judge freshness and content.
  if (typeof payload.issued_at === "number") {
    const age = Math.floor(now.getTime() / 1000) - payload.issued_at;
    if (age > maxAgeSeconds || age < -FUTURE_SKEW_SECONDS) throw new SignedRequestError("expired");
  }
  if (typeof payload.user_id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(payload.user_id)) throw new SignedRequestError("no_user");
  return payload;
}

/** Test helper / fixture builder: produces exactly what Meta sends for the given payload. */
export function signForTest(payload: Record<string, unknown>, appSecret: string): string {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", appSecret).update(payloadPart).digest().toString("base64url");
  return `${sig}.${payloadPart}`;
}
