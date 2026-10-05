/**
 * Identity domain types — Phase 2. Roles and permissions are now real
 * database rows (`roles`, `permissions`, `role_permissions` — see
 * docs/ADR/ADR-011-permission-based-rbac-schema.md), not the Phase 1
 * Prisma enum + flat array. `RoleKey`/`PermissionKey` remain TypeScript
 * literal unions purely for compile-time safety at route-decoration call
 * sites (`requirePermission("users.read")`); the runtime source of truth
 * is always the database.
 */
import type { User as PrismaUser } from "@prisma/client";

/** The 5 built-in system roles seeded by prisma/seed.ts. Custom roles (not built in Phase 2) would extend this at runtime without a corresponding TS literal. */
export const SYSTEM_ROLE_KEYS = ["SUPER_ADMIN", "ADMIN", "MANAGER", "USER", "VIEWER"] as const;
export type RoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export const ROLE_DEFINITIONS: Readonly<Record<RoleKey, { name: string; description: string }>> = {
  SUPER_ADMIN: {
    name: "Super Administrator",
    description: "Full platform access across all organizations. Reserved for Artify's own platform operators.",
  },
  ADMIN: {
    name: "Administrator",
    description: "Full access within the administrator's own organization.",
  },
  MANAGER: {
    name: "Manager",
    description: "Manages day-to-day operations (CRM, content, products) within the organization.",
  },
  USER: {
    name: "User",
    description: "Standard operational access within the organization.",
  },
  VIEWER: {
    name: "Viewer",
    description: "Read-only access within the organization.",
  },
};

/**
 * Permission catalog (docs/ADR-011). Namespaced `<module>.<action>` —
 * seeded into the `permissions` table by prisma/seed.ts and mapped to
 * roles via `role_permissions`. This union exists for compile-time safety
 * only; adding a permission means updating both this list and the seed.
 */
