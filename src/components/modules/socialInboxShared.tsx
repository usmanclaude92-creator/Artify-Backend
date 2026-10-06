import React from "react";
import { Badge } from "../ui/ui";
import type { InboxConversation, InboxPriority, InboxStatus, InboxType } from "../../lib/api";

export const TYPE_LABEL: Record<InboxType, string> = { COMMENT: "Comment", DM: "Direct message", MENTION: "Mention", REVIEW: "Review" };
export const STATUS_LABEL: Record<InboxStatus, string> = { OPEN: "Open", PENDING: "Waiting on customer", RESOLVED: "Resolved", SPAM: "Spam" };
export const PRIORITY_LABEL: Record<InboxPriority, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };

/** "2h 05m" style duration for first-response times. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 60_000) return "<1m";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ${String(mins % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Short relative time for list rows. */
export function shortAgo(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export function displayName(c: Pick<InboxConversation, "participant">): string {
  return c.participant.name || c.participant.handle || "Unknown";
}

export const ConversationBadges: React.FC<{ c: InboxConversation }> = ({ c }) => (
  <span className="flex gap-1 flex-wrap">
    <Badge tone="neutral">{TYPE_LABEL[c.type]}</Badge>
    {c.overdue && <Badge tone="danger">Overdue</Badge>}
    {(c.priority === "HIGH" || c.priority === "URGENT") && <Badge tone="warning">{PRIORITY_LABEL[c.priority]}</Badge>}
    {c.sentiment === "negative" && <Badge tone="danger">Negative</Badge>}
    {c.needsHuman && <Badge tone="warning">Needs a human</Badge>}
    {c.failedSend && <Badge tone="danger">Send failed</Badge>}
    {c.status === "OPEN" && !c.assigneeId && <Badge tone="info">Unassigned</Badge>}
    {c.status === "SPAM" && <Badge tone="neutral">Spam</Badge>}
  </span>
);
