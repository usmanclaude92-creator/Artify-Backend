/** Error taxonomy for publishing. The connector classifies; the publisher decides what to do with the class. */
export type PublishErrorKind =
  /** Safe to retry: nothing was sent, or the network clearly rejected it as temporary (429 / 5xx / connection refused). */
  | "transient"
  /** Will never succeed as-is (validation, policy, content rejected). Fail immediately. */
  | "permanent"
  /** Credentials rejected (401 / revoked / expired). Account goes to NEEDS_REAUTH. */
  | "auth"
  /** The request may or may not have been accepted (timeout / connection dropped AFTER sending). Never retried blindly. */
  | "uncertain";

export class SocialPublishError extends Error {
  readonly kind: PublishErrorKind;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;
  constructor(kind: PublishErrorKind, message: string, opts: { httpStatus?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "SocialPublishError";
    this.kind = kind;
    this.httpStatus = opts.httpStatus;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

/** Maps an HTTP status from a network API (response definitely received) to an error kind. */
export function classifyHttpStatus(status: number): PublishErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "auth"; // revoked scope / member restricted — user must reconnect or fix permissions
  if (status === 408 || status === 429) return "transient";
  if (status >= 500) return "transient";
  return "permanent";
}
