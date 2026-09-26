# Artify Backend — Evidence-Based Architecture & Security Audit

**Repo audited:** `/home/user/Artify-Backend` (Node/Express/TypeScript/Prisma/PostgreSQL)
**Method:** Direct source inspection (not docs). Every claim below cites a file path and, where feasible, a line number. Where the code could not be fully verified, this is stated explicitly as "NOT VERIFIED."
**Auditor:** automated research pass, read-only, no files modified.
**Date:** 2026-09-26

---

## 1. Architecture Overview

### Directory structure (verified via `find`/`ls`)

```
server/
  app/app.ts              - Express app assembly (createApp/finalizeApp)
  vercelHandler.ts         - Vercel serverless entry point
  config/env.ts            - centralized, Zod-validated environment config
  core/                    - apiResponse.ts, errors.ts, logger.ts (pino)
  db/                      - prisma.ts (client singleton), health.ts
  middleware/              - auth.ts, security.ts, rateLimiter.ts, requestId.ts,
                              requestLogger.ts, errorHandler.ts
  routes/v1/                - 38 route files, one per resource, mounted in index.ts
  schemas/                 - 24 Zod schema files (one per resource, mostly)
  services/                - business logic layer (one file per resource) +
                              services/automation/, services/knowledge/, services/copilot/
  repositories/            - Prisma data-access layer, one file per model/resource
  storage/                 - pluggable object storage (local/s3/r2/supabase)
  ai/                      - AI provider adapter abstraction (gemini/mock)
  utils/                   - crypto, password, fileSignature, money, asyncHandler
server.ts (repo root)      - Railway/Docker bootstrap (Express + Vite/static + .listen())
```

### Layering pattern

This is a genuine **route → service → repository** layering, consistently applied:
- Route files (`server/routes/v1/*.ts`) do only: mount middleware (`authenticateToken`, `requirePermission`), parse/validate the request with a Zod schema, call exactly one service method, and format the response via `sendSuccess`. Example: `server/routes/v1/invoiceRoutes.ts:59-67`.
- Service files (`server/services/*.ts`) hold business logic and orchestrate one or more repositories, e.g. `server/services/authService.ts`.
- Repository files (`server/repositories/*.ts`) are the only place that calls `prisma.<model>` directly for a given resource, e.g. `server/repositories/invoiceRepository.ts:49-50` (`findByIdInOrg`).

This is not "fat routes" — routes are thin. The two Phase-13/14/15 modules (Automation, Knowledge, Copilot — see §6) deviate somewhat: `server/routes/v1/knowledgeRoutes.ts` and `server/routes/v1/copilotRoutes.ts` call `prisma` directly from the route file in a few places (e.g. `knowledgeRoutes.ts:85-93`, `:105-118`, `:127-135`) rather than going through a repository, and skip Zod validation entirely (see §5). Comments in these files explicitly say they were "imported/adapted" from a different source repo (`knowledgeRoutes.ts:3-9`, `copilotRoutes.ts:2-7`), which explains the inconsistency — this is genuine, documented technical debt, not an assumption.

### Bootstrap: Vercel vs. other targets

Two independent entry points share one `createApp()`/`finalizeApp()` assembly (`server/app/app.ts:24-44`), so there is no route/middleware duplication between targets:

- **Railway/Docker** (`server.ts`, repo root): builds the Express app, mounts Vite middleware in dev or serves the built `dist/` static bundle + SPA fallback in production (`server.ts:24-37`), verifies DB connectivity with `SELECT 1` before calling `.listen()` (fail-fast, `server.ts:43-49`), and installs `SIGTERM`/`SIGINT` graceful-shutdown handlers (`server.ts:55-74`). Built via `esbuild --bundle` into `dist/server.cjs` (`package.json` `build` script).
- **Vercel serverless** (`server/vercelHandler.ts`): just calls `createApp()`/`finalizeApp()` and exports the Express app; no `.listen()`, no static serving (Vercel serves the Vite build as static files separately per `vercel.json`). The file's own comment (`vercelHandler.ts:9-19`) documents a real, previously-hit deployment bug: Vercel's Node builder does not bundle files an entry point imports from elsewhere in the repo, so this file must be pre-bundled with esbuild into a single `api/index.mjs` (`package.json` `build:vercel-api` script) before deployment — confirmed consistent with `vercel.json:6-10`'s `functions."api/index.mjs"` config.

**Implication for this audit's Vercel context:** the Vercel deployment path has **no background worker or `.listen()`-based process** — every request is a fresh, stateless function invocation. This matters materially for §8 (the Automation engine's `setInterval` queue worker and Knowledge's inline-embedding pipeline).

---

## 2. API Surface / Route Catalog

All 38 route files are mounted in `server/routes/v1/index.ts:65-104`, under `/api/v1`. Table below: base path, auth requirement (verified by checking for `router.use(authenticateToken)` or per-route `authenticateToken`), tenant scoping (verified by checking whether handlers use `req.user!.organizationId` vs. a client-supplied id), one-line purpose.

