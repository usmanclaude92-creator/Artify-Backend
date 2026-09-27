# Control Center Roadmap

Sequencing from `control-center-gap-analysis.md`'s findings toward `control-center-enterprise-architecture.md`.
Phases already substantially complete are marked so; this roadmap only breaks new ground into concrete,
shippable units — it does not restate what's already built.

| # | Phase | Status |
|---|---|---|
| 1 | **Control Center Foundation** — shell, breadcrumbs, command palette, global search, responsive nav | **Done this phase.** Sidebar/AppShell/Header/mobile drawer pre-existed; breadcrumbs + Ctrl/Cmd+K command palette (quick actions + live entity search) added. Remaining: notification bell (blocked on Phase 9), code-splitting (§ below). |
| 2 | **CMS Foundation** — Posts/Pages/Categories/Tags/Authors, revisions, publishing | **Already complete.** No new work. |
| 3 | **Professional Editor** — block/component editor, media, preview, autosave | **Done.** The plain `<textarea>` is replaced by a real TipTap rich-text editor (bold/italic/underline/strike/headings/lists/blockquote/code/link/table/image) scoped to exactly the tag set `sanitizeContentHtml` allows — see `docs/CMS_ARCHITECTURE.md`'s "Phase 3" section. Inline image insertion required a new stable-URL media endpoint (`GET /media/:id/embed-url`), since the existing signed read-URL expires and would break published content. Not in scope: a block/component model or a full page-builder (that's Phase 4's larger architectural change), autosave (still explicit Save), and live preview (the read-only detail view already renders the real sanitized HTML, which serves the same purpose today). |
| 4 | **Website Management** — homepage/header/footer/navigation/landing pages/reusable sections | **Scoped slice done: CMS Pages have a real public route.** `artifysolscom`'s router now resolves any unreserved single-segment path against `publicApi.getPageBySlug()` (`CmsPageRoute.tsx`), with the same redirect-fallback-then-honest-404 pattern Posts use, and `pageService.updatePage` auto-creates a redirect on a published page's slug change (`/:slug`, not `/blog/:slug`) — see `docs/CMS_ARCHITECTURE.md`'s "Phase 4" section. The full vision (homepage/header/footer/nav backend-configurable, section-driven renderer, visual builder) remains **not started** and still needs its own design pass — this slice only makes an already-authorable Page *reachable*, it doesn't make the site's structure editable. |
| 5 | **SEO Control Center** — dashboard, technical SEO, sitemap, redirects, schema, issue detection | **Done.** Redirects (auto-created on Post/Page slug change since Phase 4, chain-collapsing, open-redirect-hardened) + a rule-based `seo.audit.read` issue detector, both with Control Center UI (new "SEO" nav section) — see `docs/SEO_ARCHITECTURE.md`. Also fixed a real bug found during this phase: `artifysolscom`'s sitemap generator capped at the first 50 posts/products. |
| 6 | **Products & Services** — catalog, relationships, SEO, content integration | **Mostly complete** (Product/ProductModule exist with full CRUD). Gap: no Industries/Solutions/Case-Study relationship model — defer until a real content need names one, rather than pre-building relations nothing populates. |
| 7 | **CRM** — leads, contacts, organizations, opportunities, pipeline | **Done.** `Opportunity` model (stage enum, `Decimal` value/currency, close dates, linked Client + optional Lead) + full CRUD + win/lose lifecycle + RBAC + pipeline stats on the CRM dashboard + a stage-filterable "Opportunities" Control Center page — see `docs/CRM_ARCHITECTURE.md`'s "Phase 7" section. Remaining, explicitly out of scope: no generic "Company" entity distinct from `Organization`/`Client` (not a confirmed need yet), and the Client/Lead pickers in the create form don't scale past ~100 records (noted in the doc). |
| 8 | **Client Management** — clients, onboarding, documents, portal | **Already complete.** No new work. |
| 9 | **Marketing** — forms, campaigns, landing pages, attribution | **MVP slice done.** `Form`/`FormSubmission` model + CRUD + a public submission endpoint (`POST /public/forms/:slug/submit`) that reuses the existing Lead-intake pattern exactly as scoped — every real submission creates a CRM Lead, with UTM params captured per-submission and folded into the Lead's source/notes — plus a "Marketing" Forms page in the Control Center. See `docs/FORMS_ARCHITECTURE.md`. Explicitly out of scope, as originally sequenced: no public-facing dynamic form renderer on `artifysolscom` (landing-page-authoring territory, still depends on Phase 4's not-yet-built section-driven renderer), no campaign/attribution dashboard (Phase 10/Analytics territory). |
| 10 | **Analytics** — website, SEO, content, CRM, business | **Real gap.** Per spec's own instruction ("avoid building redundant analytics infrastructure if an existing provider already supplies the underlying data") — first confirm whether Artify already has (or intends) a hosted analytics provider (e.g. Plausible/GA4) before building a first-party pageview pipeline. If yes, this phase is an *integration* (pull via provider API into CRM/content dashboards), not new tracking infrastructure. If no provider is decided, this phase is blocked on that product decision, not an engineering one. |
| 11 | **Automation / Notifications** — user-facing notification center, scheduled publishing | **Done.** Scheduled publishing already shipped (existing Vercel Cron tick). `Notification`/`NotificationPreference` now wired: self-scoped `notificationRoutes.ts` + a bell in `Header.tsx`, emitted from 5 real events (lead/opportunity assignment, opportunity win/loss, content publish) — see `docs/NOTIFICATIONS_ARCHITECTURE.md`. Remaining, explicitly out of scope: no fan-out-by-permission notifications (e.g. "submitted for review" notifying every publisher), no deep link from a notification back to its record (the model has no resourceType/resourceId column). |
| 12 | **AI Control Center** | **Already complete** (Phase 12 of the prior CMS/SEO work). No new work. |
| 13 | **Enterprise Hardening** — code-splitting, shared DataTable, performance, disaster recovery | **Done (scoped slice).** Route-level `React.lazy` per nav item (main bundle ~1.6 MB → ~568 KB gzip ~157 KB; Phase 3's TipTap editor now a separate ~485 KB on-demand chunk) and a shared `DataTable<T>` component replacing the hand-rolled `<table>` in all six pages that had one — see `docs/CONTROL_CENTER_ARCHITECTURE.md`'s "Phase 13" section. Performance beyond bundle size and disaster-recovery planning remain out of scope — not concrete, shippable units yet. |

## Status

Every phase this roadmap scoped as a concrete, shippable unit is now done: 1 (Foundation), 2 (CMS), 3
(Professional Editor), 4 (Website Management — scoped slice), 5 (SEO), 7 (CRM), 8 (Client Management), 9
(Marketing — MVP slice), 11 (Notifications), 12 (AI), and 13 (Enterprise Hardening — scoped slice). What
remains is explicitly **not** guessed-at, undersized work manufactured to look busy — each is a real gap this
roadmap already named and deliberately deferred pending something outside engineering's control:

- **Phase 10 (Analytics)** — blocked on a product decision (self-built pageview pipeline vs. integrating an
  existing provider like Plausible/GA4).
- **Phase 6's Industries/Solutions/Case-Study relationship model** — deferred until a real content need
  names one.
- **Phase 9's public-facing form renderer** and **Phase 4's full website-management vision**
  (homepage/nav/section-driven authoring, a visual builder) — both depend on the same not-yet-justified,
  larger architectural design pass a section-driven renderer requires.
- A true **Company** entity distinct from `Organization`/`Client` (CRM, Phase 7) — not a confirmed need.

None of these should be started speculatively — each needs either a product decision or a concrete content
need to name it first, exactly as this roadmap said when it originally deferred them.
