import { describe, expect, it } from "vitest";
import { TARGET_TRANSITIONS, canTargetTransition, computeBackoffMs, decideFailure, derivePostStatus, isDue, isMissed } from "../../server/services/social/publishing/publishPolicy";
import { classifyHttpStatus } from "../../server/services/social/publishing/publishErrors";
import { evaluateGate } from "../../server/services/social/publishing/publishingSettingsService";

const noJitter = { random: () => 0.5 };

describe("target state machine", () => {
  it("allows only the documented transitions", () => {
    expect(canTargetTransition("SCHEDULED", "PUBLISHING")).toBe(true);
    expect(canTargetTransition("PUBLISHING", "PUBLISHED")).toBe(true);
    expect(canTargetTransition("PUBLISHING", "UNCERTAIN")).toBe(true);
    expect(canTargetTransition("PUBLISHED", "SCHEDULED")).toBe(false); // published is terminal: never re-sent
    expect(canTargetTransition("UNCERTAIN", "PUBLISHING")).toBe(false); // never retried blindly
    expect(canTargetTransition("FAILED", "PUBLISHING")).toBe(false);
    expect(canTargetTransition("MISSED", "PUBLISHING")).toBe(false);
    expect(TARGET_TRANSITIONS.PUBLISHED).toEqual([]);
  });
});

describe("backoff", () => {
  it("grows exponentially, is capped and honours Retry-After", () => {
    expect(computeBackoffMs(1, undefined, noJitter)).toBe(2 * 60_000);
    expect(computeBackoffMs(2, undefined, noJitter)).toBe(4 * 60_000);
    expect(computeBackoffMs(3, undefined, noJitter)).toBe(8 * 60_000);
    expect(computeBackoffMs(20, undefined, noJitter)).toBe(60 * 60_000);
    expect(computeBackoffMs(1, 10 * 60_000, noJitter)).toBe(10 * 60_000);
    expect(computeBackoffMs(1, 999 * 3600_000, noJitter)).toBe(60 * 60_000);
  });
  it("applies bounded jitter", () => {
    expect(computeBackoffMs(1, undefined, { random: () => 0 })).toBe(Math.round(2 * 60_000 * 0.8));
    expect(computeBackoffMs(1, undefined, { random: () => 0.999999 })).toBeLessThanOrEqual(Math.round(2 * 60_000 * 1.2));
  });
});

describe("failure decisions", () => {
  it("retries transient errors until max attempts, then dead-letters", () => {
    expect(decideFailure("transient", 1, 5, undefined, noJitter)).toEqual({ action: "retry", delayMs: 120_000 });
    expect(decideFailure("transient", 5, 5)).toEqual({ action: "fail", reason: "max_attempts" });
  });
  it("fails permanent errors immediately, never retries uncertain, sends auth to reauth", () => {
    expect(decideFailure("permanent", 1, 5)).toEqual({ action: "fail", reason: "permanent" });
    expect(decideFailure("uncertain", 1, 5)).toEqual({ action: "uncertain" });
    expect(decideFailure("auth", 1, 5)).toEqual({ action: "reauth" });
  });
  it("classifies HTTP statuses", () => {
    expect(classifyHttpStatus(401)).toBe("auth");
    expect(classifyHttpStatus(403)).toBe("auth");
    expect(classifyHttpStatus(429)).toBe("transient");
    expect(classifyHttpStatus(503)).toBe("transient");
    expect(classifyHttpStatus(422)).toBe("permanent");
    expect(classifyHttpStatus(400)).toBe("permanent");
  });
});