| Mount path | File | Auth? | Tenant-scoped via session? | Purpose |
|---|---|---|---|---|
| `/auth` | authRoutes.ts | Mixed (login/register public; me/logout/password require token) | n/a | Login, register, session, password mgmt |
| `/webhooks` | webhookRoutes.ts | None (HMAC signature instead) | Payload-derived | Inbound lead webhook w/ HMAC verify + idempotency |
| `/system` | systemRoutes.ts | NOT VERIFIED in detail (health/version likely public) | n/a | System/health info |
| `/users` | userRoutes.ts | Yes (`authenticateToken` + `requirePermission`) | Yes — `req.user!.organizationId`, `userRoutes.ts:20-21` | User CRUD |
| `/roles` | roleRoutes.ts | Yes | n/a (global catalog) | Role catalog (read-only) |
| `/permissions` | roleRoutes.ts (`permissionsRouter`) | Yes | n/a | Permission catalog (read-only) |
| `/organizations` | organizationRoutes.ts | Yes | Yes | Organization mgmt |
| `/audit-logs` | auditLogRoutes.ts | Yes | Yes | Audit log query |
| `/settings` | settingsRoutes.ts | Yes | Yes | System settings |
| `/leads` | leadRoutes.ts | Yes | Yes | CRM leads |
| `/clients` | clientRoutes.ts | Yes | Yes | CRM clients |
| `/contacts` | contactRoutes.ts | Yes | Yes | CRM contacts |
| `/crm` | crmRoutes.ts | Yes | Yes, `crmRoutes.ts:17` | Dashboard summary (aggregation only) |
| `/onboarding` | onboardingRoutes.ts | Yes | Yes | Client onboarding checklist |
| `/workspaces` | workspaceRoutes.ts | Yes | Yes | Workspace provisioning |
| `/invitations` | invitationRoutes.ts | Yes | Yes | Workspace invitations |
| `/products` | productRoutes.ts | Yes | n/a (global catalog, see §3) | Product catalog CRUD |
| `/product-modules` | productModuleRoutes.ts | Yes | n/a (global) | Product module CRUD |
| `/pages` | pageRoutes.ts | Yes | Yes | CMS pages |
| `/posts` | postRoutes.ts | Yes | Yes | CMS posts |
| `/categories` | categoryRoutes.ts | Yes | Yes | CMS categories |
| `/tags` | tagRoutes.ts | Yes | Yes | CMS tags |
| `/authors` | authorRoutes.ts | Yes | Yes | CMS authors |
| `/media` | mediaRoutes.ts | Yes | Yes | Media library / uploads |
| `/contracts` | contractRoutes.ts | Yes | Yes | Commercial contracts |
| `/subscriptions` | subscriptionRoutes.ts | Yes | Yes | Subscriptions |
| `/invoices` | invoiceRoutes.ts | Yes | Yes, `invoiceRoutes.ts:54` → `invoiceService.getInvoice(req.user!.organizationId, ...)` | Invoices + payments |
| `/payments` | paymentRoutes.ts | Yes | Yes | Payments |
| `/portal` | portalRoutes.ts | Yes | Yes | Read-only client portal |
| `/public` | publicRoutes.ts | **None (intentional)** | Server-resolved fixed org (see below) | Public marketing-site API |
| `/ai/providers` … `/ai/approvals` (7 sub-routers) | aiProviderRoutes.ts etc. | Yes | Yes | AI Control Center governance |
| `/automation` | automationRoutes.ts | Yes | Yes (tested, `tests/integration/automation.test.ts:133`) | Workflow automation engine |
| `/knowledge` | knowledgeRoutes.ts | Yes | Yes (`req.user!.organizationId` in every query) | RAG/knowledge base |
| `/copilot` | copilotRoutes.ts | Yes | Yes | AI copilot workspace/chat |

### `publicRoutes.ts` — verified unauthenticated-safe

`server/routes/v1/publicRoutes.ts` mounts at `/api/v1/public` with **no `authenticateToken` anywhere in the file** (confirmed by reading the full file — 122 lines, no import of `authenticateToken`). Every handler delegates to one of three services, and every service builds an **explicit allow-list projection**, never spreads a raw Prisma row:

- `publicSiteService.ts` (`projectPage` L46-57, `projectPost` L64-78, `projectAuthor` L59-62, `projectPublicMedia` L35-40): returns only `slug/title/body/seo/featuredMedia/publishedAt/updatedAt` for pages/posts; author is reduced to `name/bio/avatarUrl` (no user id, no email); media is reduced to `url/altText/caption/width/height` (no storage key/bucket/uploader) and is only ever surfaced through a **time-limited signed URL** (`config.mediaSignedUrlTtlSeconds`, `publicSiteService.ts:38`); a `PRIVATE` or non-`ACTIVE` media row is silently treated as "no image" (`publicSiteService.ts:36`), never leaked or errored.
- `publicProductService.ts` (`projectProduct` L16-27, `projectModule` L29-38): explicit field list, excludes `createdById/updatedById/configuration` per its own doc comment (L6-9); only `status: "ACTIVE"` products/modules are ever returned (L42, L48, L54).
- `publicLeadService.ts` (`createLead` L33-66): the only write path. Organization is **always** `config.publicWebsiteOrganizationId` from server env, never caller input (L38); includes a honeypot field (`input.website`) that silently discards the submission while returning the identical success response either way (L34-36, `publicRoutes.ts:115-118`), so a bot cannot distinguish acceptance from rejection.
- The one write route (`POST /leads`) is both Zod-validated (`createPublicLeadSchema.parse`, `publicRoutes.ts:113`) and rate-limited (`publicLeadLimiter`, `publicRoutes.ts:111`, 5 requests / 15 min / IP — `server/middleware/rateLimiter.ts:65-72`).

**Conclusion: `publicRoutes.ts` is genuinely safe for anonymous exposure** — no internal id/field leakage found in the three backing services. This matches the file's own header comment's claim (`publicRoutes.ts:1-10`), and the claim was independently verified against the actual service code, not taken on faith.

Also worth noting: CMS content resolution for the public site is scoped to a **single, server-configured `PUBLIC_WEBSITE_ORGANIZATION_ID`** (`server/config/env.ts:90-97`), never a caller-supplied organization — if unset, public content degrades to empty results rather than guessing a tenant (`publicSiteService.ts:42-44`, `84`, `91`, `119`, `125`). `Product`/`ProductModule` are intentionally global (no `organizationId` at all — `prisma/schema.prisma:686-696` doc comment), so the public product catalog needs no such resolution.

### Unused / duplicated routes

- **`POST /api/v1/webhooks/leads`** (`webhookRoutes.ts`) and **`POST /api/v1/public/leads`** (`publicRoutes.ts`) both create/record a "lead" but via completely different code paths: the webhook route only records a `WebhookEvent` row for idempotency/audit and explicitly defers "business processing (CRM auto-triage...)" to a future phase (`webhookService.ts:106-110`) — **it never actually creates a `Lead` row**, while `publicLeadService.createLead` does create a real `Lead`. The marketing site (`artifysolscom/src/lib/publicApi.ts:165`) calls `/public/leads`, **not** `/webhooks/leads`. NOT VERIFIED: no caller of `/api/v1/webhooks/leads` was found anywhere in either repo searched (`Artify-Backend`, `artifysolscom`) — this endpoint appears to be either a legacy/future-integration surface (e.g. a third-party lead-gen webhook provider) or effectively dead code today. Recommend confirming with the team whether any external system still posts to it.
- All other route files were cross-checked against `src/lib/api.ts` (Control Center frontend) and found to have live callers; a full line-by-line call-graph diff was not performed for all 38 files due to scope — this is noted as **partially verified**, not exhaustively verified.
- `crmRoutes.ts` (`/crm/summary`) is a thin aggregation over `leadService`/`clientService` and is not a duplicate of `leadRoutes`/`clientRoutes` — it composes counts from them (`crmRoutes.ts:19-24`).

---

## 3. Database / Prisma Schema

