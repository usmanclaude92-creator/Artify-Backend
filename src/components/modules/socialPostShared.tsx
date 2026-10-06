import React from "react";
import { Badge } from "../ui/ui";
import type { SocialPostStatus } from "../../lib/api";

export const POST_STATUS_LABEL: Record<SocialPostStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Awaiting approval",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  FAILED: "Failed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
export const POST_STATUS_TONE: Record<SocialPostStatus, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  SCHEDULED: "info",
  PUBLISHING: "info",
  PUBLISHED: "success",
  FAILED: "danger",
  REJECTED: "danger",
  CANCELLED: "neutral",
};
/** Calendar chip colours (kept as CSS variables-friendly hex so they read in light and dark). */
export const POST_STATUS_COLOR: Record<SocialPostStatus, string> = {
  DRAFT: "#64748b",
  PENDING_APPROVAL: "#d97706",
  APPROVED: "#2563eb",
  SCHEDULED: "#7c3aed",
  PUBLISHING: "#0891b2",
  PUBLISHED: "#059669",
  FAILED: "#dc2626",
  REJECTED: "#e11d48",
  CANCELLED: "#94a3b8",
};

export const PostStatusBadge: React.FC<{ status: SocialPostStatus }> = ({ status }) => <Badge tone={POST_STATUS_TONE[status]}>{POST_STATUS_LABEL[status]}</Badge>;

export const CONTENT_EDITABLE: SocialPostStatus[] = ["DRAFT", "REJECTED"];
export const SCHEDULE_EDITABLE: SocialPostStatus[] = ["DRAFT", "APPROVED", "SCHEDULED", "REJECTED"];

export function countHashtags(text: string, prefix = "#"): number {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text.match(new RegExp(`(^|\\s)${escaped}[\\p{L}\\p{N}_]+`, "gu")) ?? []).length;
}

export function timezoneOptions(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  const zones = intl.supportedValuesOf?.("timeZone") ?? ["UTC", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Karachi", "Asia/Singapore", "Australia/Sydney"];
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

/** Offset (ms) of `timeZone` from UTC at the instant `date`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Interprets a `datetime-local` value (YYYY-MM-DDTHH:mm) as wall-clock time in `timeZone` and returns the UTC instant. */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const [d, t] = local.split("T");
  const [y, mo, da] = d!.split("-").map(Number);
  const [h, mi] = (t ?? "00:00").split(":").map(Number);
  const guess = Date.UTC(y!, mo! - 1, da!, h!, mi!);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

/** UTC instant -> `datetime-local` string in `timeZone`. */
export function utcToZonedLocal(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const shifted = new Date(date.getTime() + zoneOffsetMs(date, timeZone));
  return shifted.toISOString().slice(0, 16);
}
