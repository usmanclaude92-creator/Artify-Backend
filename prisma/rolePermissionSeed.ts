/**
 * Shared role/permission seeding logic — the reference data (not tenant
 * data) every environment needs to exist before auth can work at all
 * (authService.register looks up the ADMIN role by key). Imported by both
 * prisma/seed.ts (developer-run, also seeds one bootstrap admin) and
 * tests/setup.ts (idempotent upsert, run once before the suite; tenant
 * data — organizations/users/sessions/audit_logs — is wiped and rebuilt
 * per test via tests/helpers/db.ts's resetDb(), but this reference data
 * is not, matching how a real deployment treats its role/permission
 * catalog as stable configuration, not per-test fixture data).
 */
import type { PrismaClient } from "@prisma/client";
import { PERMISSION_KEYS, ROLE_DEFINITIONS, SYSTEM_ROLE_KEYS, type RoleKey } from "../server/types/domain";

function moduleOf(key: string): string {
  return key.split(".")[0] ?? key;
}

function permissionName(key: string): string {
  const [, action] = key.split(".");
  return `${moduleOf(key)}: ${action ?? key}`.replace(/\b\w/g, (c) => c.toUpperCase());
}

const ROLE_PERMISSION_SETS: Record<RoleKey, readonly string[] | "*"> = {
  SUPER_ADMIN: "*",
  ADMIN: [
    "users.read",
    "users.create",
    "users.update",
    "organizations.read",
    "organizations.update",
    "organizations.manage_members",
    "roles.read",
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
    "product_categories.read",
    "product_categories.manage",
    "industries.read",
    "industries.manage",
    "content.read",
    "content.create",
    "content.update",
    "content.publish",
    "content.delete",
    // Phase 1 (Website module) — ADMIN gets full template/template-part
    // management, same tiering as content.* above.
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
    // Phase 5 (Navigation Menus) — ADMIN gets full menu management, same
    // tiering as templates.*/template_parts.* above.
    "navigation_menus.read",
    "navigation_menus.create",
    "navigation_menus.update",
    "navigation_menus.publish",
    "navigation_menus.delete",
    "authors.read",
    "authors.create",
    "authors.update",
    "media.read",
    "media.upload",
    "media.update",
    "media.delete",
    "reports.read",
    "reports.export",
    "settings.read",
    "settings.manage",
    "audit.read",
    // Phase 12 — ADMIN gets the full AI governance surface within its own
    // organization: catalog visibility, tool enablement, prompt/workflow
    // authoring and publishing, execution, approval decisions, usage/cost
    // and AI-specific audit (§34-style split, mirrored from Phase 10).
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
    // Phase 13/14/15 — Automation, Knowledge/RAG, Copilot (imported). ADMIN
    // gets the full set, same tiering the source repo used for this role.
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
    // Phase 10 — ADMIN gets the full commercial/billing set, including the
    // sensitive transitions (activate/suspend/terminate/variations.create,
    // issue/void, reverse) that MANAGER/USER/VIEWER do not (§34).
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
    "portal.dashboard.read",
    "portal.contracts.read",
    "portal.subscriptions.read",
    "portal.invoices.read",
    "portal.payments.read",
    "portal.onboarding.read",
    "portal.documents.read",
    // Phase 5 — ADMIN gets full redirect management and the SEO audit.
    "seo.redirects.read",
    "seo.redirects.create",
    "seo.redirects.update",
    "seo.redirects.delete",
    "seo.audit.read",
    // Phase 9 — ADMIN gets full form management.
    "forms.read",
    "forms.create",
    "forms.update",
    "forms.delete",
  ],
  MANAGER: [
    "users.read",
    "clients.read",
    "clients.create",
    "clients.update",
    "leads.read",
    "leads.create",
    "leads.update",
    "leads.convert",
    "contacts.read",
    "contacts.create",
    "contacts.update",
    "opportunities.read",
    "opportunities.create",
    "opportunities.update",
    "opportunities.close",
    "products.read",
    "products.create",
    "products.update",
    "product_modules.read",
    "product_modules.create",
    "product_modules.update",
    "product_modules.reorder",
    "product_categories.read",
    "product_categories.manage",
    "industries.read",
    "industries.manage",
    "content.read",
    "content.create",
    "content.update",
    // Phase 1 (Website module) — MANAGER can author but not publish/delete
    // templates/template-parts, same tiering as content.* above.
    "templates.read",
    "templates.create",
    "templates.update",
    "template_parts.read",
    "template_parts.create",
    "template_parts.update",
    // Phase 5 (Navigation Menus) — MANAGER can author but not
    // publish/delete menus, same tiering as templates.* above.
    "navigation_menus.read",
    "navigation_menus.create",
    "navigation_menus.update",
    "authors.read",
    "authors.update",
    "media.read",
    "media.upload",
    "media.update",
    "reports.read",
    // Phase 12 — MANAGER can use/author AI within its own org (execute
    // workflows, author prompts/workflows, see executions/usage/approvals)
    // but cannot touch the provider/model catalog, tool enablement, or
    // decide approvals — those stay ADMIN-only (mirrors Phase 10's split).
    "ai.providers.read",
    "ai.models.read",
    "ai.tools.read",
    "ai.prompts.read",
    "ai.prompts.create",
    "ai.prompts.update",
    "ai.workflows.read",
    "ai.workflows.create",
    "ai.workflows.update",
    "ai.workflows.execute",
    "ai.executions.read",
    "ai.usage.read",
    "ai.approvals.read",
    // Phase 13/14/15 (imported) — MANAGER can author/execute automation and
    // knowledge/copilot within its own org, but not automation.manage,
    // copilot.admin, or knowledge.archive (ADMIN-only, source repo's tiering).
    "automation.read",
    "automation.create",
    "automation.edit",
    "automation.publish",
    "automation.execute",
    "automation.approve",
    "knowledge.read",
    "knowledge.search",
    "knowledge.create",
    "knowledge.upload",
    "knowledge.edit",
    "knowledge.reindex",
    "copilot.read",
    "copilot.use",
    "copilot.manage",
    "onboarding.read",
    "onboarding.create",
    "onboarding.update",
    "workspaces.read",
    "workspaces.create",
    "workspaces.update",
    "invitations.read",
    "invitations.create",
    // Phase 10 — MANAGER gets read/create/update plus the reversible
    // subscription transitions, but not contract termination/variations,
    // invoice issue/void, or payment reversal (§34, reserved for ADMIN).
    "contracts.read",
    "contracts.create",
    "contracts.update",
    "subscriptions.read",
    "subscriptions.create",
    "subscriptions.update",
    "subscriptions.activate",
    "subscriptions.pause",
    "subscriptions.cancel",
    "invoices.read",
    "invoices.create",
    "invoices.update",
    "payments.read",
    "payments.create",
    "portal.dashboard.read",
    "portal.contracts.read",
    "portal.subscriptions.read",
    "portal.invoices.read",
    "portal.payments.read",
    "portal.onboarding.read",
    "portal.documents.read",
    // Phase 5 — MANAGER can manage redirects day-to-day but not delete them (ADMIN-only, §34 pattern).
    "seo.redirects.read",
    "seo.redirects.create",
    "seo.redirects.update",
    "seo.audit.read",
    // Phase 9 — MANAGER can manage forms day-to-day but not delete them (ADMIN-only, same pattern).
    "forms.read",
    "forms.create",
    "forms.update",
  ],
  USER: [
    "clients.read",
    "leads.read",
    "leads.create",
    "leads.update",
    "contacts.read",
    "opportunities.read",
    "opportunities.create",
    "opportunities.update",
    "products.read",
    "product_modules.read",
    "product_categories.read",
    "industries.read",
    "content.read",
    "content.create",
    // Phase 1 (Website module) — USER can read/create but not
    // publish/update/delete templates/template-parts, same tiering as content.* above.
    "templates.read",
    "templates.create",
    "template_parts.read",
    "template_parts.create",
    // Phase 5 (Navigation Menus) — USER can read/create but not
    // publish/update/delete menus, same tiering as templates.* above.
    "navigation_menus.read",
    "navigation_menus.create",
    "authors.read",
    "media.read",
    "media.upload",
    "reports.read",
    // Phase 12 — USER can execute existing workflows/prompts and see their
    // own executions/usage, but cannot author prompts/workflows or touch
    // the catalog/approvals (mirrors the read/execute-only Phase 10 split).
    "ai.tools.read",
    "ai.prompts.read",
    "ai.workflows.read",
    "ai.workflows.execute",
    "ai.executions.read",
    "ai.usage.read",
    // Phase 13/14/15 (imported) — USER can execute existing automations,
    // search knowledge, and use the copilot, matching the source repo's tiering.
    "automation.read",
    "automation.execute",
    "knowledge.read",
    "knowledge.search",
    "copilot.read",
    "copilot.use",
    "onboarding.read",
    "workspaces.read",
    "invitations.read",
    // Phase 10 — USER gets read-only commercial access plus the client
    // portal (§25/§26).
    "contracts.read",
    "subscriptions.read",
    "invoices.read",
    "payments.read",
    "portal.dashboard.read",
    "portal.contracts.read",
    "portal.subscriptions.read",
    "portal.invoices.read",
    "portal.payments.read",
    "portal.onboarding.read",
    "portal.documents.read",
    // Phase 5 — USER is read-only for SEO, same as most other modules.
    "seo.redirects.read",
    "seo.audit.read",
    // Phase 9 — USER is read-only for forms, same convention.
    "forms.read",
  ],
  VIEWER: [
    "users.read",
    "organizations.read",
    "roles.read",
    "clients.read",
    "leads.read",
    "contacts.read",
    "opportunities.read",
    "products.read",
    "product_modules.read",
    "product_categories.read",
    "industries.read",
    "content.read",
    // Phase 1 (Website module) — VIEWER is read-only, same convention as everywhere else.
    "templates.read",
    "template_parts.read",
    // Phase 5 (Navigation Menus) — VIEWER is read-only, same convention.
    "navigation_menus.read",
    "authors.read",
    "media.read",
    "reports.read",
    "settings.read",
    "audit.read",
    // Phase 12 — VIEWER is read-only across the AI surface, same as every
    // other module: no execute, no authoring, no approval decisions.
    "ai.providers.read",
    "ai.models.read",
    "ai.tools.read",
    "ai.prompts.read",
    "ai.workflows.read",
    "ai.executions.read",
    "ai.usage.read",
    "ai.approvals.read",
    "ai.audit.read",
    // Phase 13/14/15 (imported) — VIEWER is read-only here too, same convention.
    "automation.read",
    "knowledge.read",
    "knowledge.search",
    "copilot.read",
    "onboarding.read",
    "workspaces.read",
    "invitations.read",
    // Phase 10 — VIEWER gets read-only commercial access plus the client
    // portal (§25/§26).
    "contracts.read",
    "subscriptions.read",
    "invoices.read",
    "payments.read",
    "portal.dashboard.read",
    "portal.contracts.read",
    "portal.subscriptions.read",
    "portal.invoices.read",
    "portal.payments.read",
    "portal.onboarding.read",
    "portal.documents.read",
    // Phase 5 — VIEWER is read-only for SEO, same convention as everywhere else.
    "seo.redirects.read",
    "seo.audit.read",
    // Phase 9 — VIEWER is read-only for forms, same convention.
    "forms.read",
  ],
};