`prisma/schema.prisma`, 2556 lines, 66 models (`grep -c "^model "` = 66; enumerated via `grep -n "^model "`).

### Domain model summary (grouped)

- **Identity / RBAC (10 models):** `Organization`, `User`, `OrganizationMembership`, `Role`, `Permission`, `RolePermission`, `Session`, `PasswordResetToken`, plus audit (`AuditLog`) and inbound-integration trust (`WebhookEvent`).
- **CRM (4):** `Lead`, `Client`, `Contact`, `ClientOnboarding` (+ `WorkspaceInvitation` for client-admin provisioning).
- **Product catalog (2):** `Product`, `ProductModule` — deliberately **global/non-tenant-scoped** (`schema.prisma:686-696`).
- **CMS (7):** `Author`, `Category`, `Tag`, `Page`, `Post`, `PostTag`, `ContentRevision`.
- **Commercial/billing (5):** `Contract`, `ContractVariation`, `Subscription`, `SubscriptionItem`, `Invoice`, `InvoiceItem`, `Payment` (7, listing corrected).
- **Media (2):** `MediaAsset`, `MediaUploadSession`.
- **Notifications/settings (3):** `Notification`, `NotificationPreference`, `SystemSetting`.
- **AI Control Center / governance (11):** `AIProvider`, `AIModel`, `AITool`, `AIOrgToolSetting`, `AIPromptTemplate`, `AIPromptVersion`, `AIWorkflow`, `AIExecution`, `AIToolExecution`, `AIUsageRecord`, `AIApprovalRequest`.
- **Automation (9):** `AutomationWorkflow`, `AutomationWorkflowVersion`, `AutomationExecution`, `AutomationStepExecution`, `AutomationSchedule`, `AutomationEvent`, `AutomationApproval`, `AutomationTask`, `AutomationActionExecution`, `AutomationNotification`.
- **Knowledge/RAG (8):** `KnowledgeCollection`, `KnowledgeSource`, `KnowledgeDocument`, `KnowledgeDocumentVersion`, `KnowledgeChunk`, `KnowledgeEmbedding`, `KnowledgeIngestionJob`, `KnowledgeSearchLog`.
- **Copilot (4):** `CopilotWorkspace`, `CopilotConversation`, `CopilotMessage`, `CopilotActionPreview`, `CopilotUsage` (5, corrected).

### Tenant isolation pattern

Every tenant-scoped table carries an explicit `organizationId` (or `organization_id`) foreign key, per the schema's own architectural comment (`schema.prisma:50-54`), and this was independently spot-checked as true for `User` (L146, indexed L222), `Lead` (L460, indexed L479), `Client` (L514, indexed L541), `Contact` (L562, indexed L578), `Page`/`Post` (L1120/L1146, composite-indexed with `status` L1140/L1171), all AI/Automation/Knowledge models (e.g. `KnowledgeDocument.organizationId` L2251, indexed L2279). `Product`/`ProductModule` are the one deliberate, documented exception (global catalog).

Enforcement at the query layer (not just schema) was independently confirmed:
- `invoiceRepository.findByIdInOrg` — `prisma.invoice.findFirst({ where: { id, organizationId } })` (`server/repositories/invoiceRepository.ts:49-50`).
- Route-to-service call passes `req.user!.organizationId` (session-derived), never a client param, e.g. `invoiceRoutes.ts:54`, `userRoutes.ts:20-24` (the one place a client-supplied `organizationId` query param is honored, it is explicitly gated to `SUPER_ADMIN` only — `userRoutes.ts:18-21`).

### Soft-delete pattern

Mixed, and documented as intentionally mixed: `User`, `Lead`, `Client`, `Contact`, `Page`, `Post` have a `deletedAt DateTime?` column (soft delete). `Contract` deliberately has **no** `deletedAt` — the schema comment explains this is intentional: a contract's existence is a permanent fact of record, tracked via `status` lifecycle instead (`schema.prisma:786-791`). `Product`/`ProductModule` similarly never physically delete; lifecycle is via `status` enum only (`schema.prisma:694-696`, `740-741`). This is a deliberate, documented design choice, not an inconsistency.

### Audit logging

`AuditLog` model (`schema.prisma:382-407`) is append-only **by application convention** — no update/delete repository method exists, and this is asserted by a test (`tests/security/audit.test.ts`, referenced in the schema comment L378; NOT independently re-verified line-by-line in this pass, but the repository file `auditLogRepository.ts` was confirmed to expose no update/delete method during earlier grep). A DB-role-level `REVOKE UPDATE/DELETE` grant is explicitly flagged as **not yet done** — "a Phase 16 deployment hardening step" (`schema.prisma:379`) — i.e. append-only is enforced in application code only, not at the database privilege level. **This is a real, self-acknowledged gap**: a compromised app-tier credential (e.g. leaked `DATABASE_URL`) could still tamper with audit history.

### Indexes — high-cardinality lookup fields

- `User.email` is `@unique` (`schema.prisma:147`) → Postgres auto-creates a unique index, so login-by-email lookups are indexed. Good.
- `Organization.slug` and `Product.slug`/`Product.code` are `@unique` (indexed).
- `Page`/`Post` slugs: **not globally unique**, but `@@unique([organizationId, slug])` (composite, `schema.prisma:1139`, `1170`) — correctly indexed for the actual lookup pattern (slug within a tenant).
- **Gap found:** `Lead.email` and `Client.email`/`Contact.email` have **no index** (`schema.prisma:463`, `519`, `566` — plain `String?` columns, no `@@index` referencing them). These are plausible high-cardinality lookup/search fields (e.g. "find lead by email" for dedup) that would table-scan at scale. This is a genuine, verifiable gap — not present in the doc comments as an acknowledged tradeoff, unlike the soft-delete/audit gaps above.
- `WorkspaceInvitation.email` **is** indexed (`schema.prisma:663`).

### Migration history health

```
20260919210457_init_identity_webhook_foundation
20260920000001_phase2_core_data_model
20260921000001_phase3_auth_rbac
20260921100313_phase12_ai_control_center
20260922000001_phase5_crm
20260923000001_phase6_onboarding_workspace
20260924000001_phase7_product_catalog
20260925000001_phase8_cms_indexes
20260926124939_phase13_14_15_automation_knowledge_copilot
20260926131423_add_knowledge_retrieval_step_type
20260928000001_phase9_media_library
20261001000000_phase10_enum_values
20261001000001_phase10_commercial_billing
```

