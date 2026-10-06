import React from "react";
import { Badge } from "../ui/ui";
import type { PublishAttemptView, PublishTargetStatus } from "../../lib/api";

export const TARGET_TONE: Record<PublishTargetStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "neutral", SCHEDULED: "info", PUBLISHING: "info", PUBLISHED: "success", FAILED: "danger", UNCERTAIN: "warning", MISSED: "warning", CANCELLED: "neutral",
};
export const TARGET_LABEL: Record<PublishTargetStatus, string> = {
  PENDING: "Pending", SCHEDULED: "Scheduled", PUBLISHING: "Publishing now", PUBLISHED: "Published", FAILED: "Failed", UNCERTAIN: "Needs a check", MISSED: "Missed", CANCELLED: "Cancelled",
};
export const OUTCOME_LABEL: Record<NonNullable<PublishAttemptView["outcome"]>, string> = {
  SUCCESS: "Published", TRANSIENT_FAILURE: "Temporary failure — retry scheduled", PERMANENT_FAILURE: "Failed", AUTH_FAILURE: "Credentials rejected", UNCERTAIN: "Outcome unknown", DRY_RUN: "Dry run (nothing sent)", SKIPPED: "Skipped",
};

export const TargetStatusBadge: React.FC<{ status: PublishTargetStatus; dryRun?: boolean }> = ({ status, dryRun }) =>
  dryRun ? <Badge tone="info">Dry run</Badge> : <Badge tone={TARGET_TONE[status]}>{TARGET_LABEL[status]}</Badge>;

/** The stored error is "<category>: <message>"; the page shows them separately. */
export function splitError(error: string | null): { category: string | null; message: string | null } {
  if (!error) return { category: null, message: null };
  const m = /^([a-z_]+): (.*)$/s.exec(error);
  return m ? { category: m[1]!, message: m[2]! } : { category: null, message: error };
}

export const REASON_LABEL: Record<string, string> = {
  env_disabled: "Publishing is disabled by the server configuration.",
  global_kill_switch: "The global kill switch is engaged.",
  global_off: "Publishing is switched off platform-wide.",
  workspace_kill_switch: "The workspace kill switch is engaged.",
  workspace_off: "Publishing is switched off for this workspace.",
};

export const PROVIDER_LABEL: Record<string, string> = { linkedin: "LinkedIn", meta: "Meta", mock: "Mock" };
