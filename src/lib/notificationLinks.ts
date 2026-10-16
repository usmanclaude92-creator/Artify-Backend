/**
 * Where a notification should take the user. Pure and permission-aware: a link is only returned when the page exists in the sidebar's
 * NAV_ITEMS and the person can open it, so a click never ends on an access-denied screen. Pages are opened at list level (the list
 * pages do not open a specific record from an id); a notification with no known destination gets no link.
 */
import { NAV_ITEMS, hasPermission } from "./permissions";

export interface NotificationLink {
  path: string;
  label: string;
}

interface NotificationLike {
  type: string;
  title?: string;
  entityType?: string | null;
}

/** What the backend attaches as `entityType` -> Control Center page. */
const BY_ENTITY: Record<string, string> = {
  automation_approval: "/approvals",
  automation_task: "/my-work",
  automation_execution: "/automation",
  workflow: "/automation",
  lead: "/crm/leads",
  client: "/crm/clients",
  opportunity: "/crm/opportunities",
  form_submission: "/marketing/forms",
  campaign: "/marketing/campaigns",
  landing_page: "/marketing/landing-pages",
  page: "/cms/pages",
  post: "/cms/posts",
  case_study: "/cms/case-studies",
  post_comment: "/cms/comments",
  invoice: "/commercial/invoices",
  payment: "/commercial/payments",
  social_conversation: "/social/inbox",
  social_post: "/social/posts",
  social_account: "/social/accounts",
  privacy_request: "/privacy",
  privacy_erasure: "/privacy",
  system_health: "/system-health",
  dashboard_report_delivery: "/scheduled-reports",
  organization: "/organizations",
  user: "/users",
  product: "/products",
};

/** What the backend uses as `type` when there is no (or no specific) entity. Checked before the entity mapping where it is more precise. */
const BY_TYPE: Array<[RegExp, string]> = [
  [/^onboarding_/, "/onboarding"],
  [/^task_/, "/my-work"],
  [/^lead_/, "/crm/leads"],
  [/^opportunity_/, "/crm/opportunities"],
  [/^workflow_/, "/automation"],
  [/^social_(inbox|account|publish)/, "/social/inbox"],
  [/^FORM_SUBMITTED$/i, "/marketing/forms"],
  [/^PORTAL_REGISTRATION$/i, "/organizations"],
  [/^SYSTEM_ALERT$/i, "/system-health"],
  [/^WORKFLOW_UPDATE$/i, "/automation"],
  [/^system_health/, "/system-health"],
  [/^dashboard_report/, "/scheduled-reports"],
  [/^approval_/, "/approvals"],
];

function contentPublishedPath(title: string | undefined): string {
  const t = (title ?? "").toLowerCase();
  if (t.includes("case study")) return "/cms/case-studies";
  if (t.includes("page")) return "/cms/pages";
  return "/cms/posts";
}

export function notificationPath(n: NotificationLike): string | null {
  if (n.type === "content_published") return contentPublishedPath(n.title);
  if (n.entityType === "post_comment" || n.type === "post_comment_pending") return "/cms/comments";
  // Onboarding progress is about the client but belongs on the onboarding board.
  if (/^onboarding_/.test(n.type)) return "/onboarding";
  // Social items keep their precise page: a failed publish opens Posts, an account problem opens Accounts.
  if (n.type === "social_publish_failed") return "/social/posts";
  if (n.type === "social_account_attention") return "/social/accounts";
  // An approval about a privacy request or a social post carries that entity, so it opens the entity's own page, not the generic queue.
  if (n.entityType && BY_ENTITY[n.entityType]) return BY_ENTITY[n.entityType]!;
  for (const [pattern, path] of BY_TYPE) if (pattern.test(n.type)) return path;
  return null;
}

/** The link to show for a notification, or null when there is no destination or the person may not open it. */
export function notificationLink(n: NotificationLike, permissions: readonly string[] | undefined): NotificationLink | null {
  const path = notificationPath(n);
  if (!path) return null;
  const item = NAV_ITEMS.find((i) => i.path === path);
  if (!item) return null;
  if (item.portalOnly) return null;
  const required = item.requiresAnyPermission ?? [];
  const allowed = required.length === 0 || required.some((key) => hasPermission(permissions, key));
  return allowed ? { path, label: item.label } : null;
}