12 migrations (+ `migration_lock.toml`), sequential timestamps, no gaps observed. **One inconsistency worth flagging:** the migration folder named `20260921100313_phase12_ai_control_center` is timestamped *between* `phase3_auth_rbac` (20260921000001) and `phase5_crm` (20260922000001) — i.e. "Phase 12" was applied to the database chronologically fourth, well before "Phase 5" through "Phase 11." This means the migration folder names' "Phase N" labels do not reflect actual chronological application order; they reflect a documentation/roadmap numbering scheme applied retroactively or out of sequence during development. This is cosmetic (Prisma applies migrations by folder-name lexical/timestamp order regardless of the "phase" label, so there is no functional risk), but it could confuse anyone reconstructing history from migration names alone. Migrations were not executed as part of this audit (read-only).

---

## 4. Auth & Authorization (RBAC)

### Session/token scheme

- Bearer tokens (`art_sess_<64 hex chars>`, `server/utils/crypto.ts:10-12`), generated via `crypto.randomBytes(32)`.
- Stored **hashed** at rest (`Session.tokenHash`, `schema.prisma:318`) via plain SHA-256 (`hashToken`, `crypto.ts:30-32`) — the code explicitly justifies fast-hash-is-OK-here reasoning (already-high-entropy random token, unlike a password) and contrasts it with `server/utils/password.ts`, which correctly uses bcrypt (cost factor 12, `password.ts:12-15`) for actual passwords.
- Session TTL: `SESSION_TTL_HOURS` env var, default 24h (`env.ts:81`, applied in `authService.ts:42-44`).
- Account lockout: `ACCOUNT_LOCKOUT_THRESHOLD` (default 5) / `ACCOUNT_LOCKOUT_DURATION_MINUTES` (default 15) (`env.ts:82-83`); enforced in `authService.login` via `userRepository.isLocked`/`recordFailedLogin` (`authService.ts:80-114`).
- Every session is **re-verified against live `OrganizationMembership` status on every request**, not trusted from the token alone (`authService.verifySession`, `authService.ts:231-248`) — if an admin revokes a membership mid-session, the very next request fails, by design (comment at `authService.ts:238-241`).
- Login failure is a generic, identical error for "no such user" and "wrong password" (user-enumeration hardening, `authService.ts:73-78`).
- Password reset similarly never reveals whether an email exists (`authService.ts:326-330`), and in production returns no token in the response body at all — a real email-delivery integration point is explicitly marked as not-yet-built (`authService.ts:355-358`); non-production returns a `devToken` for testability.

### Permission model

`server/types/domain.ts` defines `PERMISSION_KEYS` — **103 distinct permission keys** (counted via `grep -oE '"[a-z_]+\.[a-z_]+"' server/types/domain.ts | sort -u | wc -l`), dot-namespaced by module (e.g. `users.read`, `invoices.issue`, `knowledge.upload`). `SUPER_ADMIN` bypasses all permission checks (`server/middleware/auth.ts:66`, `77`, `91`, `115` — every guard function special-cases this role).

**Enforcement is genuinely server-side, not just UI-hiding.** The Control Center frontend's `src/lib/permissions.ts` says this explicitly in its own header comment (`permissions.ts:1-9`): *"this is UX only... every action below still calls a route protected by requirePermission/requireRole server-side... not to be the source of truth for what's allowed."* This was independently verified by checking the actual backend route files, not just trusting the comment:

- **User management** — `POST /users`, `PATCH /users/:id` require `requirePermission("users.create")` / `("users.update")` (`server/routes/v1/userRoutes.ts:39`, `49`).
- **RBAC/roles** — `GET /roles`, `GET /permissions` both require `requirePermission("roles.read")` (`server/routes/v1/roleRoutes.ts:15`, `28`); a dedicated security-regression test explicitly asserts a non-SUPER_ADMIN caller is rejected for a `roles.create`-gated route and for a SUPER_ADMIN-only route (`tests/security/authz.test.ts:113-126`).
- **Billing/invoices** — every invoice/payment route is individually permission-gated: `invoices.read` (list/get), `invoices.create`, `invoices.update`, `invoices.issue`, `invoices.void`, `payments.read`, `payments.create` (`server/routes/v1/invoiceRoutes.ts:27,52,61,71,81,91,101,110`) — seven distinct permissions for one resource, not one blanket "invoices" flag.

### Tenant-isolation verification (server-side, not client-trusted)

Checked 3 read/update endpoints end-to-end from route → service → repository → Prisma `where` clause:

1. **`GET /invoices/:id`** → `invoiceService.getInvoice(req.user!.organizationId, id)` (`invoiceRoutes.ts:54`) → `invoiceRepository.findByIdInOrg(id, organizationId)` → `prisma.invoice.findFirst({ where: { id, organizationId } })` (`invoiceRepository.ts:49-50`). `organizationId` originates from `req.user!.organizationId`, which is set once at auth time from the verified session (`server/middleware/auth.ts:46`), never from `req.params`/`req.query`/`req.body`.
2. **`GET /users`** → explicitly the exception that proves the rule: a client-supplied `organizationId` query param is honored **only if** `req.user!.role.key === "SUPER_ADMIN"`; every other caller is forced to their own session organization regardless of what they pass (`userRoutes.ts:18-24`).
3. **`enforceTenantIsolation` / `enforceRecordOwnership`** middleware (`server/middleware/auth.ts:89-124`) is a generic, reusable guard: it rejects any request whose `organizationId` (from params/query/body) doesn't match the caller's session organization, with a `TenantIsolationError`. A dedicated security-regression suite tests both directions of horizontal privilege escalation (tenant A → tenant B and B → A) plus the "no organizationId filter = scope to caller's own org" default case (`tests/security/authz.test.ts:128-154`).

**Overall RBAC/tenant-isolation assessment: strong and independently verified**, not merely asserted by comments. The one caveat is the DB-privilege-level audit-log immutability gap noted in §3.

---

## 5. Security Controls

### CORS

`server/middleware/security.ts:16-35`. `corsOptions.origin` callback: requests with no `Origin` header (curl, server-to-server) are allowed through (L18-22); a browser-supplied origin is checked against `config.corsOrigins` (parsed from the `CORS_ORIGINS` env var, comma-split, trimmed — `server/config/env.ts:35-43`); anything not in that explicit allow-list is **rejected** with a logged warning (`security.ts:27-28`) and no `Access-Control-Allow-Origin` header is set for it. `credentials: true` is set, so this matters — the origin check is the actual security boundary, not merely cosmetic. Production/staging environments additionally **hard-fail at boot** (`process.exit(1)`) if `CORS_ORIGINS` contains `*` (`env.ts:119-125`) — a wildcard is structurally impossible to ship to production. This is the code that "correctly rejects disallowed origins" referenced in the task brief.

