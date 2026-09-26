# Artify Solutions — Enterprise Roadmap

Derived from [`enterprise-platform-audit.md`](./enterprise-platform-audit.md). Each phase lists **Objective, Current State, Key Gaps, Key Work, Dependencies, Acceptance Criteria** — a condensed field set rather than the full 19-field template, chosen deliberately: the architecture, database, API, frontend, Control Center, security, and testing implications of each phase are already covered in detail in the main audit and its two supporting evidence documents, and restating them per-phase in full would mostly repeat that material rather than add planning value. Any individual phase can be expanded to the full template on request before work starts on it.

This roadmap does not commit to timelines — it orders work by dependency and risk, per the audit's own priority table.

---

## Phase 0 — Baseline (this audit)
**Status: done.** This document and its two companion evidence files are the baseline.

## Phase 1 — Stabilization & Trust (P0/P1 items, no architectural risk)
**Objective:** close active production risk and remove every instance of fabricated data before any new feature work.
**Current state:** DB pooling issue fixed; two backends and several fabrication instances remain.
**Key gaps:** legacy `artifysolscom` backend (live status unconfirmed), fabricated JSON-LD ratings, fabricated case studies, stale SEO on client-side nav, canonical URL bug, dead sitemap URLs, missing indexes, non-blocking CI audit, two dead nav entries.
**Key work:** confirm live deployment target and delete the losing backend; strip fabricated `AggregateRating` defaults; replace or clearly label case-study content; fix `navigateToRoute()` to call `updatePageSeo()`; fix the privacy canonical; fix or remove the dead category-filter sitemap URLs; add the 3 missing indexes; flip CI's dependency audit to blocking; fix the Products/Workspaces nav duplication.
**Dependencies:** none — this phase can start immediately, and mostly requires a business decision (which backend is live) plus small, independent code fixes.
**Acceptance criteria:** only one `artifysolscom` backend remains in the repo; no fabricated data ships anywhere in production; CI fails on a high/critical dependency CVE; sitemap contains no dead URLs.

## Phase 2 — Integration Hardening
**Objective:** make the frontend↔backend integration fully honest and reliable, close the input-validation and serverless-reliability gaps found in the backend audit.
**Current state:** most of the public site is now real-API-backed (this session); `PortalSeoHealth.tsx` and global search still aren't.
**Key gaps:** `knowledgeRoutes.ts`/`copilotRoutes.ts` have no input validation; Automation's background worker is unreliable on the serverless deployment target; rate limiting is in-memory (weak on serverless); global search reads mock data.
**Key work:** add Zod schemas to the two gap route files; confirm the production deployment target for Automation/Copilot and, if serverless, move queue-draining to a real mechanism (see Phase 2 dependency note); move rate-limit state to a shared store (e.g. Vercel KV/Upstash Redis); wire `GlobalSearchModal.tsx` to the real API; fix or remove `PortalSeoHealth.tsx`.
**Dependencies:** Phase 1's deployment-target confirmation informs the Automation-worker fix.
**Acceptance criteria:** all 38 backend route files validate input consistently; automation/copilot executions reliably complete in production regardless of which invocation handles them; search reflects real, current content.

