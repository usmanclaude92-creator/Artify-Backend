# Database Design Recommendation

No implementation in Phase 0/1 planning docs — this defines the target only. No migrations exist yet in either repo.

## 1. Technology
**PostgreSQL** (managed — Railway Postgres or Supabase, both already implied by existing deploy config/MCP tooling available to this project). Rationale: relational integrity for tenant/permission/billing data, native JSON columns for the flexible fields the prototype already models loosely (`Company.settings`, `AiCoworker.approvalPolicy`), mature migration tooling, and every entity in `server/types/index.ts` is already relational in shape (foreign keys via `companyId` everywhere).

**ORM**: Prisma or Drizzle (either is compatible with the existing TypeScript-first codebase; Drizzle if the team wants SQL-close control, Prisma if migration ergonomics matter more). Either replaces `server/core/db.ts`'s hand-rolled `Map` store.

## 2. Conventions
- **Primary keys**: UUID v7 (time-ordered) generated app-side or via `gen_random_uuid()` — keeps the existing prefixed-ID *display* convention (`usr_`, `org_`, `art_`) as a separate human-readable `slug`/`display_id` column if that UX is worth preserving, but the actual PK is a UUID.
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
| Identity | `users`, `roles`, `permissions`, `role_permissions`, `sessions` | `server/types/index.ts` `User`, `UserSession`, `RoleName`, `PermissionKey` |
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