### Rate limiting (`server/middleware/rateLimiter.ts`)

| Limiter | Window | Limit | Keyed by | Applied to |
|---|---|---|---|---|
| `generalApiLimiter` | 15 min | 300 | IP (default) | All of `/api` (`app.ts:33`) |
| `authLimiter` | 15 min | 10 | IP + attempted email | `/auth/login`, `/auth/register` (per file comment L28) |
| `webhookLimiter` | 5 min | 100 | IP (default) | `/webhooks/leads` |
| `passwordResetLimiter` | 60 min | 5 | IP + email | Password reset request/confirm |
| `publicLeadLimiter` | 15 min | 5 | IP only | `POST /public/leads` |
| `sensitiveActionLimiter` | 15 min | 20 | user id or IP | Change-password, org switch |
| `aiExecutionLimiter` | 5 min | 30 | user id or IP | AI tool/workflow execution |

Store is **in-memory** (`express-rate-limit` default) — the file's own comment flags this as fine for a single instance but not yet safe across multiple instances/serverless cold-starts; a shared store (Redis) is explicitly deferred to a later phase (`rateLimiter.ts:6-10`). **On Vercel serverless specifically, in-memory rate limiting is materially weaker than documented**, since each function invocation can run in a different, freshly-cold container with its own empty limiter state — this is a real gap for the Vercel deployment target, not fully addressed by the comment's "single instance" framing (Vercel is not single-instance).

### Webhook signature verification

`server/services/webhookService.ts` and `server/utils/crypto.ts:57-66`. HMAC-SHA256 over `${timestamp}.${rawBody}` (binds a replay window, `webhookService.ts:69`), hex-encoded, **constant-time compared** via `crypto.timingSafeEqual` (`crypto.ts:65`) — buffer-length is checked before calling `timingSafeEqual` to avoid its own length-mismatch throw (`crypto.ts:64`). A missing/malformed signature or timestamp is rejected before comparison, never defaults to "verified" (`webhookService.ts:54-61`) — the file's comment explicitly documents this as the fix for a prior real vulnerability (Phase 0 finding S3/R3: old code defaulted `isVerified = true`). Replay window is 5 minutes (`webhookService.ts:28`), and duplicate deliveries are additionally rejected via a `(provider, deliveryId)` uniqueness constraint at the repository level (idempotency, independent of the timestamp check).

### Input validation (Zod at route boundaries)

Sampled and confirmed `schema.parse(req.body/query)` runs **before** any DB touch in:
- `publicRoutes.ts:113` (`createPublicLeadSchema.parse`) before `publicLeadService.createLead`.
- `userRoutes.ts:41` (`createUserSchema.parse`) before `userService.createUser`.
- `invoiceRoutes.ts:63` (`createInvoiceSchema.parse`) before `invoiceService.createInvoice`.
- `webhookRoutes.ts:14` (`leadWebhookPayloadSchema.parse`) before signature verification/persistence.

**Gap found:** `server/routes/v1/knowledgeRoutes.ts` and `server/routes/v1/copilotRoutes.ts` have **zero** `.parse()` calls (`grep -c "\.parse("` = 0 for both files, cross-checked against every other route file, which all have ≥1). These routes read `req.body` fields directly (e.g. `knowledgeRoutes.ts:39-47`, `68-76`, `149`) with no schema validation layer — type coercion and bounds-checking, where it exists at all, happens ad hoc inside the service/route (e.g. `parseInt(String(limit), 10)` at `knowledgeRoutes.ts:203`). This is a genuine input-validation inconsistency versus the rest of the codebase, consistent with these files' own header comments stating they were "imported... adapted" from a different source repo without full alignment to this repo's conventions (`knowledgeRoutes.ts:3-9`, `copilotRoutes.ts:2-7`).

### File upload / object storage

- MIME allow-list: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/svg+xml`, `application/pdf` only (`server/utils/fileSignature.ts:9-11`).
- **Magic-byte verification**, not just claimed Content-Type/extension: `verifyFileSignature` checks actual file header bytes against known signatures for JPEG/PNG/GIF/PDF, parses WEBP's RIFF/WEBP container bytes 0-3 and 8-11 (`fileSignature.ts:70-74`), and validates SVG by sniffing for an XML/`<svg` prefix rather than a binary signature (`fileSignature.ts:49-51`). This runs before a media row is marked `ACTIVE` (per the file's header comment, `fileSignature.ts:1-6`).
- Size limits: `MEDIA_MAX_IMAGE_SIZE_BYTES` (default 10MB), `MEDIA_MAX_DOCUMENT_SIZE_BYTES` (default 25MB) — `server/config/env.ts:73-74`.
- Access: `createSignedReadUrl` with a bounded TTL (`MEDIA_SIGNED_URL_TTL_SECONDS`, default 900s, `env.ts:75`) is the only way media is ever surfaced, both on the public site (`publicSiteService.ts:38`) and (assumed, NOT independently re-verified for every Control Center media call) internally — i.e. **not** a permanently-public bucket URL. `s3CompatibleProvider.ts:43-45` implements this via AWS SDK's `getSignedUrl`.
- Production/staging **cannot** boot with the local-filesystem storage provider (`OBJECT_STORAGE_PROVIDER=none`) — this is a hard `superRefine` validation failure at startup (`env.ts:143-153`), preventing an accidental dev-only storage backend from reaching production.

### Secrets scan

Searched for common leaked-credential patterns (`sk-...`, `AIza...`, `postgresql://user:pass@...`, PEM private key headers) across all tracked source files (`.ts`, `.tsx`, `.json`, `.env*`), excluding `node_modules`:

- **No API keys or PEM keys found** in any TypeScript/JSON source file.
- Two hits, both benign: `./.env:3` and `./.env.test:3` contain a **local-only** Postgres connection string (`postgresql://artify_dev:artify_dev_local_only@localhost:5432/...`) pointing at `localhost` — these are local development credentials, not production secrets, and `git ls-files | grep -i '\.env'` confirms **neither `.env` nor `.env.test` is tracked by git** (`.gitignore:6` excludes `.env*`, only `.env.example` is allow-listed and tracked). No secret exposure via version control was found.
- `server/config/env.ts:19` hard-codes a **known-compromised** webhook secret value (`"artify_whsec_prod_2026_soc2"`) purely as a **denylist check** — if a deployer's real `WEBHOOK_SECRET` env var matches this exact string, boot fails (`env.ts:102-109`). This is a defensive control, not a live secret.

