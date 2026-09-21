# Phase 12 Completion Report — AI Control Center & Governed Automation

Scope: a governed AI-automation subsystem — provider/model catalog, a tool registry with strict permission/tenant/risk-tier enforcement (every call goes through one dispatcher, `server/ai/governance.ts`), versioned prompt templates, bounded deterministic workflows, a human-approval gate that cannot be bypassed for HIGH-risk actions, usage/cost tracking, AI-specific audit logging, AI-specific rate limiting, and a full Control Center UI. No autonomous agent loop, no background/async execution, no live payment gateway changes — see `docs/PHASE_12_IMPLEMENTATION.md` for the exact boundary.

## Phase Status: **COMPLETE**

## Implemented
- **Governance dispatcher**: `server/ai/governance.ts` — the single choke point every AI tool call goes through (permission check against the tool's own `requiredPermission`, org enablement, Zod input validation, risk-based approval gate, execution, audit). No route, workflow runner, or approval-decision path calls a tool's handler directly.
- **Tool registry**: 10 real tools (`server/ai/toolRegistry.ts`) across READ_ONLY/LOW/MEDIUM/HIGH risk tiers, each a thin wrapper around an existing service (`leadService`, `clientService`, `postService`, `productService`, `invoiceService`, `contractService`) — no parallel AI-only business logic anywhere.
- **Financial-bypass prevention**: `invoices.issue`/`contracts.activate` are HIGH-risk and always approval-gated — no org override can turn this off. Directly verified: the invoice stays `DRAFT` through a tool call and through a rejection, and only becomes `ISSUED` once a caller holding `ai.approvals.decide` approves, executing as the original requester (not the approver).
- **Prompt templates**: versioned, immutable once created; publishing moves a template's `currentVersionId` pointer, never edits a version in place.
- **Workflows**: bounded (`maxSteps` ≤10, validated at both authoring and execution), deterministic, synchronous — stops at the first failed or approval-gated step, no retry/resume.
- **Approvals**: payload-hash tamper/replay guard, expiry, and a 409 on redeciding an already-decided request.
- **RBAC**: 22 new `ai.*` permission keys replacing the Phase 2 `ai.use`/`ai.manage` placeholders, granted per-role with the same read/author/execute/decide separation Phase 10 established for financial actions.
- **Control Center**: 8 new pages (Overview/Providers & Models/Tools/Prompt Templates/Workflows/Executions/Usage & Costs/Approvals) under a new "AI" nav section, all real API data, permission-gated per action.

## Architecture / Security Decisions
- The dispatcher checks a tool's own `requiredPermission` *in addition to* the route-level permission gate — a caller who can invoke AI actions in general but lacks a specific tool's underlying business permission is rejected inside the dispatcher even though the route already let the request through. Proven by a dedicated test, not assumed.
- HIGH risk and financial-bypass prevention are structural, not configuration: `resolveRequiresApproval` has no code path that returns `false` for a HIGH-risk tool, regardless of any `AIOrgToolSetting` row. An org's override can only *add* an approval requirement, never remove one a tool itself carries.
- Approving a request executes the action as the **original requester**, re-resolved via `authService.resolveSanitizedUserForOrganization` (newly exported for this purpose) — the approver authorizes, they do not become the actor. This keeps the audit trail's `actorUserId` honest and prevents an approver from silently laundering an action through their own, possibly broader, permissions.
- Every AI resource is tenant-isolated via `findByIdInOrg`-only repository methods, the same convention every prior phase's tenant-owned data follows — no bespoke AI-specific isolation mechanism was introduced.
- Prompt-template versions are immutable once created (no `updateVersion` method exists anywhere in the codebase) — the same "append, never mutate history" principle Phase 10 applied to `ContractVariation`/`Payment` rows.
- AI-attributed actions are recorded with `actorType: AI_COWORKER` / `actorName: ai-tool:<code>`, never `actorUserId` (that FK stays human-only) — the caller's real identity lives on `AIExecution.userId`/`AIApprovalRequest.requestedById` instead, so `audit.read` shows a complete, honestly-attributed history.

## Tests
- **Backend: 435/435 passing** (up from 408 at Phase 12's start), 44 files — 27 new this phase: `tests/integration/aiCatalog.test.ts` (12: provider/model/tool/prompt-template CRUD, permission tiers, duplicate-key rejection, org tool enablement toggle), `tests/integration/aiWorkflows.test.ts` (6: unregistered-tool rejection, step-count-vs-maxSteps validation, publish-before-execute enforcement, end-to-end multi-step execution, tenant isolation), `tests/security/aiGovernance.test.ts` (9: direct tool-call execution, route-vs-dispatcher permission layering, org tool disablement, execution/approval tenant isolation, and the financial-bypass-prevention suite — queue-not-execute, reject-leaves-untouched, approve-then-executes, decide-permission enforcement, double-decision rejection). 408 carried over unmodified.
- **Frontend: 171/171 passing** (up from 163), 27 files — 8 new: `AiToolsPage.test.tsx` (3: catalog rendering, permission-gated toggle visibility, toggle calls the API), `AiApprovalsPage.test.tsx` (3: pending-request rendering, permission-gated approve/reject visibility, approve calls the API), `AiOverviewPage.test.tsx` (2: per-permission section rendering, graceful degradation without a fabricated metric — mirroring `CrmDashboardPage`'s own test). 163 carried over unmodified.
- **Build**: backend TypeScript **PASS**, frontend TypeScript **PASS**, ESLint (`server`) **PASS**, frontend production build **PASS** (`vite build`).

## Governance Tests
- Permission layering: a caller with the general execute permission but not a specific tool's own permission is rejected by the dispatcher (403), and the underlying record is confirmed never created.
- Org tool disablement: a disabled tool is rejected (403) regardless of the caller's own permissions; re-enabling restores access.
- Financial bypass prevention: `invoices.issue` never transitions the invoice directly (execution returns `AWAITING_APPROVAL`, invoice stays `DRAFT`); rejection leaves it `DRAFT`; approval by a permitted caller transitions it to `ISSUED` and writes an `AI_APPROVAL_APPROVED` audit entry; a caller without `ai.approvals.decide` cannot approve (403); redeciding an already-decided request is rejected (409).
- Tenant isolation: executions, tool executions, approval requests, and workflows are all confirmed unreachable (404) from a different organization's caller.

## Security Regression
- Full existing backend suite (auth, sessions, org switching, RBAC, CRM, onboarding, product catalog, CMS, media/storage authorization, commercial/billing, client portal, audit logs, optimistic concurrency, webhook security, rate limiting, CORS, Helmet, public API) re-ran unmodified as part of the 435/435 total — zero regressions.
- `tests/helpers/db.ts`'s `resetDb()` updated for the new AI tables: `ai_providers` (platform-global, wiped explicitly like `products`, cascading to `ai_models`) and `ai_approval_requests` (its `requested_by` FK is `RESTRICT` on `User`, so it must be cleared before `user.deleteMany()` — every other AI table's user-facing FK is `SetNull` or cascades transitively from `organization`, so this was the only ordering fix needed). `ai_tools` is intentionally left untouched by `resetDb()`, same treatment as `roles`/`permissions` — reference/configuration data seeded once, not per-test fixture data.
- No mock/fabricated AI functionality anywhere — every registered tool calls a real, already-audited service; no tool exists that only appears to do something.

## Database
- **Migration**: `prisma/migrations/20260921100313_phase12_ai_control_center/` (11 models, 8 enums, back-relations).
- **Clean-from-zero**: verified — all 11 migrations apply in order against a from-scratch local database (an explicit, user-consented `prisma migrate reset` was required first, per Prisma's own AI-agent safety guard, to clear a stale migration-checksum mismatch in this sandbox's dev database unrelated to Phase 12's own changes).
- `npx prisma validate` against `artify_dev` and the dedicated `artify_test` database: **PASS**; the test database was separately migrated forward (`migrate deploy`) rather than reset, confirming a genuine upgrade path from the Phase 10 schema.
- Pre-existing data model (CRM/users/organizations/memberships/products/product modules/CMS/media/commercial/audit logs) unaffected by the new tables — additive only.

## Commit
See the three feature commits on `claude/busy-franklin-rdwttk`: the AI governance schema/migration, the governance layer + Control Center API, and the Control Center frontend, followed by this documentation commit.

## Branch
`claude/busy-franklin-rdwttk`

## Blockers
None outstanding.

## Phase 13: NOT STARTED
