/** Valid SocialPost status transitions. PUBLISHING/PUBLISHED/FAILED are written only by Step 6's workers. */
import type { SocialPostStatus } from "@prisma/client";

export const POST_TRANSITIONS: Record<SocialPostStatus, readonly SocialPostStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "CANCELLED"], // APPROVED only via "auto-approve if guardrails pass"
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "DRAFT"], // DRAFT = withdraw
  APPROVED: ["SCHEDULED", "DRAFT", "CANCELLED"],
  SCHEDULED: ["APPROVED", "DRAFT", "CANCELLED", "PUBLISHING"], // PUBLISHING reserved for workers
  PUBLISHING: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  FAILED: ["DRAFT", "SCHEDULED", "CANCELLED"],
  REJECTED: ["DRAFT", "CANCELLED"],
  CANCELLED: ["DRAFT"],
};

/** Statuses a user may move a post into by hand (the rest are worker-owned). */
export const USER_TARGET_STATUSES: readonly SocialPostStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "REJECTED", "CANCELLED"];
/** Statuses in which title/body/media/link/targets may be edited. */
export const CONTENT_EDITABLE: readonly SocialPostStatus[] = ["DRAFT", "REJECTED"];
/** Statuses in which scheduledAt may be changed (reschedule). */
export const SCHEDULE_EDITABLE: readonly SocialPostStatus[] = ["DRAFT", "APPROVED", "SCHEDULED", "REJECTED"];
/** Statuses that count as "pending the approver's decision". */
export const NEEDS_GUARDRAILS: readonly SocialPostStatus[] = ["PENDING_APPROVAL", "APPROVED", "SCHEDULED"];

export function canTransition(from: SocialPostStatus, to: SocialPostStatus): boolean {
  return POST_TRANSITIONS[from].includes(to);
}