**Conclusion: no hardcoded production secrets found in source.**

---

## 6. CRM / CMS / Automation / Knowledge / Copilot Capabilities

### CRM

Pipeline/stage concept: `enum LeadStatus { NEW, CONTACTED, QUALIFIED, CONVERTED, LOST }` (`prisma/schema.prisma:440-446`) — a real, enforced state field on `Lead.status` (L466), not a UI-only convention. Conversion is a first-class operation: `Lead.convertedClientId`/`convertedAt` (L469-470) link a converted lead to the resulting `Client` row, and a dedicated integration test exists (`tests/integration/leadConversion.test.ts`). **Real, working feature** — tested, schema-enforced.

### CMS

`Page`/`Post` models both carry `status: ContentStatus` (draft/published lifecycle — enum not fully re-read in this pass but referenced consistently, e.g. `@@index([organizationId, status])`), `publishedAt` and `scheduledAt` (`schema.prisma:1123,1127-1128`, `1149,1155-1156`) — i.e. **scheduling is a real schema field**, not just a status flag. `ContentRevision` (`schema.prisma:1197-1219`) is a shared, immutable-once-published revision history table for both Pages and Posts, with SEO/meta stored in a flexible `metadata Json` field per revision (`schema.prisma:1205`, surfaced to the public API as `seo` in `publicSiteService.ts:52,70`) — this covers title/description/canonical/OG-style fields generically via JSON rather than dedicated columns; the exact SEO field names/shape were **NOT independently verified** (no schema-level enforcement of which keys `metadata` must contain — it's an unstructured JSON blob, so SEO field completeness is a service/UI-layer convention, not a DB guarantee). Real, tested feature (`tests/integration/pages.test.ts`, `posts.test.ts`, `mediaCmsIntegration.test.ts`).

### Automation

Engine lives in `server/services/automation/` (10 files: `ActionRegistry.ts`, `ApprovalEngine.ts`, `AutomationService.ts`, `ConditionEngine.ts`, `EventEngine.ts`, `NotificationEngine.ts`, `SchedulerEngine.ts`, `TaskManager.ts`, `WorkflowEngine.ts`, `WorkflowValidator.ts`). `ActionRegistry.ts` registers 9 concrete business actions (`registerAction` calls at lines 72, 124, 159, 222, 252, 272, 297, 316, 339). `SchedulerEngine.ts` supports `ONE_TIME` / `RECURRING` / `CRON`-typed schedules (`SchedulerEngine.ts:76,99-102`). An approval-gate concept exists (`ApprovalEngine.ts`, human-in-the-loop step approval, `requestApproval` L34-38). Tenant isolation is explicitly tested: `tests/integration/automation.test.ts:133` — *"enforces tenant isolation on workflows and executions."* **Real, tested feature.**

**Architectural inconsistency (flagged for §9 too):** there are **two separate, non-unified approval-gate implementations** — `AIApprovalRequest` (Phase 12 AI Control Center governance model, `schema.prisma:1755`) and `AutomationApproval` (Phase 13 automation engine, `schema.prisma:2043`). `ApprovalEngine.ts`'s own header comment (L4-14) explicitly documents this: the source repo this was imported from mirrored decisions into the Phase 12 table, but this codebase **deliberately does not** do that because the two tables have different invariants (payload-hash tamper guard, HIGH-risk-always-required semantics on the AI one) that the automation engine doesn't itself enforce — so automation approvals are kept in their own table. This is self-documented technical debt, not a hidden bug, but it does mean **there is no single unified "all pending approvals" view across AI actions and automation workflows** at the data-model level.

### Knowledge (RAG)

`server/services/knowledge/`: `ChunkingEngine.ts`, `ContextBuilder.ts`, `EmbeddingService.ts`, `ExtractionPipeline.ts`, `HybridSearchEngine.ts`, `KnowledgeService.ts` (399 lines). Full pipeline is real and schema-backed: `KnowledgeCollection` → `KnowledgeSource` → `KnowledgeDocument` → `KnowledgeDocumentVersion` → `KnowledgeChunk` → `KnowledgeEmbedding`, plus `KnowledgeIngestionJob` for progress tracking and `KnowledgeSearchLog` for query auditing. Access control is collection-level (`accessPolicy: KnowledgeAccessPolicy @default(RESTRICTED)`, `allowedRoles Json`, `schema.prisma:2207-2208`) and document-level (`securityScope`, `requiredRole`, `schema.prisma:2264-2265`).

Embeddings are stored as a **JSON array column** (`KnowledgeEmbedding.vector Json`, `schema.prisma:2342`), not a native `pgvector` column — despite `EmbeddingService.ts`'s own header comment claiming "pgvector query translation" (L5). Cosine similarity is computed **in application code** (`EmbeddingService.cosineSimilarity`, `EmbeddingService.ts:48-63`), not via a Postgres vector index/operator — this is a real mismatch between the file's doc comment and its actual implementation, and it means retrieval-at-scale (`HybridSearchEngine.ts`) likely pulls chunk rows into Node and scores them in memory rather than using an indexed ANN search. NOT independently verified at scale (no load test found), but the implementation as read cannot use a vector index because there isn't one.

Embedding generation itself has a working provider-adapter fallback: it tries the configured AI adapter (`getAdapter().generateEmbedding`) and, on failure, falls back to a **deterministic hash-based pseudo-embedding** (`EmbeddingService.ts:32-42`) rather than failing the request — reasonable for degraded-mode operation, but means "similarity search" quality is materially different (and lower) whenever the real adapter is unavailable or `AI_PROVIDER=none`, with no visible signal to the caller that this happened.

Tested: `tests/unit/knowledge/knowledgeService.test.ts` (381 lines), `tests/integration/knowledgeRoutes.test.ts` (130 lines). **Real, working feature**, with the caveats above (no schema validation at the route layer — see §5 — and application-level, not DB-level, vector similarity).

### Copilot

`server/services/copilot/CopilotService.ts` — workspace/conversation/message model (`CopilotWorkspace`, `CopilotConversation`, `CopilotMessage`, `CopilotActionPreview`, `CopilotUsage`). Integrates with the automation `WorkflowEngine` directly (`CopilotService.ts:872,878` — `workflowEngine.enqueueExecution` / `.execute`). Tested (`tests/integration/copilot.test.ts`, 182 lines). Same route-level validation gap as Knowledge (§5). **Real, working feature**, imported/adapted with the same documented caveats as Automation/Knowledge.

---

## 7. Testing & CI

### Test inventory (`tests/`, verified via `find`)

- **Unit (6 files):** `config.env.test.ts`, `crypto.test.ts`, `money.test.ts`, `password.test.ts`, `requestId.test.ts`, `storageProvider.test.ts`, plus `unit/knowledge/knowledgeService.test.ts`.
- **Integration (34 files):** one per resource area — auth, users, clients, contacts, contracts, invoices, subscriptions, payments, leads (+ `leadConversion`), onboarding, workspace provisioning, invitations, products, product modules, pages, posts, categories/tags, authors, media (+ `mediaCmsIntegration`, `mediaConcurrency`, `mediaSecurity`), organization switching, password management, portal, public API, AI catalog/workflows, automation, knowledge routes, copilot, CRM dashboard, "control center APIs" (general), schema constraints, health.
- **Security (5 files, 854 lines total):** `aiGovernance.test.ts` (202), `authBypass.test.ts` (132), `authz.test.ts` (156 — vertical + horizontal privilege escalation, tenant isolation, both directions), `rbacAndAudit.test.ts` (201), `webhook.test.ts` (163).

Coverage assessment (from file presence + spot-read content, not a coverage-tool report — **NOT VERIFIED via actual coverage metrics**, this pass did not run the test suite):
- Tenant isolation is explicitly tested at the middleware level (`authz.test.ts`) **and** re-tested per-feature in automation (`automation.test.ts:133`). It was **not** confirmed whether every single one of the 38 route files has its own dedicated tenant-isolation test — this would require reading all 34 integration files in full, which was out of scope for this pass; the middleware-level test gives reasonable but not exhaustive confidence.
- No dedicated test file targets `knowledgeRoutes.ts`'s missing Zod validation (§5) — the existing `knowledgeRoutes.test.ts` tests functional behavior, not input-validation edge cases (malformed body, oversized payload, wrong types) the way, e.g., `webhook.test.ts` clearly does for its area.
- No frontend component/unit test folder equivalent depth was reviewed in this pass beyond confirming `src/lib/permissions.test.ts` exists and `vitest.frontend.config.ts` is a separate config — frontend test coverage was not assessed in depth (out of the requested backend-audit scope, noted for completeness).

### CI (`.github/workflows/ci.yml`)

Single job, real Postgres 16 service container (not mocked, `ci.yml:17-30`). Steps, in order: install → `prisma generate` → `prisma migrate deploy` (applies the actual migration files against the CI database — this **does** function as a migration-integrity check, since a broken/invalid migration would fail this step) → typecheck (frontend + backend, two `tsc` invocations, `ci.yml:60-61`) → lint (backend only — `eslint server --ext .ts`, `package.json` script; **frontend/`src/` is not linted in CI**) → unit tests → integration tests → security tests → build (frontend + backend bundle) → `npm audit --audit-level=high` with **`continue-on-error: true`** (`ci.yml:80`, explicitly non-blocking, tracked as a known gap per the inline comment referencing `docs/CI_CD.md`).

Gaps identified directly from the workflow file:
- **No E2E/browser test step.**
- **Dependency audit does not gate merges** (`continue-on-error: true`) — a high/critical CVE in a dependency would not fail CI today.
- **No separate "migration drift" check** beyond `migrate deploy` succeeding — this confirms migrations apply cleanly but does not, e.g., diff the Prisma schema against migration history to catch an un-migrated schema change (`prisma migrate diff` / `prisma migrate status` are not invoked).
- **`src/` (Control Center React frontend) is not linted** — only `server/` is (`package.json` `lint` script: `eslint server --ext .ts`).
- `test:frontend` exists as an `npm` script (`package.json`) but is **not invoked anywhere in `ci.yml`** — frontend unit tests do not currently run in CI. Verified by grepping `ci.yml` for `test:frontend` (no match).
- Runs only on `push` to `main`/`claude/**` and `pull_request` into `main` (`ci.yml:7-11`) — a PR from a branch other than one matching those triggers targeting `main` is still covered (the `pull_request` trigger has no branch-name restriction on the source), so this is fine; noted only for completeness.

---

## 8. Observability / Logging / Background Jobs

### Logging

Structured JSON logging via **pino** (`server/core/logger.ts`), confirmed (not assumed from a doc). Explicit secret/PII redaction paths configured (`password`, `passwordHash`, `Authorization`/`Cookie` headers, `*.token`, `*.apiKey`, `*.secret`, `*.cardNumber`, `*.cvv`, etc. — `logger.ts:14-33`) — this directly addresses a documented prior incident (raw PII logged to stdout, referenced in the file's own comment `logger.ts:4`).

Request-ID correlation: `server/middleware/requestId.ts` (assigns `req.requestId`, not independently re-read in full this pass but referenced and used consistently) feeds into `requestLogger` (`pino-http`, `server/middleware/requestLogger.ts:12` — `genReqId: (req) => req.requestId`), and every log line additionally carries `actorId`/`organizationId` custom props (`requestLogger.ts:18-21`) and the header is exposed back to the client (`exposedHeaders: ["X-Request-Id"]`, `security.ts:33`) and accepted as an allowed CORS header (`security.ts:32`) — i.e. a client (including the separate marketing site) can pass/receive a correlation id, and every downstream log line for that request carries it. **Confirmed end-to-end correlation design**, not independently traced through an actual running request (no live server was started during this read-only audit).

### Background jobs / queue mechanism

**There is no queue/worker infrastructure independent of the Express process itself** — confirmed by grepping the whole `server/` tree and `package.json` for `bullmq`, `bull`, `agenda`, `sqs`, `pubsub`, `node-cron`, `worker_threads`: no matches for any real external queue library or worker-thread usage.

What exists instead is a **self-hosted, in-process poller**: `server/services/automation/WorkflowEngine.ts` runs a `setInterval`-based background loop (`start()`/`startWorker()`, L59-68) that calls `processQueue()` (L146-157), which pulls up to 5 `QUEUED` `AutomationExecution` rows from Postgres and executes them in-process.

**Confirmed this worker is actually started, not just defined.** `AutomationService`'s private constructor (`AutomationService.ts:36-38`) calls `this.initSchedulerIntegration()`, which itself calls both `schedulerEngine.start()` and `workflowEngine.startWorker()` (`AutomationService.ts:103-114`). `AutomationService` is a singleton (`getInstance()` pattern) exported as `automationService` and imported at the top of `server/routes/v1/automationRoutes.ts:15`, which is itself imported eagerly by `server/routes/v1/index.ts:59` — i.e. **the singleton is constructed, and the `setInterval` worker started, as a side effect of the routes module simply being loaded**, on every process/invocation that builds the app via `createApp()`. This happens identically on both deployment targets (§1).

- **On Railway/Docker** (`server.ts`, long-lived process): this works as intended — one `setInterval` loop runs for the process lifetime, continuously draining `QUEUED` automation executions.
- **On Vercel serverless** (`vercelHandler.ts`, stateless-per-invocation): the same singleton construction and `setInterval` registration happens on **every cold-start invocation**, but the function's execution context is frozen/torn down once the HTTP response is sent — a `setInterval` has no guarantee of ever firing again after that point, and Vercel makes no guarantee an instance stays "warm" between requests. So `enqueueExecution()` calls (e.g. from `AutomationService.ts:81,105,410`, `CopilotService.ts:872`) can insert `QUEUED` rows that are **never reliably picked back up** by this in-process poller on Vercel — they would only progress if some other, unrelated invocation happens to still be warm and its interval happens to fire, which is not a deliberate design, just incidental serverless-platform behavior.

**This is a genuine, verified architecture/deployment-target mismatch**, not a hypothetical: the codebase explicitly supports both deployment targets (§1), and the automation background-worker starts identically on both, but is only reliably functional on the long-lived one. Recommend the team confirm which target is actually used in production for automation/copilot-triggered workflow executions, since the answer determines whether queued automation work silently stalls in production today.

### Inline embedding generation (flagged per task brief)

Confirmed directly in `server/services/knowledge/KnowledgeService.ts:231-250` (`ingestDocument`): after extraction and chunking, the method **loops over every chunk sequentially and `await`s `EmbeddingService.generateEmbedding()` + `EmbeddingService.storeEmbedding()` for each one, inline, within the same HTTP request/response cycle** (the `POST /knowledge/documents/upload` handler, `knowledgeRoutes.ts:144-179`, awaits `KnowledgeService.ingestDocument` directly and only responds once it fully completes). There is no job/queue hand-off — the entire extract→chunk→embed→persist pipeline runs synchronously per request.

**This is a real timeout risk on Vercel's serverless function time limits** for any document that produces more than a small number of chunks, especially if the configured AI adapter's embedding call has any real network latency (the deterministic fallback, `EmbeddingService.ts:32-42`, is fast/local, but the intended real-adapter path — Gemini, per `AI_PROVIDER=gemini` — is a network call per chunk, sequential, not batched or parallelized). A document with, say, 100 chunks and a 200-400ms per-embedding network round-trip would take 20-40+ seconds synchronously, which risks Vercel's default/Hobby-tier function timeout (typically 10-60s depending on plan) well before a large document finishes. This matches the task brief's own flagged concern and was independently confirmed in the actual code path, not assumed.

---

## 9. Technical Debt / Inconsistencies

1. **Two non-unified approval-gate data models** (`AIApprovalRequest` vs `AutomationApproval`) — self-documented in `ApprovalEngine.ts:4-14`, see §6.
2. **Knowledge/Copilot routes bypass the Zod-at-the-boundary convention** used everywhere else (§5) — `knowledgeRoutes.ts` and `copilotRoutes.ts` have zero `.parse()` calls, and a few handlers call `prisma` directly from the route file instead of through a repository (§1), breaking the otherwise-consistent route→service→repository layering. Both files' own header comments attribute this to being "imported/adapted" from a different source codebase.
3. **`EmbeddingService.ts`'s doc comment claims "pgvector query translation"** (`EmbeddingService.ts:5`) but the actual schema stores vectors as JSON (`schema.prisma:2342`) and similarity is computed in application code (`EmbeddingService.ts:48-63`) — the comment does not match the implementation.
4. **`POST /api/v1/webhooks/leads` appears to be dead or orphaned** — it records an event but never creates a `Lead`, and no caller was found in either this repo or the `artifysolscom` marketing-site repo, which uses `/public/leads` instead (§2). Worth confirming with the team rather than assuming it's safe to remove.
5. **Migration folder "Phase N" labels are out of chronological order** relative to their own timestamps (`20260921100313_phase12_ai_control_center` applied before `phase5`/`phase6`/.../`phase11`) — cosmetic/documentation confusion only, no functional migration-ordering risk (§3).
6. **Audit-log immutability is enforced only in application code, not at the database privilege level** — explicitly flagged as a deferred "Phase 16" hardening step in the schema's own comment (`schema.prisma:379`). A leaked `DATABASE_URL` could tamper with audit history today.
7. **Automation's in-process `setInterval` queue worker is architecturally incompatible with the Vercel serverless deployment target** the codebase otherwise explicitly supports (§8) — not confirmed whether this is a live production issue or an accepted Railway-only limitation.
8. **Missing indexes on `Lead.email`/`Client.email`/`Contact.email`** (§3) — a plausible lookup/dedup field with no index, unlike the otherwise consistently-indexed schema.
9. **CI does not run frontend unit tests** (`test:frontend` script exists but is unused in `ci.yml`) and **does not lint the frontend** (`src/`) — only `server/` is linted (§7).
10. **Dependency vulnerability audit is non-blocking in CI** (`continue-on-error: true`, `ci.yml:80`) — a high/critical severity dependency CVE would not fail a build today.

---

## Summary of confidence levels

- **High confidence, directly verified in code:** architecture/layering, route catalog + auth/tenant-scoping table, public-route field projection safety, Prisma schema domain model + tenant isolation pattern + indexes, auth service design (hashing, lockout, session re-verification), CORS/rate-limiting/webhook-HMAC/upload-validation implementations, secrets scan, CI workflow contents, background-job/queue absence, inline embedding generation in `KnowledgeService.ingestDocument`.
- **Partially verified / stated explicitly as such above:** exhaustive frontend-to-backend route call-graph (spot-checked, not exhaustive for all 38 route files); exact `ContentStatus`/SEO-field enum contents (referenced but not fully re-read); test-coverage depth per individual route file (inferred from file presence + targeted reads, not a coverage-tool run); frontend test/lint scope (noted as out of primary scope but flagged as a CI gap).
- **Not verified (explicitly, per instructions, rather than guessed):** live behavior under actual deployment (no server was started); whether the CI `pull_request` trigger's lack of a source-branch filter has any practical gap; whether any external system currently calls the seemingly-orphaned `/webhooks/leads` endpoint.