## Phase 3 — Design System & Premium UX
**Objective:** make the two frontends feel like one product, close the accessibility gaps found in the sampled components.
**Current state:** two independently-styled Tailwind setups, no shared tokens or component kit, mixed accessibility (Control Center's shared `Modal` does dialog semantics correctly; the public site's `AuthModal` doesn't).
**Key gaps:** no shared token package; inconsistent dark-mode conventions (`.theme-dark` vs `.dark`); `AuthModal.tsx` missing `role="dialog"`/`aria-modal`; several components missing `aria-pressed`/`aria-*` state exposure.
**Key work:** extract a shared design-token package; align dark-mode class conventions; retrofit dialog/ARIA semantics onto public-site modals to match the Control Center's existing correct pattern; a full accessibility pass beyond the components sampled in this audit.
**Dependencies:** best sequenced alongside any planned visual refresh, since it touches most components either way.
**Acceptance criteria:** both apps consume the same token source; a WCAG-focused pass finds no missing dialog semantics on any modal.

## Phase 4 — Enterprise CMS Completion
**Objective:** let content editors actually manage SEO without developer involvement.
**Current state:** CMS publishing/scheduling/taxonomy/media is real and complete; SEO fields are the one missing piece.
**Key gaps:** no `seo`/`metaTitle`/`metaDescription`/`ogImage` fields in the Page/Post schema or UI.
**Key work:** add structured SEO fields to the schema (replacing the currently-unused generic `metadata` blob with explicit fields), add the corresponding UI in `PostsPage.tsx`/`PagesPage.tsx`, wire the public API's existing `seo` projection to the new fields.
**Dependencies:** none.
**Acceptance criteria:** a content editor can set and see a working custom meta title/description/OG image for any post or page without touching code.

## Phase 5 — Products & Services Catalog
**Objective:** make products actually sellable/differentiable through the platform.
**Current state:** product catalog list/detail pages are real; pricing/features/screenshots/FAQ have no data model at all.
**Key gaps:** `productSchemas.ts` has none of these fields; no UI to manage them.
**Key work:** design (with product/sales input) and add a real commercial data model — pricing tiers, feature lists, screenshot gallery, FAQ entries — plus the corresponding Control Center UI and public API surface.
**Dependencies:** requires product/sales input on the actual fields needed; best done after Phase 4 establishes the SEO-field pattern this phase can reuse.
**Acceptance criteria:** a product's pricing, features, screenshots, and FAQs are manageable from the Control Center and render correctly on the public product page.

## Phase 6 — Advanced SEO
**Objective:** build real programmatic SEO only where there's genuine content to back it.
**Current state:** technical SEO foundation is solid (sitemap/robots/JSON-LD shell); no programmatic page generation exists; industries/services pages are hand-written static content.
**Key gaps:** no CMS-managed industry/solution page type; no internal-linking/topic-cluster structure.
**Key work:** only after Phases 4-5 establish real, substantial content — introduce CMS-managed industry/solution page types with unique content requirements enforced (not thin auto-generated pages), internal linking between pillar/supporting content, breadcrumb structured data.
**Dependencies:** Phase 4 (SEO field infrastructure), Phase 5 (real product content to link from).
**Acceptance criteria:** every programmatically-generated page has genuinely unique content and passes a manual quality check before publishing; no duplicate-content canonical issues.

## Phase 7 — Performance Engineering
**Objective:** get real measurement in place, then act on it.
**Current state:** unmeasured from this sandbox; build output shows a large (~420KB gzipped) main JS chunk on the Control Center as one known opportunity.
**Key gaps:** no Core Web Vitals baseline; no measured API/DB latency under load.
**Key work:** run PageSpeed Insights/Lighthouse against both domains immediately (this alone is a Phase 1-speed quick win, listed here because the *engineering response* to what it finds belongs in this phase); code-split large bundles; audit image optimization/lazy-loading; set explicit CWV targets once a baseline exists.
**Dependencies:** the measurement step has none; the engineering response depends on what it finds.
**Acceptance criteria:** documented CWV baseline exists; specific, measured targets are set and tracked.

## Phase 8 — CRM Attribution
**Objective:** answer "where did this lead come from?"
**Current state:** lead capture works but has no UTM/referrer/first-touch/last-touch capture at all.
**Key gaps:** `createPublicLeadSchema` has no attribution fields.
**Key work:** add UTM/referrer/landing-page capture to the lead-intake form and schema; surface it in the CRM lead detail view; connect it to whatever analytics platform is chosen.
**Dependencies:** a business decision on the attribution model wanted (first-touch vs. last-touch vs. multi-touch).
**Acceptance criteria:** every new lead's source is visible and accurate in the CRM without manual entry.

## Phase 9 — Client Onboarding Refinement
**Objective:** build on the already-real onboarding flow.
**Current state:** real and correctly path-branched; not deeply audited beyond that in this pass.
**Key gaps:** not fully assessed — recommend a focused follow-up audit of this specific flow before committing scope here.
**Dependencies:** none blocking, but low priority relative to Phases 1-8 given the flow already works.

## Phase 10 — Unified Client Portal
**Objective:** one real client portal instead of two (one real, one mocked) competing implementations.
**Current state:** Control Center has a real, read-only, tenant-scoped portal; the public site has a fully mocked, unintegrated duplicate.
**Key gaps:** no shared client-facing API surface; a product decision on which domain should host the client-facing portal hasn't been made.
**Key work:** decide the target domain/experience; either point the public site's portal at the real backend or retire it in favor of directing clients to the Control Center's portal.
**Dependencies:** a business decision on portal ownership/domain.
**Acceptance criteria:** exactly one client portal implementation exists, and it is real.

## Phase 11 — Analytics
**Objective:** give management real visibility once the data underneath it is real.
**Current state:** minimal, honest (Control Center dashboard). No website analytics, SEO analytics, or CRM pipeline analytics dashboards exist.
**Dependencies:** Phase 8 (attribution) for meaningful lead-source analytics; Phase 7 (measurement) for performance analytics.

## Phase 12 — Marketing Automation
**Objective:** lead capture, segmentation, campaigns.
**Current state:** does not exist.
**Dependencies:** Phase 8 (attribution) must exist first — automation without attribution data can't target effectively.

## Phase 13 — Workflow Engine Extension
**Objective:** extend the already-real Automation engine to more business processes (content approval, product publishing approval).
**Current state:** engine is real and working; only a few workflows are registered today.
**Dependencies:** Phase 2's serverless-reliability fix, if the production target turns out to be Vercel.

## Phase 14 — Search & Intelligence
**Objective:** real, unified search across CRM/CMS/products (Control Center) and real product/content search (public site).
**Current state:** public-site search is mocked (Phase 2 closes this); no Control Center global search exists at all.
**Dependencies:** Phase 2 (real public search) is the prerequisite groundwork.

## Phase 15 — Security & Compliance Hardening
**Objective:** close the remaining, lower-urgency security gaps.
**Current state:** core security is strong; remaining gaps are DB-privilege-level audit-log immutability and the (already-flagged-in-schema) "Phase 16" hardening step.
**Key work:** add `REVOKE UPDATE/DELETE` at the database-role level for the audit log table; review and rotate any credentials touched during this audit.
**Dependencies:** none blocking.

## Phase 16 — Observability & Reliability
**Objective:** know about production problems before a user reports them.
**Current state:** only Vercel's own runtime logs exist today; no dedicated APM/alerting was found in either repo.
**Key work:** add structured alerting on 5xx rate and the specific `EMAXCONNSESSION`-style DB errors this audit found; consider a dedicated APM tool.
**Dependencies:** none blocking.

## Phase 17 — Growth Platform
**Objective:** content, SEO, landing pages, campaigns, conversion optimization working together.
**Dependencies:** Phases 4-6 (CMS/SEO), 8 (attribution), 12 (marketing automation) — this phase is a capstone on top of those, not independent work.

## Phase 18 — Enterprise Scalability
**Objective:** caching, queues, connection pooling, horizontal scale.
**Current state:** connection pooling issue fixed this session; no queue infrastructure exists (relevant to Automation's serverless reliability, Phase 2).
**Key work:** introduce real queue infrastructure if Vercel is confirmed as the production target; add caching where the (now-obtained) performance measurements justify it.
**Dependencies:** Phase 7 (measurement) should justify any caching work before it's built.

## Phase 19 — Final Production Readiness
**Objective:** independent QA and certification before calling any of the above "done."
**Key work:** re-run this audit's method (code + live measurement, this time with live-site access) against the state after Phases 1-18; confirm no new fabricated data, no new dead code paths, and that the live PageSpeed/CWV measurement this audit could not obtain now has a real, acceptable baseline.
