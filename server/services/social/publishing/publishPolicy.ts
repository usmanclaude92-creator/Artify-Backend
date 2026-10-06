/** Pure publishing policy: target state machine, backoff, grace window, due selection, post-status derivation. No I/O. */
import type { SocialPostStatus, SocialPostTargetStatus } from "@prisma/client";

export const TARGET_TRANSITIONS: Record<SocialPostTargetStatus, readonly SocialPostTargetStatus[]> = {
  PENDING: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["PENDING", "PUBLISHING", "MISSED", "CANCELLED"],
  PUBLISHING: ["PUBLISHED", "SCHEDULED", "FAILED", "UNCERTAIN"], // SCHEDULED = scheduled retry after a transient failure
  PUBLISHED: [],
  FAILED: ["SCHEDULED", "CANCELLED"], // operator "retry now" / "reschedule"
  UNCERTAIN: ["PUBLISHED", "SCHEDULED", "CANCELLED"], // manual resolution only
  MISSED: ["SCHEDULED", "CANCELLED"],
  CANCELLED: ["PENDING"],
};

export const canTargetTransition = (from: SocialPostTargetStatus, to: SocialPostTargetStatus) => TARGET_TRANSITIONS[from].includes(to);

export const DEFAULT_GRACE_MINUTES = 60;
export const DEFAULT_MAX_ATTEMPTS = 5;
export const STALE_PUBLISHING_MS = 10 * 60 * 1000;

export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  jitter?: number;
  /** Injectable for deterministic tests; returns [0,1). */
  random?: () => number;
}

/** Exponential backoff with ±jitter. `attempt` is the number of attempts already made (>=1). Honours a server Retry-After. */
export function computeBackoffMs(attempt: number, retryAfterMs?: number, opts: BackoffOptions = {}): number {
  const { baseMs = 2 * 60_000, capMs = 60 * 60_000, jitter = 0.2, random = Math.random } = opts;
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  const factor = 1 + (random() * 2 - 1) * jitter;
  const delay = Math.min(capMs, Math.round(exp * factor));
  return Math.max(delay, Math.min(retryAfterMs ?? 0, capMs));
}

/** A target is MISSED when it was never attempted and its time is older than the grace window. */
export function isMissed(scheduledAt: Date, attempts: number, now: Date, graceMinutes: number): boolean {
  return attempts === 0 && now.getTime() - scheduledAt.getTime() > graceMinutes * 60_000;
}

/** Due = scheduled time reached (compared as absolute instants, so timezone-independent) and no backoff pending. */
export function isDue(t: { scheduledAt: Date | null; nextAttemptAt: Date | null }, now: Date): boolean {
  if (!t.scheduledAt || t.scheduledAt.getTime() > now.getTime()) return false;
  return !t.nextAttemptAt || t.nextAttemptAt.getTime() <= now.getTime();
}

/** What to do with a failed attempt. `attempts` already includes the one that just failed. */
export type FailureDecision = { action: "retry"; delayMs: number } | { action: "fail"; reason: "permanent" | "max_attempts" } | { action: "reauth" } | { action: "uncertain" };

export function decideFailure(kind: "transient" | "permanent" | "auth" | "uncertain", attempts: number, maxAttempts: number, retryAfterMs?: number, opts?: BackoffOptions): FailureDecision {
  if (kind === "auth") return { action: "reauth" };
  if (kind === "uncertain") return { action: "uncertain" };
  if (kind === "permanent") return { action: "fail", reason: "permanent" };
  if (attempts >= maxAttempts) return { action: "fail", reason: "max_attempts" };
  return { action: "retry", delayMs: computeBackoffMs(attempts, retryAfterMs, opts) };
}

/** Post status is derived from its targets once publishing has started. Returns null when nothing should change. */
export function derivePostStatus(current: SocialPostStatus, targets: ReadonlyArray<{ status: SocialPostTargetStatus }>): SocialPostStatus | null {
  const active = targets.filter((t) => t.status !== "CANCELLED");
  if (active.length === 0) return null;
  const has = (s: SocialPostTargetStatus) => active.some((t) => t.status === s);
  let next: SocialPostStatus;
  if (has("PUBLISHING")) next = "PUBLISHING";
  else if (has("SCHEDULED") || has("PENDING")) {
    // Some targets are still waiting (e.g. a transient retry): the post stays/returns to SCHEDULED.
    next = active.some((t) => t.status === "PUBLISHED") && current === "PUBLISHING" ? "PUBLISHING" : "SCHEDULED";
  } else if (active.every((t) => t.status === "PUBLISHED")) next = "PUBLISHED";
  else next = "FAILED"; // settled, with at least one FAILED / UNCERTAIN / MISSED target
  return next === current ? null : next;
}