describe("grace window and due selection", () => {
  const at = new Date("2026-10-12T10:00:00Z");
  it("MISSED only when never attempted and older than the grace window", () => {
    expect(isMissed(at, 0, new Date("2026-10-12T10:59:00Z"), 60)).toBe(false);
    expect(isMissed(at, 0, new Date("2026-10-12T11:01:00Z"), 60)).toBe(true);
    expect(isMissed(at, 1, new Date("2026-10-12T15:00:00Z"), 60)).toBe(false);
  });
  it("due selection compares absolute instants, so timezones cannot shift it", () => {
    // 09:00 in New York (EDT, UTC-4) == 13:00Z: not due at 12:59Z, due at 13:00Z regardless of the post's timezone label.
    const scheduledAt = new Date("2026-10-12T09:00:00-04:00");
    expect(isDue({ scheduledAt, nextAttemptAt: null }, new Date("2026-10-12T12:59:00Z"))).toBe(false);
    expect(isDue({ scheduledAt, nextAttemptAt: null }, new Date("2026-10-12T13:00:00Z"))).toBe(true);
    expect(isDue({ scheduledAt, nextAttemptAt: new Date("2026-10-12T13:30:00Z") }, new Date("2026-10-12T13:10:00Z"))).toBe(false);
    expect(isDue({ scheduledAt: null, nextAttemptAt: null }, new Date())).toBe(false);
  });
});

describe("post status derived from targets", () => {
  it("is PUBLISHED only when every active target published", () => {
    expect(derivePostStatus("PUBLISHING", [{ status: "PUBLISHED" }, { status: "PUBLISHED" }, { status: "CANCELLED" }])).toBe("PUBLISHED");
  });
  it("is PUBLISHING while any target is in flight", () => {
    expect(derivePostStatus("SCHEDULED", [{ status: "PUBLISHING" }, { status: "SCHEDULED" }])).toBe("PUBLISHING");
  });
  it("is FAILED once settled with any failed/uncertain/missed target", () => {
    expect(derivePostStatus("PUBLISHING", [{ status: "PUBLISHED" }, { status: "FAILED" }])).toBe("FAILED");
    expect(derivePostStatus("PUBLISHING", [{ status: "UNCERTAIN" }])).toBe("FAILED");
    expect(derivePostStatus("SCHEDULED", [{ status: "MISSED" }])).toBe("FAILED");
  });
  it("returns to SCHEDULED when a retry is pending and nothing has published", () => {
    expect(derivePostStatus("PUBLISHING", [{ status: "SCHEDULED" }])).toBe("SCHEDULED");
  });
  it("returns null when nothing changes or all targets are cancelled", () => {
    expect(derivePostStatus("SCHEDULED", [{ status: "SCHEDULED" }])).toBeNull();
    expect(derivePostStatus("SCHEDULED", [{ status: "CANCELLED" }])).toBeNull();
  });
});

describe("publishing gate (kill switch / enabled / dry-run)", () => {
  const on = { enabled: true, dryRun: false, killSwitch: false };
  it("defaults are OFF", () => {
    expect(evaluateGate(false, { enabled: false, dryRun: true, killSwitch: false }, { enabled: false, dryRun: true, killSwitch: false })).toEqual({ allowed: false, reason: "global_off" });
  });
  it("requires every layer to be enabled", () => {
    expect(evaluateGate(false, on, { ...on, enabled: false })).toEqual({ allowed: false, reason: "workspace_off" });
    expect(evaluateGate(false, { ...on, enabled: false }, on)).toEqual({ allowed: false, reason: "global_off" });
    expect(evaluateGate(false, on, on)).toEqual({ allowed: true, dryRun: false });
  });
  it("any kill switch wins over everything, including the env flag", () => {
    expect(evaluateGate(false, { ...on, killSwitch: true }, on)).toEqual({ allowed: false, reason: "global_kill_switch" });
    expect(evaluateGate(false, on, { ...on, killSwitch: true })).toEqual({ allowed: false, reason: "workspace_kill_switch" });
    expect(evaluateGate(true, on, on)).toEqual({ allowed: false, reason: "env_disabled" });
  });
  it("dry-run is the OR of global and workspace", () => {
    expect(evaluateGate(false, { ...on, dryRun: true }, on)).toEqual({ allowed: true, dryRun: true });
    expect(evaluateGate(false, on, { ...on, dryRun: true })).toEqual({ allowed: true, dryRun: true });
  });
});
