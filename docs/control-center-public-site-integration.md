# Public Website (artifysolscom) Preservation & Integration Plan (Phase 0)

Documented only — no implementation in this phase. `artifysols.com` stays connected throughout; this plan describes how the future Website module *extends* the existing integration contract rather than replacing it.

## Current integration contract (verified this session, both repos)

- `artifysolscom` has **no database of its own**. All persistent data comes from `Artify-Backend`'s Platform API via `src/lib/publicApi.ts` (11 functions: `getSiteStatus`, `getPageBySlug`, `listPosts`, `getPostBySlug`, `getRedirectForPath`, `listCategories`, `listTags`, `listProducts`, `getProductBySlug`, `getProductModules`, `submitLead`), base path `/api/v1` (overridable via `VITE_PLATFORM_API_BASE_URL`).
- Routing (`src/App.tsx:108-139`) is a hardcoded `getRouteFromPath()` switch: known paths → known page components; any other single-segment path → generic `CmsPageRoute` (real CMS Page lookup); everything else → home.
- Already-API-driven today: Blog (hub + post), CMS Pages (catch-all route), Case Studies (CMS Posts filtered by category — confirmed **not** static, contrary to this initiative's initial assumption), AI Solutions catalog + product detail, Footer product links, global search index, lead submission (`ContactAndBrief` → `POST /public/leads`), sitemap.xml/robots.txt (dynamically generated per-request in `api/index.ts`, correctly paginated through all posts/products).
- Already real but **not** API-driven: Client Portal auth (`AuthContext` calls real `/auth/login`/`/auth/register`/`/auth/me` — genuinely authenticated, not fabricated) and most portal screens (Dashboard/Subscriptions/Invoices real; Products/API-Keys honestly say "Not available yet"; SEO Health tab is mostly illustrative placeholders with two genuinely live sub-endpoints not yet migrated to the shared `apiClient`).
- **Entirely hardcoded, zero backend involvement**: the homepage's 16 sections, `/solutions`, `/services`, `/industries`, `/about`, `/privacy`, `/terms`, and most of `/contact`'s surrounding copy.

## What the Website module must preserve exactly as-is

1. **The `/api/v1/public/*` contract** — existing consumers (11 `publicApi.ts` functions) keep working unchanged. New Website capability is additive endpoints, not modified ones.
2. **The redirect-fallback-then-honest-404 pattern** — both `BlogPage.tsx` and `CmsPageRoute.tsx` independently implement "404 → check `getRedirectForPath` → follow if same-content-type → else honest not-found." A Navigation/Menu-driven router must preserve this exact UX contract; a bad menu link should degrade to the same honest 404, not a raw crash.
3. **The `CmsPageRoute` catch-all** — the single-segment fallback route that already makes any Page reachable. Templates/Homepage/Landing Pages extend this mechanism (page now optionally carries a `templateId`/`pageType`), they do not replace the URL-resolution mechanism itself.
4. **DOMPurify sanitization on the client** mirroring the backend's allowlist (defense-in-depth) — any new renderer for template/section content must keep this, not trust the backend sanitizer alone.
5. **Zero fabricated data convention** — the codebase is unusually disciplined about this already (explicit "never invented" comments throughout `seo.ts`, `publicApi.ts`, `portalApi.ts`). Two existing violations were found this audit (fabricated `4820` view-count fallback in `BlogPostPage.tsx`; the fully-decorative newsletter signup with no real API call) — these should be fixed as hygiene, and the new Website/Landing-Page rendering must not introduce a third instance of the same anti-pattern.

## What the Website module must integrate, not duplicate

- **Site Identity/Global Styles** must become the *source* of what's currently hardcoded per-component (colors, logo, site name) — `artifysolscom`'s build should read these at runtime (or build time, TBD by implementation phase) from the Control Center's new Settings-backed values, not maintain a second, independently-edited copy.
- **Navigation/Menus** must become the source of truth for the header/footer link sets and the homepage's own internal anchors — currently hardcoded JSX arrays in `artifysolscom` components.
- **Homepage** becomes an authored `Page` (or `SystemSetting`-designated Page) rendered through the new Template mechanism, replacing the 16-hardcoded-section `MainAppContent` tree incrementally — this is the largest single piece of frontend replacement in the entire initiative and should be sequenced last among Website sub-features (see roadmap), after Templates/Navigation/Site-Identity are proven on lower-stakes pages.
- **Landing Pages** integrate through the same `CmsPageRoute`-style resolution already handling generic Pages — no new routing mechanism, just a `pageType` distinction feeding a different template default.

## The one integration gap the Website module must not inherit

**SEO metadata is not crawler-visible today** — `updatePageSeo()` mutates `document.title`/`<head>` client-side in a `useEffect`, after SPA hydration; a non-JS crawler sees only `index.html`'s static tags. This is real, already tracked (task #64), and predates this initiative. Any new Website/Template/Landing-Page renderer must be designed so its SEO output is crawler-visible from the start (SSR, prerendering, or edge-injection at the `api/index.ts` serverless layer) — building more pages on top of the current client-only mechanism would multiply, not fix, this gap.

## Explicit non-goals for this phase

No `artifysolscom` code changes, no new public endpoints, no migration — this document is the integration contract the implementation phases (roadmap Phases 2–6 primarily) must honor, nothing here is built yet.
