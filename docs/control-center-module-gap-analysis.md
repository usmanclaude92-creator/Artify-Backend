# Control Center Module Gap Analysis (Phase 0)

Classification legend: **EXISTING/WORKING** (full stack, verified), **EXISTING/PARTIAL** (real but with a confirmed, named gap), **EXISTING/BROKEN** (present but functions incorrectly), **MOCKED** (fabricated data/logic behind a real-looking surface), **HARDCODED** (works but not data-driven), **DUPLICATED** (two implementations, one should retire), **OBSOLETE** (superseded, candidate for removal), **REUSABLE** (not a gap — an existing asset the target module should extend), **MISSING** (confirmed absent by direct inspection, not "not seen yet").

Every row below is verified this session directly against code (grep/read on both repos) or via a background audit agent instructed to cite file:line evidence — not carried over from older docs without re-verification.

## Dashboard
**EXISTING/WORKING.** `DashboardPage`, eager-loaded (only page not code-split, by design — every session needs it).

## Website (target module — the one genuinely new IA grouping)

| Sub-area | Status | Evidence |
|---|---|---|
| Pages | **REUSABLE** | `Page` model + full CRUD + TipTap editor + real public route on artifysolscom (`/:slug` via `CmsPageRoute.tsx`) since Phase 4. This IS the target module's "Pages" — extend, don't duplicate. |
| Media | **REUSABLE** | `MediaAsset` + upload session/signature verification/stable embed-URL. Extend for Website's media-library needs; do not rebuild. |
| Site Identity | **MISSING** | No model, no route, no UI. `artifysolscom` has zero per-organization branding data — name/logo/favicon/contact info are hardcoded JSX/static assets in the `artifysolscom` repo itself. |
| Global Styles | **MISSING** | Confirmed no theme-token model or endpoint. `artifysolscom` styling is Tailwind classes compiled into the build, not runtime-configurable. |
| Site Editor | **MISSING** | No visual builder, no section/block composition UI anywhere in either repo. |
| Templates / Template Parts | **MISSING** | No `Template`/`TemplatePart` model. Every artifysolscom page is its own hand-written React component tree. |
| Navigation / Menus | **MISSING** | Confirmed: `artifysolscom`'s routing is a hardcoded `getRouteFromPath()` switch (`src/App.tsx:108-139`) and header/footer nav links are hardcoded JSX, not DB rows. |
| Homepage | **HARDCODED** | The `/` route renders 16 stacked, entirely hardcoded marketing sections inline in `MainAppContent` (`src/App.tsx:600-711`) — zero backend involvement except the one real lead form embedded in it. |
| Landing Pages | **MISSING** | No model, no route, no renderer. Explicitly deferred in the prior roadmap pending the same section-driven renderer this module requires. |

## Content
**EXISTING/WORKING.** Post/Page/Category/Tag/Author/ContentRevision/MediaAsset — full service+repo+route+schema+RBAC stack; TipTap composer (Phase 3); scheduled publishing via existing cron tick. `metaTitle`/`metaDescription`/`ogImage` ARE validated (`server/schemas/contentSchemas.ts:36-42`), persisted (as part of `ContentRevision.metadata` JSON — not dedicated columns), and returned by the public API (`publicSiteService.ts:60,78` returns `seo: revision.metadata`) — end-to-end wiring confirmed this audit, correcting an older (2026-09-26) audit's claim of a gap here, which is now stale.

