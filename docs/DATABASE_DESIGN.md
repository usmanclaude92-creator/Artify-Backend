# Database Design Recommendation

> **Phase 1 update**: the identity + webhook slice of this design is now implemented — see `prisma/schema.prisma` and `docs/PHASE_1_COMPLETION_REPORT.md` for what's real today vs. still just this recommendation. Two decisions below were resolved or intentionally scoped down for Phase 1; both are called out inline rather than silently diverging from this doc.

## 1. Technology
**PostgreSQL** (managed — Railway Postgres or Supabase, both already implied by existing deploy config/MCP tooling available to this project). Rationale: relational integrity for tenant/permission/billing data, native JSON columns for the flexible fields the prototype already models loosely (`Company.settings`, `AiCoworker.approvalPolicy`), mature migration tooling, and every entity in `server/types/index.ts` is already relational in shape (foreign keys via `companyId` everywhere).

**ORM**: **Prisma** (resolved in Phase 1 — see `ADR-002-database.md`). Replaces `server/core/db.ts`'s hand-rolled `Map` store.

## 2. Conventions
- **Primary keys**: UUID v7 (time-ordered) generated app-side or via `gen_random_uuid()` — keeps the existing prefixed-ID *display* convention (`usr_`, `org_`, `art_`) as a separate human-readable `slug`/`display_id` column if that UX is worth preserving, but the actual PK is a UUID. **Phase 1 note**: the identity tables implemented so far use Prisma's default `uuid()` (v4, non-time-ordered), not v7 — v7 support in Prisma's stable API wasn't worth the risk for a first migration. This is a low-cost, low-risk follow-up (index locality only, no schema-shape change) rather than a blocker; revisit alongside Phase 2's broader schema work.
- **Foreign keys**: every tenant-scoped table carries `company_id UUID NOT NULL REFERENCES companies(id)`, indexed.
- **Timestamps**: `created_at`, `updated_at` (`timestamptz`, default `now()`), trigger-maintained `updated_at`.
- **Soft deletion**: `deleted_at timestamptz NULL` on user-facing entities (users, articles, products, customers) so RBAC/audit history stays intact; hard-delete only for genuinely ephemeral data (sessions, telemetry events).
- **Optimistic locking**: `version integer NOT NULL DEFAULT 1` on records with concurrent-edit risk (articles, AI coworker configs, subscriptions) — increment on update, reject stale writes.
- **Constraints**: `UNIQUE(company_id, slug)` for products/articles, `UNIQUE(lower(email))` for users, `CHECK` constraints for enum-like fields already typed in `server/types/index.ts` (`status`, `role`, `tier`).
- **Indexes**: every `company_id` FK, every `(company_id, status)` pair used in list queries (mirrors the filters already in `cmsService.listArticles`, `leadService.listLeads`, `auditService.queryLogs`), full-text index (`pg_trgm` or `tsvector`) on article/product search fields since `search` query params already exist in the API.
- **Transactions**: multi-table writes (e.g. `register()` creating a company + user + subscription in one call — `authService.ts:100-201`) must become a single DB transaction; today it's three unguarded sequential in-memory writes.
- **Connection pooling**: PgBouncer or the platform's built-in pooler; Express app holds a single pool, not a connection per request.
- **Backups**: managed provider's automatic point-in-time recovery, enabled from day one of Phase 2 — never deferred to "later."
- **Migrations**: versioned, checked into `Artify-Backend/migrations/`, run in CI before deploy (see `IMPLEMENTATION_PLAN.md` Phase 2).

## 3. Schema families (maps directly to `TARGET_DOMAIN_MODEL` in `PHASE_0_AUDIT_REPORT.md`)

| Family | Core tables | Source of current shape |
|---|---|---|
| Identity | `users`, `roles`, `permissions`, `role_permissions`, `sessions` | `server/types/index.ts` `User`, `UserSession`, `RoleName`, `PermissionKey` — **Phase 1 implemented**: `companies`, `users`, `sessions`, `audit_logs`, `webhook_events`. Permissions remain a flat string array on `users.permissions` for now rather than a normalized `role_permissions` join table — see `prisma/schema.prisma`'s comment on the `User` model and `docs/PHASE_1_IMPLEMENTATION.md` for why that's deferred to Phase 3, not silently dropped. |
| Organizations | `companies`, `memberships`, `contacts` | `server/types/index.ts` `Company` |
| CRM | `leads`, `opportunities`, `activities`, `tasks` | `server/types/index.ts` `LeadInquiry`; `Customer` |
| Products | `products`, `services`, `features`, `plans` | `server/types/index.ts` `ProductServiceItem` |
| Client platform | `subscriptions`, `invoices`, `payments`, `api_keys`, `usage_events` | `server/types/index.ts` `Subscription`, `ApiKeyRecord` |
| CMS | `pages`, `articles`, `article_revisions`, `media_assets`, `seo_meta` | `server/types/index.ts` `ArticleRecord`; admin `seedData.ts` website/blog shapes |
| AI | `ai_coworkers`, `ai_tasks`, `ai_tool_calls`, `ai_approvals`, `ai_usage` | `server/types/index.ts` `AiCoworker`, `AiTask`, `AiToolDefinition` |
| Platform | `notifications`, `webhooks`, `webhook_events`, `jobs`, `audit_logs`, `system_settings`, `feature_flags` | `server/types/index.ts` `NotificationRecord`, `AuditLogRecord`; `artify-backend/server.ts` webhook shapes |

## 4. Notable schema corrections vs. the prototype's implicit model
- `api_keys.key_hash` must move from unsalted SHA-256 (`db.ts:47-49`) to a proper HMAC or bcrypt-style hash — same fix as user passwords (see `SECURITY_MODEL.md`).
- `leads` currently has three divergent shapes across the two repos' in-memory stores; the production schema unifies them into one table with a `source` enum (`website_form`, `webhook`, `manual`, `api`).
- `audit_logs` becomes append-only (no update/delete grants at the DB role level) — today it's just a JS array anyone with server access can mutate.

An entity-relationship diagram will be produced in Phase 2 once the ORM is chosen (Prisma ERD or dbdiagram.io export), not hand-drawn here to avoid drifting from the actual migration files.
