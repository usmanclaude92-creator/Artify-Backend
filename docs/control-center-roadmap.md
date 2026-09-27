# Control Center Roadmap

Sequencing from `control-center-gap-analysis.md`'s findings toward `control-center-enterprise-architecture.md`.
Phases already substantially complete are marked so; this roadmap only breaks new ground into concrete,
shippable units — it does not restate what's already built.

| # | Phase | Status |
|---|---|---|
| 1 | **Control Center Foundation** — shell, breadcrumbs, command palette, global search, responsive nav | **Done this phase.** Sidebar/AppShell/Header/mobile drawer pre-existed; breadcrumbs + Ctrl/Cmd+K command palette (quick actions + live entity search) added. Remaining: notification bell (blocked on Phase 9), code-splitting (§ below). |
| 2 | **CMS Foundation** — Posts/Pages/Categories/Tags/Authors, revisions, publishing | **Already complete.** No new work. |
| 3 | **Professional Editor** — block/component editor, media, preview, autosave | **Not started.** Current editor is a plain textarea + Media Library picker; no block model. Scope: rich-text (TipTap-class) editing, not a full page-builder block system yet (see Phase 4). |
| 4 | **Website Management** — homepage/header/footer/navigation/landing pages/reusable sections | **Not started, and not scoped yet** — the public site (`artifysolscom`) is a hand-authored React SPA, not a section-driven renderer. Making its homepage/nav backend-configurable is a larger architectural change than a CMS field addition; needs its own design pass before implementation. |
| 5 | **SEO Control Center** — dashboard, technical SEO, sitemap, redirects, schema, issue detection | **Done.** Redirects (auto-created on Post slug change, chain-collapsing, open-redirect-hardened) + a rule-based `seo.audit.read` issue detector, both with Control Center UI (new "SEO" nav section) — see `docs/SEO_ARCHITECTURE.md`. Also fixed a real bug found during this phase: `artifysolscom`'s sitemap generator capped at the first 50 posts/products. Remaining SEO-adjacent gap, explicitly out of this phase's scope: CMS Pages still have no public route to render at (Website Management, Phase 4 below) — the audit still scores them, but redirects/lookup are Post-only until that exists. |
| 6 | **Products & Services** — catalog, relationships, SEO, content integration | **Mostly complete** (Product/ProductModule exist with full CRUD). Gap: no Industries/Solutions/Case-Study relationship model — defer until a real content need names one, rather than pre-building relations nothing populates. |
| 7 | **CRM** — leads, contacts, organizations, opportunities, pipeline | **Partial, real gap.** Lead→Client conversion and Contact-per-Client exist. Missing: an `Opportunity` model (stage enum, value, close date, linked Lead/Client) and pipeline UI (kanban or stage-grouped table). This is a schema change — needs a migration, which needs a reachable Postgres to generate and verify (now available in this environment; previously blocked). |
| 8 | **Client Management** — clients, onboarding, documents, portal | **Already complete.** No new work. |
| 9 | **Marketing** — forms, campaigns, landing pages, attribution | **Real gap, zero backend today.** Minimum viable slice: a `Form`/`FormSubmission` model reusing the existing Lead-intake pattern (`publicLeadService.ts`) instead of a parallel one, UTM capture on the existing lead source field, and a Forms list in Control Center. Landing-page authoring depends on Phase 4's section-driven renderer — sequence after it, not before. |
| 10 | **Analytics** — website, SEO, content, CRM, business | **Real gap.** Per spec's own instruction ("avoid building redundant analytics infrastructure if an existing provider already supplies the underlying data") — first confirm whether Artify already has (or intends) a hosted analytics provider (e.g. Plausible/GA4) before building a first-party pageview pipeline. If yes, this phase is an *integration* (pull via provider API into CRM/content dashboards), not new tracking infrastructure. If no provider is decided, this phase is blocked on that product decision, not an engineering one. |
| 11 | **Automation / Notifications** — user-facing notification center, scheduled publishing | **Partial.** Scheduled publishing already ships (existing Vercel Cron tick). Real gap: wire the already-modeled `Notification`/`NotificationPreference` tables to a real service + `notificationRoutes.ts` + a bell in `Header.tsx`, and decide which existing events (lead created, content published, AI approval pending) should emit one — reusing `AutomationNotification`'s pattern rather than inventing a second one. |
| 12 | **AI Control Center** | **Already complete** (Phase 12 of the prior CMS/SEO work). No new work. |
| 13 | **Enterprise Hardening** — code-splitting, shared DataTable, performance, disaster recovery | **Deferred, tracked.** Route-level `React.lazy` per nav section (currently one ~1.07 MB bundle) and a shared `DataTable` component (six pages currently hand-roll their own `<table>`) are the two concrete, low-risk frontend-only items ready to pick up whenever a phase touches those files anyway — no need for a dedicated pass first. |

## Immediate next phase recommendation

With Phase 5 done, **Phase 7 (CRM — Opportunity/pipeline)** is the next highest-leverage step by the same
criteria: a real, confirmed gap (no `Opportunity` model or pipeline-stage concept exists at all today) with no
architectural prerequisite, extending a CRM domain that's already substantially built (Lead→Client conversion,
Contact-per-Client) rather than starting a new one. Concretely: an `Opportunity` model (stage enum, value,
close date, linked Lead/Client) + CRUD + RBAC, and a pipeline view (kanban or stage-grouped table) in the
existing CRM nav section.