export const PERMISSION_KEYS = [
  "users.read",
  "users.create",
  "users.update",
  "users.delete",
  "organizations.read",
  "organizations.create",
  "organizations.update",
  "organizations.delete",
  "organizations.manage_members",
  "roles.read",
  "roles.create",
  "roles.update",
  "roles.delete",
  "roles.assign",
  "clients.read",
  "clients.create",
  "clients.update",
  "clients.delete",
  "leads.read",
  "leads.create",
  "leads.update",
  "leads.delete",
  "leads.convert",
  "contacts.read",
  "contacts.create",
  "contacts.update",
  "contacts.delete",
  // Phase 7 — CRM pipeline (docs/CRM_ARCHITECTURE.md). "close" covers both
  // POST /opportunities/:id/win and /lose — both are symmetric terminal
  // transitions (unlike contracts.activate/suspend/terminate, which differ
  // enough in blast radius to warrant separate keys), so one permission
  // covers both rather than adding win/lose granularity nothing asked for.
  "opportunities.read",
  "opportunities.create",
  "opportunities.update",
  "opportunities.delete",
  "opportunities.close",
  "products.read",
  "products.create",
  "products.update",
  "products.archive",
  "product_modules.read",
  "product_modules.create",
  "product_modules.update",
  "product_modules.archive",
  "product_modules.reorder",
  // Phase 10 (Products + Services + Solutions) — small, global reference
  // tables (ProductCategory/Industry). One "manage" key per table rather
  // than products.*'s full read/create/update/archive granularity — these
  // have no archive lifecycle of their own and no use case yet for
  // separating create from update.
  "product_categories.read",
  "product_categories.manage",
  "industries.read",
  "industries.manage",
  "content.read",
  "content.create",
  "content.update",
  "content.publish",
  "content.delete",
  "authors.read",
  "authors.create",
  "authors.update",
  "media.read",
  "media.upload",
  "media.update",
  "media.delete",
  // Website module (Phase 1 of the Control Center replacement initiative —
  // docs/control-center-replacement-roadmap.md). Same {read,create,update,
  // publish,delete} shape as content.* above, on purpose: Templates/
  // Template Parts are content-shaped resources following the exact same
  // draft->publish workflow as Post/Page, so they get the exact same
  // permission shape rather than inventing a new one.
  "templates.read",
  "templates.create",
  "templates.update",
  "templates.publish",
  "templates.delete",
  "template_parts.read",
  "template_parts.create",
  "template_parts.update",
  "template_parts.publish",
  "template_parts.delete",
  // Phase 5 (Navigation Menus) — same {read,create,update,publish,delete}
  // shape as templates.*/template_parts.* above, same reasoning.
  "navigation_menus.read",
  "navigation_menus.create",
  "navigation_menus.update",
  "navigation_menus.publish",
  "navigation_menus.delete",
  "reports.read",
  "reports.export",
  // Phase 15 — Analytics Dashboard read access (docs/ANALYTICS_ARCHITECTURE.md).
  // Separate from reports.read: the dashboard is a live, real-time-ish
  // overview, while reports.read/reports.export gate the Reports area's
  // generated/exportable report documents.
  "analytics.read",
  "settings.read",
  "settings.manage",
  "audit.read",
  // Phase 17 — Administration, Security & Integrations. Reads and manages are
  // separate keys; only SUPER_ADMIN holds the manage keys by default (wildcard).
  "security.read",
  "security.manage",
  "integrations.read",
  "integrations.manage",
  "webhooks.read",
  "webhooks.manage",
  "api_keys.read",
  "api_keys.manage",
  // Phase 12 — AI Control Center governance keys (docs/AI_GOVERNANCE.md).
  // Deliberately granular: provider/model catalog and tool enablement are
  // admin-only; prompt/workflow authoring is separate from execution;
  // approval decisions are separate from viewing what's pending; usage/cost
  // and AI-specific audit are separate read surfaces from generic
  // reports.read/audit.read so they can be granted independently.
  "ai.providers.read",
  "ai.providers.manage",
  "ai.models.read",
  "ai.models.manage",
  "ai.tools.read",
  "ai.tools.manage",
  "ai.prompts.read",
  "ai.prompts.create",
  "ai.prompts.update",
  "ai.prompts.publish",
  "ai.prompts.delete",
  "ai.workflows.read",
  "ai.workflows.create",
  "ai.workflows.update",
  "ai.workflows.publish",
  "ai.workflows.delete",
  "ai.workflows.execute",
  "ai.executions.read",
  "ai.executions.cancel",
  "ai.usage.read",
  "ai.approvals.read",
  "ai.approvals.decide",
  "ai.audit.read",
  // Phase 13/14/15 — Automation, Knowledge/RAG, and Copilot (imported from
  // usmanclaude92-creator/Artify-Backend---Google-AI-Studio-, commit
  // 4a1d7cd). Separate namespace from ai.* above — that's this repo's own
  // governed AI-tool/workflow layer (docs/AI_GOVERNANCE.md); these three
  // are net-new subsystems that didn't exist here before this import.
  "automation.read",
  "automation.create",
  "automation.edit",
  "automation.publish",
  "automation.execute",
  "automation.approve",
  "automation.manage",
  "knowledge.read",
  "knowledge.search",
  "knowledge.create",
  "knowledge.upload",
  "knowledge.edit",
  "knowledge.archive",
  "knowledge.reindex",
  "knowledge.manage",
  "copilot.read",
  "copilot.use",
  "copilot.manage",
  "copilot.admin",
  "onboarding.read",
  "onboarding.create",
  "onboarding.update",
  "onboarding.complete",
  "workspaces.read",
  "workspaces.create",
  "workspaces.update",
  "workspaces.suspend",
  "invitations.read",
  "invitations.create",
  "invitations.revoke",
  // Phase 10 — commercial/billing (docs/COMMERCIAL_ARCHITECTURE.md,
  // docs/BILLING_ARCHITECTURE.md). Sensitive financial actions
  // (activate/suspend/terminate/variations.create, issue/void,
  // reverse) are deliberately separate from read/create/update — §34.
  "contracts.read",
  "contracts.create",
  "contracts.update",
  "contracts.activate",
  "contracts.suspend",
  "contracts.terminate",
  "contracts.variations.create",
  "subscriptions.read",
  "subscriptions.create",
  "subscriptions.update",
  "subscriptions.activate",
  "subscriptions.pause",
  "subscriptions.cancel",
  "invoices.read",
  "invoices.create",
  "invoices.update",
  "invoices.issue",
  "invoices.void",
  "payments.read",
  "payments.create",
  "payments.reverse",
  // Client Portal — read-only client-facing capabilities, deliberately
  // separate from the internal contracts.*/invoices.*/payments.* keys
  // above (§25/§26). Granted broadly (every internal role too, so an
  // agency user who switches their session into a client's workspace
  // organization can see that workspace's own portal) — the real
  // boundary is portalService resolving the caller's Client record from
  // their session's own organizationId, never a client-supplied id.
  "portal.dashboard.read",
  "portal.contracts.read",
  "portal.subscriptions.read",
  "portal.invoices.read",
  "portal.payments.read",
  // Phase 13 — same reasoning as the portal keys above, extended to
  // onboarding progress and client-visible documents.
  "portal.onboarding.read",
  "portal.documents.read",
  // Phase 5 (SEO Control Center, docs/SEO_ARCHITECTURE.md) — redirects
  // and the rule-based SEO audit are their own permission domain rather
  // than folded into content.*, since a redirect isn't itself content
  // and the audit reads across Posts/Pages without needing content.update.
  "seo.redirects.read",
  "seo.redirects.create",
  "seo.redirects.update",
  "seo.redirects.delete",
  "seo.audit.read",
  // Phase 9 (MVP slice) — Marketing forms (docs/FORMS_ARCHITECTURE.md).
  // "read" covers both the form definition list and viewing its
  // submissions — a submission has no independent lifecycle of its own to
  // gate separately from the form it belongs to, unlike opportunities'
  // separate "close" key for a real distinct action.
  "forms.read",
  "forms.create",
  "forms.update",
  "forms.delete",
  // Phase 14 (Marketing + Campaigns + Automation, docs/MARKETING_ARCHITECTURE.md).
  // "publish" mirrors content.*/templates.*'s own publish-is-separate-
  // from-update convention (activating live traffic attribution is a
  // bigger blast radius than editing draft fields); "archive" is the
  // terminal action, same shape as products.archive.
  "campaigns.read",
  "campaigns.create",
  "campaigns.update",
  "campaigns.publish",
  "campaigns.archive",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** A resolved role + its permission set, attached to a session on verification (never stored redundantly per-user). */
export interface ResolvedRole {
  id: string;
  key: string;
  name: string;
  permissions: string[];
}

/**
 * A User row with the password hash stripped — the only shape allowed to
 * leave the service layer — plus the role/permissions resolved for the
 * CURRENT SESSION's organization context (Phase 3 —
 * docs/AUTHENTICATION_ARCHITECTURE.md "Session-scoped authorization").
 * `organizationId` here reflects the active session's organization, which
 * may differ from the user's home organization after
 * `switchOrganization()` — it is not simply `User.organizationId` echoed
 * back unmodified.
 */
export type SanitizedUser = Omit<PrismaUser, "passwordHash"> & {
  role: ResolvedRole;
};

export function sanitizeUser(user: PrismaUser, role: ResolvedRole): SanitizedUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return { ...rest, role };
}

/** One row of the "which organizations can this user act in" list surfaced by GET /auth/me. */
export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  roleKey: string;
  roleName: string;
  isPrimary: boolean;
  isCurrent: boolean;
}