/**
 * Runs `fn` over `items` with at most `limit` in flight at once. Every
 * upsert below is independent (keyed on its own unique constraint), so
 * awaiting them one at a time (the original implementation) turned this
 * into hundreds of serial round trips and hit Vercel's 300s serverless
 * function timeout. Firing them all at once via a single Promise.all
 * isn't safe either — this environment's Postgres connection pool is
 * capped at 5, and confirmed in production: a few hundred concurrent
 * upserts blow past that limit and fail with Prisma's P2024 ("Timed out
 * fetching a new connection from the connection pool"). Capping
 * concurrency below the pool size keeps every connection busy without
 * any request queuing for one.
 */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const DB_CONCURRENCY = 4;

export async function seedRolesAndPermissions(prisma: PrismaClient): Promise<Record<RoleKey, string>> {
  await mapWithConcurrency(PERMISSION_KEYS, DB_CONCURRENCY, (key) =>
    prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, name: permissionName(key), module: moduleOf(key) },
    })
  );

  const roleIds = {} as Record<RoleKey, string>;

  const roles = [];
  for (const key of SYSTEM_ROLE_KEYS) {
    const def = ROLE_DEFINITIONS[key];
    const role = await prisma.role.upsert({
      where: { key },
      update: {},
      create: { key, name: def.name, description: def.description, isSystem: true },
    });
    roleIds[key] = role.id;
    roles.push({ key, role });
  }

  for (const { key, role } of roles) {
    const grantedKeys = ROLE_PERMISSION_SETS[key] === "*" ? PERMISSION_KEYS : ROLE_PERMISSION_SETS[key];
    const permissions = await prisma.permission.findMany({ where: { key: { in: [...grantedKeys] } } });

    await mapWithConcurrency(permissions, DB_CONCURRENCY, (permission) =>
      prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      })
    );
  }

  return roleIds;
}