**EXISTING/PARTIAL, confirmed gap**: none of this metadata is present in `artifysolscom`'s server-rendered initial HTML — `updatePageSeo()`/`generateBlogPostSeo()` (`artifysolscom/src/utils/seo.ts`) mutate `document.title`/`<head>` client-side inside `useEffect`, only after the SPA hydrates. A crawler that doesn't execute JS sees only the static tags baked into `index.html`. This is a real, already-tracked gap (task #64), not new.

**Content-honesty gaps found this audit** (flagged by the public-website agent, not previously tracked): `BlogPostPage.tsx` substitutes a fabricated `4820` for the "visits" stat whenever the real view count is 0, and the blog's newsletter-signup form (`BlogPage.tsx handleNewsletterSubmit`) never calls any API — it fakes success via `setState`+`setTimeout`. Both contradict the codebase's otherwise-consistent "never fabricate" convention.

## Catalog
**EXISTING/WORKING.** Product/ProductModule, full CRUD + lifecycle, platform-wide (no `organizationId` — confirmed intentional, `authorService.ts`'s own comment calls this pattern out explicitly for `Author` too).

## SEO
**EXISTING/PARTIAL.** Redirects (auto-created on Post/Page slug change, chain-collapsing) + rule-based `seo.audit.read` issue detector — both real, Phase 5. Gaps: (1) the crawler-visibility gap above; (2) no in-app SERP/OG preview or content-analysis panel (task #66, still pending); (3) sitemap generation is correct and unpaginated-cap-free (verified: `fetchAllPages()` follows `meta.pagination.totalPages`, bounded by `maxPages=40`) but lives entirely in `artifysolscom`, not the Control Center.

## CRM
**EXISTING/WORKING.** Lead (NEW→CONTACTED→QUALIFIED→CONVERTED/LOST) → Client conversion; Contact scoped to Client; Opportunity (stage enum, Decimal value, win/lose lifecycle) + pipeline stats (Phase 7). No generic "Company" entity distinct from Organization/Client — not a confirmed need, correctly deferred.

## Clients
**EXISTING/WORKING.** Client/ClientOnboarding/Workspace(=Organization type=CLIENT, reusing OrganizationStatus)/WorkspaceInvitation/read-only Client Portal — all transactional, race-guarded (`workspaceService`'s conditional `UPDATE ... WHERE workspaceOrganizationId IS NULL`), 96 integration test cases across this + Commerce combined.

## Marketing
**EXISTING/PARTIAL.** Form/FormSubmission + public submission endpoint reusing the Lead-intake pattern (Phase 9, UTM captured per-submission). Gaps: (1) no public-facing dynamic form renderer on artifysolscom — forms exist in the CC but nothing on the live site calls them yet except the one hardcoded `ContactAndBrief` form, which is a *different*, older code path that does NOT capture UTM (`publicLeadService.ts` — only a static `source` string, confirmed this audit); (2) no landing pages (Website module's job); (3) no campaign/attribution dashboard (Analytics territory).

## Analytics
**MISSING.** No pageview/traffic model, service, or route anywhere in Artify-Backend. Confirmed zero analytics SDK (gtag/GA4/Plausible/Segment/PostHog/Mixpanel/Amplitude/Hotjar/Fathom/Matomo/Clarity) anywhere in `artifysolscom` — genuinely a zero-analytics site today. Blocked on a product decision (build vs. integrate a provider), not an engineering gap.

## Operations
**EXISTING/WORKING**, needs only IA regrouping, not new engineering. Contract/Subscription/Invoice/Payment (currently under "Commercial" nav) — full lifecycle state machines, Decimal-safe money (`server/utils/money.ts`, `ROUND_HALF_UP` @ 3dp), row-locked payment recording, overpayment rejected outright. 96 combined integration tests (with Clients). Automation engine (`server/services/automation/`: ActionRegistry/WorkflowEngine/SchedulerEngine/EventEngine/ConditionEngine/ApprovalEngine/TaskManager/NotificationEngine) is real and tested but has **zero frontend UI** — backend/API-only, a genuine target-module gap for "Operations" specifically if workflow authoring is meant to be user-facing. Two Automation actions are **MOCKED** despite being registered as real, audited actions: `create_invoice_draft` and `generate_report` (`server/services/automation/ActionRegistry.ts:252-292`) fabricate a return value instead of calling `invoiceService`/a real reporting service.

## Administration
**EXISTING/WORKING**, one sub-area PARTIAL. Users/Organizations/AuditLog(append-only, `record()` only, 38 call sites)/Security(session self-service)/Settings all real. **Roles is EXISTING/PARTIAL** — read-only in both API and UI (`rolesApi.list()` only), the 5 system roles are fixed/seeded, no custom-role creation exists. Settings is a flat per-org key/value store with no category taxonomy — a real but minor gap, and the natural extension point for Site Identity/Global Styles config (see data-preservation doc) rather than new dedicated tables, if the values stay simple.

## AI
**EXISTING/WORKING** (AI Control Center + Copilot), **EXISTING/PARTIAL** (Knowledge/RAG). AI Control Center: governed tool dispatch (`server/ai/governance.ts`), HIGH-risk tools (`invoices.issue`, `contracts.activate`) require human approval non-overridably, full audit trail, dedicated security test suite. Copilot: reuses real business services, no parallel stub stack. Knowledge/RAG: real chunking/ingestion/hybrid-search pipeline, but embedding generation silently falls back to a deterministic hash vector (not semantic) when no real embedding-capable adapter is configured, and `KnowledgeEmbedding.providerType` defaults to `"MOCK"` in the schema itself — RAG quality is provider-configuration-dependent, and there is no frontend UI for Knowledge at all (backend/API only). 6 permission keys across AI/Automation/Knowledge/Copilot are defined but enforced nowhere (`ai.executions.cancel`, `ai.audit.read`, `knowledge.edit`, `knowledge.archive`, `knowledge.manage`, `copilot.admin`) — vestigial, worth resolving (add the route or remove the key) independent of this initiative.

## Corrected findings vs. the prior (2026-09-26) audit

Two items that older audit flagged as gaps are **no longer gaps**, verified directly this session:
- **"Dead duplicate nav entries" (Products, Workspaces)** — false today. Both `ProductsPage.tsx:452` and `WorkspacesPage.tsx:309` branch on `useRouter().path` (`isModulesView`/`isMembersView`) and render genuinely different views per path.
- **Notifications UI missing** — resolved in Phase 11 of this engagement (`NotificationBell.tsx`, self-scoped, 5 real emitting events).

One item is **confirmed still real**, contrary to a risk this audit initially flagged as possibly-resolved: the *original* `ContactAndBrief` lead form still does not capture UTM/referrer (only Phase 9's newer Forms path does) — this is a narrower gap than the old audit described, not a resolved one.
