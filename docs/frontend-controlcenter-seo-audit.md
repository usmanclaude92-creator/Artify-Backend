# Frontend / SEO / UX Architecture Audit — Draft

**Scope:** `artifysolscom` (artifysols.com, public marketing site) and `Artify-Backend/src` (cc.artifysols.com, Control Center admin app). Read-only, code-level audit. No live/runtime testing was performed — anything that requires observing the deployed site is marked **NOT VERIFIED**.

**Context:** artifysolscom's `main` was recently merged (9c18ee5 → 0df3398), combining a visual "brand overhaul" with a real backend-integration pass wiring several pages to `/api/v1/public/*` on the Artify-Backend platform via `src/lib/publicApi.ts` / `src/lib/apiClient.ts` (base URL from `VITE_PLATFORM_API_BASE_URL`, currently `https://cc.artifysols.com/api/v1`).

---

## 1. artifysolscom — Page Inventory & Real/Mock Classification

Routing is enumerated in `src/App.tsx:105-123` (`getRouteFromPath`) and rendered in `src/App.tsx:463-668`.

| Page / Section | Classification | Evidence (file:line) | Notes |
|---|---|---|---|
| Home hero / marketing sections (Hero, TrustStatement, AdaptiveEcosystem, NextGenAiLayer, EnterpriseSolutions, IndustryShowcase, LiveScenarios, AiOrchestration, EnterpriseArchitecture, SecurityAndSovereignty, DeploymentMethodology, HumanPlusAi, AiAgentsSection, IntegrationsEcosystem, AiCommandCenter, DevelopmentMethodology, SolutionsByFunction, IndustryExplorer) | HARDCODED (ok) | `src/App.tsx:556-666`; each imports from `src/data/solutionsData.ts` (e.g. `src/components/AiAgentsSection.tsx:20`, `src/components/IntegrationsEcosystem.tsx:12`, `src/components/AiCommandCenter.tsx:19`) | Genuinely static marketing copy with no pretense of a CMS backing it — acceptable per audit criteria. |
| Home → Blog teaser (`BlogPreviewSection`) | **MOCKED** | `src/components/BlogPreviewSection.tsx:3,17` — `import { getStoredBlogPosts } from '../data/blogData'` | Homepage shows fabricated/local blog posts while the real `/blog` route (below) is fully API-backed. Confirmed pre-existing finding. |
| Case Studies (`/case-studies`, `CaseStudiesPage` → `CaseStudiesSection`) | **MOCKED presented as REAL** | `src/components/pages/CaseStudiesPage.tsx:3,37` ("Real-World Architecture Outcomes"); `src/components/CaseStudiesSection.tsx:12` `import { CASE_STUDIES } from '../data/solutionsData'`; fabricated precision metrics at `src/data/solutionsData.ts:22,32,38,53,58,63,67,69-70,84,98,100-101,120,124,127,141,146` (e.g. "99.98% Reconciliation Accuracy", "-35% 30-Day Readmissions") | Backend has no case-study/testimonial content type at all — these are invented client outcomes with fake decimal-precision metrics, shipped as if they were real customer results. Worth flagging as a legal/trust risk, not just a data-freshness one. |
| Blog Hub (`/blog`, `BlogPage.tsx`) | **REAL** | `src/components/blog/BlogPage.tsx:18,72-88` — calls `publicApi.listPosts()` / `publicApi.listCategories()`; has loading (`:300-308`), error (`:311-319`), and empty (`:573-604`) states | Well-built: honest error and empty states, no fabricated fallback. |
| Blog category filter (`/blog` + category chips) | **BROKEN (sitemap/routing mismatch)** | Sitemap emits `/blog?category=<slug>` (`src/utils/sitemap.ts:168-178`), but `BlogPage` never reads `location.search` (only `pathname`, `src/components/blog/BlogPage.tsx:121-139`) and category filtering is pure client state (`:53,494-508`). Canonical for the hub is hardcoded to `${origin}/blog` regardless of filter (`:168`). | The category URLs Google is told to crawl render an identical, unfiltered `/blog` page — wasted crawl budget / a hub page that never actually shows only that category when visited directly. Canonical itself is safe (no duplicate-content tag issue), but the sitemap entries are functionally dead links. |
| Blog Post (`/blog/:slug`, `BlogPostPage.tsx`) | **REAL** (with one dead import) | `src/components/blog/BlogPage.tsx:126-129` resolves slug from real `posts` array; SEO via `generateBlogPostSeo`/`updatePageSeo` (`src/components/blog/BlogPostPage.tsx:166-176`) | Still imports the legacy `generateSeoStructuredData` from `src/data/blogData.ts:633` (`src/components/blog/BlogPostPage.tsx:44,1769,1787`) purely to render a "copy schema" preview in the SEO inspector UI — a second, parallel JSON-LD generator that duplicates `utils/seo.ts`'s `generateBlogPostSeo` logic (see §2). |
| AI Solutions / Product Catalog (`/ai-solutions`, `/solutions`) | **REAL** | `src/components/solutions/AiSolutionsPage.tsx:3,33-47` — `publicApi.listProducts()`; loading/error state present (`:29-47`) | `/solutions` (`SolutionsCatalogPage.tsx`) intentionally renders the *same* component (`src/components/solutions/SolutionsCatalogPage.tsx:1-35`) — code comment explicitly says this replaced a fabricated "24 modular systems" catalog. Good consolidation, not a duplicate. |
| Product Detail (`/ai-solutions/:slug`) | **REAL** | `src/components/solutions/AiProductDetailPage.tsx:3,28-49` — `publicApi.getProductBySlug` + `getProductModules`; loading (`:79-88`) and not-found (`:90-101`) states | The not-found state doesn't set `robots: noindex` via `updatePageSeo`, and since this is a client-rendered SPA the HTTP status is always 200 regardless — soft-404 risk. NOT VERIFIED against the live deploy. |
| Services (`/services`) | HARDCODED (ok) | `src/components/pages/ServicesPage.tsx:16,36,44+` | Static content, `updatePageSeo` called. |
| Industries (`/industries`) | HARDCODED (ok) | `src/components/pages/IndustriesPage.tsx:3-4,19-26`; data from `src/data/solutionsData.ts` via `IndustryExplorer` | Static; SEO called. |
| About (`/about`) | HARDCODED (ok) | `src/components/pages/AboutPage.tsx:7,23-30` | Static; SEO called. |
| Contact / Lead form (`/contact`, home `#contact`) | **REAL** | `src/components/ContactAndBrief.tsx:20,92-104` — `publicApi.submitLead(...)` | See §4 for full field-level cross-check. |
| Legal — Privacy/Terms (`/privacy`, `/terms`) | HARDCODED (ok), **canonical BROKEN** | `src/components/pages/LegalPage.tsx:15-21` sets `canonicalUrl: https://artifysols.com/privacy-policy` for the privacy page, but the real route is `/privacy` (`src/App.tsx:118`, `src/App.tsx:683`) | Self-referencing canonical points at a URL (`/privacy-policy`) that the router never serves — a real canonical mismatch that can cause the actual `/privacy` page to be treated as non-canonical/dropped from the index. |
| Client Portal (in-app modal, `openPortal()`) | **MOCKED**, and duplicated with a real Control-Center portal | `src/context/AuthContext.tsx:3` — `SUBSCRIPTION_PLANS, CATALOG_PRODUCTS` from `src/data/portalData.ts`; portal screens `PortalSubscriptions.tsx:3`, `PortalProducts.tsx:3`, `AuthModal.tsx:17` all import the same mock file | See §7 — Artify-Backend has a second, real, API-backed Client Portal (`ClientPortalPage.tsx`) that this one does not talk to. `apiClient.ts:14-19` documents this gap explicitly ("Phase 4/11 work, not Phase 1"). |
| Global Search (⌘K / `/`) | **MOCKED** (new instance beyond blog) | `src/components/GlobalSearchModal.tsx:23-26` — imports `AI_PRODUCTS` (`data/aiProductsData.ts`), `ENTERPRISE_SOLUTIONS` (`data/solutionsCatalogData.ts`), `INDUSTRIES_DATA`, `INITIAL_BLOG_POSTS` (`data/blogData.ts`) | Search results for products/solutions/blog are all stale local fixtures — a product added or unpublished in the Control Center will not appear/disappear from site search. This is in addition to the previously-known Blog mock. |
| Client Portal → SEO Health tool | **BROKEN / fabricated masquerading as real** | See §2 (dedicated write-up) — `src/components/portal/PortalSeoHealth.tsx` | |

---

## 2. artifysolscom — SEO Implementation (code-level)

### `utils/seo.ts` — what it actually sets
`updatePageSeo()` (`src/utils/seo.ts:464-582`) sets, per call: document `<title>` (`:476`), canonical `<link>` (`:481`), `description`/`keywords`/`author`/`robots` meta (`:484-492`), full OpenGraph set including `og:image:secure_url`/width/height (`:503-513`), `article:*` tags when `ogType==='article'` (`:516-541`), `product:*` tags when a `product` config is passed (`:544-558`), Twitter Card tags (`:561-567`), and a JSON-LD `<script type="application/ld+json">` via `setJsonLdScript()` (`:432-458`, invoked `:570-575`). This is a genuinely comprehensive, well-built implementation — not a stub.

**Called from:** `LegalPage.tsx:15`, `ContactPage.tsx:20`, `ServicesPage.tsx:36`, `CaseStudiesPage.tsx:20`, `IndustriesPage.tsx:20`, `AboutPage.tsx:24`, `BlogPostPage.tsx:171` (via `generateBlogPostSeo`), `BlogPage.tsx:160`, `AiSolutionsPage.tsx:64`, `AiProductDetailPage.tsx:53`.

**Not called from:** the Home route itself. `App.tsx`'s `MainAppContent` only invokes `updatePageSeo` for `home`/`solutions-catalog`/`ai-solutions` inside the **`popstate`** handler (`src/App.tsx:153-189`), which only fires on browser back/forward — **not** on `navigateToRoute()` (`src/App.tsx:374-380`, used by every nav-bar click and internal link), which just does `pushState` with no SEO update at all. Net effect: clicking from, say, `/about` to Home via the nav bar leaves the previous page's `<title>`/meta/canonical/JSON-LD in the DOM until a full reload or a browser-native back/forward — a real "stale meta tags after client-side navigation" bug for anything that executes JS (including Googlebot's renderer). **NOT VERIFIED against production** (would need a live click-through crawl to confirm severity), but the code path is clear.

### `utils/sitemap.ts` + `api/index.ts` + `vercel.json`
- `getSitemapUrlList()` / `generateSitemapXml()` (`src/utils/sitemap.ts:85-181`) fetch real, live data from the Platform API — `${base}/public/posts`, `/public/products`, `/public/categories` (`:94-98`) — and degrade to an empty dynamic set (never fabricated URLs) on failure (`:109-113`). **This is REAL, not hardcoded** — a genuinely good pattern.
- `vercel.json:26-33` rewrites `/sitemap.xml` and `/robots.txt` to `/api/index`, and `api/index.ts:15-40` implements those routes by calling the same `generateSitemapXml`/`generateRobotsTxt` functions with `process.env.PLATFORM_API_BASE_URL`.
- `generateRobotsTxt()` (`src/utils/sitemap.ts:226-238`) correctly references `Sitemap: ${baseUrl}/sitemap.xml` and disallows `/api/` and `/portal/admin/` (the latter path doesn't actually exist in the router — `/portal/admin/` isn't a real route in `App.tsx`, so this disallow rule is a no-op left over from an earlier URL scheme).
- **Two parallel backend/deploy targets exist for this repo** (see §7 for the full write-up): `api/index.ts` (Vercel serverless, referenced by `vercel.json`) only implements sitemap/robots/health/ai-consultant, while `server.ts` + `server/routes/v1/*` (the actual `npm run build && npm start` / `railway.json:6-13` / `Dockerfile` production path) implements a much larger legacy Express API (auth, CMS, products, leads, subscriptions, notifications, AI). The sitemap/robots logic is duplicated verbatim between `api/index.ts:14-40` and `server.ts` (same functions, two entry points) — a maintenance/consistency risk, and it's unclear from the code alone which one is actually serving production traffic. **NOT VERIFIED** which deploy target is live.

### Structured data (JSON-LD)
`grep "application/ld+json"` / `generateSeoStructuredData` hits: `src/utils/seo.ts` (real, current implementation), `src/data/blogData.ts:633` (a second, legacy implementation), and its two remaining call sites `src/components/blog/ArticleReaderModal.tsx:30` and `src/components/blog/BlogPostPage.tsx:44` (used only to render a "copy schema" preview in an SEO-inspector drawer, not to inject the live tag), plus `src/components/blog/SeoMetaEditor.tsx:20` and `src/components/blog/CreateArticleModal.tsx:29` (both part of the legacy in-browser blog editor UI that talks to nothing — see §7).

Schema types actually emitted live (via `setJsonLdScript`, i.e. what a crawler sees):
- **Blog post** (`generateBlogPostSeo`, `src/utils/seo.ts:587-714`): `@graph` with `TechArticle`/`BlogPosting` (configurable via `post.seo?.schemaType`), `BreadcrumbList`, nested `Organization`/`Person`/`AggregateRating`. Populated from the real post where the field exists (title, dates, category, author), but `aggregateRating` (`:651-657`) defaults to a **fabricated** `4.9` rating / `128` review count when `post.rating`/`post.ratingCount` are absent (`:598-599`) — and since the backend Post schema has no rating field at all (confirmed against `server/schemas/postSchemas.ts`, no rating fields), **every real post gets this fabricated 4.9★/128-review AggregateRating schema** unless a component manually overrides it. This is a genuine structured-data integrity issue (fake review counts in JSON-LD is exactly the kind of thing Google's spam policies target).
- **Product** (`generateProductSeo`, `src/utils/seo.ts:719-839`): `SoftwareApplication`/`Product` graph with `Offer` hardcoded to `price: '0.00'` (`:748`) and the same fabricated `aggregateRating` pattern (`ratingCount: 84` hardcoded at `:760`, never from real data — the backend Product schema has no rating/review field either).
- No `FAQPage`, `Organization`-only, or site-wide `WebSite` schema was found outside the per-page graphs above.

### Canonical on filtered/paginated views
Covered in §1 — `/blog?category=X` sitemap entries don't round-trip through the client filter and canonical is hardcoded to bare `/blog`, so there's no duplicate-content *canonical* bug, but there is a crawl-budget/dead-link bug.

---

## 3. artifysolscom — Design System, Accessibility, Responsiveness

**Design tokens:** Yes, a real token layer exists — `tailwind.config.js:1-89` maps Tailwind color utilities (`primary`, `secondary`, `background`, `surface`, `foreground`, `border`, `card`, `container`, `eco`, `input`) to CSS custom properties, and `src/index.css` defines a matching `@theme` block (Tailwind v4 syntax) re-exporting the same variable names (e.g. `src/index.css:3-7`). This is not ad hoc — components consistently use `bg-background`, `text-foreground-muted`, `border-border`, etc. rather than raw hex, e.g. `ContactAndBrief.tsx:121,145,189`. Raw hex still appears for one-off effects (`bg-[#F8FAFC]`, `bg-[#050505]` theme-root backgrounds repeated per-page — `App.tsx:434-436`, `AiSolutionsPage.tsx:83`, `AiProductDetailPage.tsx:81` etc.) rather than being pulled from the token file, which is a minor inconsistency (the light/dark page background color is duplicated as a literal in ~10 page components instead of a single `bg-background` token use).

**Sampled interactive components:**
| Component | Semantic HTML | aria-* | Focus management | Notes |
|---|---|---|---|---|
| `ContactAndBrief.tsx` (lead form) | `<form>`, `<label>` for every input (`:227-384`) | none beyond native `required` | n/a (not a modal) | Solid: real `<label htmlFor>` pairing, honeypot correctly hidden via CSS+`tabIndex={-1}` rather than `type="hidden"` (`:361-373`). |
| `AuthModal.tsx` (login/signup) | plain `<div>` overlay | **no `role="dialog"`, no `aria-modal`** (grep confirmed no matches in the file) | NOT VERIFIED (no focus-trap code found) | A key conversion modal has no dialog semantics for screen readers — contrast with Artify-Backend's `Modal` (below), which does this correctly. |
| `GlobalSearchModal.tsx` (⌘K palette) | NOT VERIFIED in depth | NOT VERIFIED | keyboard shortcuts (⌘K/Ctrl+K/`/`) implemented at `App.tsx:324-347` with input-focus guard | Good keyboard entry point; internal focus/ARIA not audited line-by-line given scope. |
| `BlogPage.tsx` search/filter bar | `<input>`, `<button>` | none | n/a | Functional but no `aria-pressed` on the active category chip (`:494-508`), so the selected filter state isn't exposed to assistive tech. |
| Image `alt` text | Sampled `Footer.tsx:122-125`, `Navbar.tsx:158-160`, `BlogPage.tsx:460-465,627-632`, `PortalSeoHealth.tsx:1522-1526`, `BlogPreviewSection.tsx:63-65` | all have real `alt` text | — | A naive single-line grep for `<img>` without `alt=` produced false positives (JSX attributes wrap across lines); every sample manually checked did have a real `alt`. Media Library also has an explicit `altText` field admins can set (`Artify-Backend/src/components/modules/MediaLibraryPage.tsx:147`), which flows through to `PublicMedia.altText` (`src/lib/publicApi.ts:15`). No broad alt-text gap was confirmed — **do not treat this as clean everywhere**, only the sampled files were checked. |

**Responsive patterns:** `sm:`/`lg:` breakpoints are used pervasively and consistently (e.g. `BlogPage.tsx:227-241,365`, `ContactAndBrief.tsx:141,224,258,291`), no evidence of ad hoc fixed-pixel-width components in the sampled files beyond intentional fixed-size UI chrome (avatars, icons). No systemic mobile-breakage pattern was found in the files read.

**Loading / empty / error states for REAL (API-backed) pages:**
| Page | Loading | Empty | Error |
|---|---|---|---|
| BlogPage | Yes (`:300-308`) | Yes, distinct copy for "no posts published yet" vs "no filter matches" (`:589-592`) | Yes, honest message, no fabricated fallback list (`:311-319`) |
| AiSolutionsPage | Yes (implied by `isLoading` state, `:24,31`) | NOT VERIFIED (not read past line 110) | Yes (`loadError` state, `:25,38-39`) |
| AiProductDetailPage | Yes (`:79-88`) | n/a (single resource) | Yes — explicit "not found" state (`:90-101`), though see §1 note on missing `noindex`/soft-404 |
| PortalSeoHealth | N/A — see §7, this "page" never shows a loading/error state because it seeds fabricated data synchronously and silently swallows the fetch failure (`:341-343`) | — | Silent catch, no user-facing error ever shown |

---

## 4. artifysolscom — Lead Capture / Form Integration

`src/components/ContactAndBrief.tsx:92-104` submits via `publicApi.submitLead()` → `POST /public/leads` (`src/lib/publicApi.ts:164-166`) with:

```
name, company, email, phone, subject, message, productInterest, source: 'project_brief', consent: true, website (honeypot)
```

Cross-checked against `Artify-Backend/server/schemas/publicSchemas.ts:40-51` (`createPublicLeadSchema`):

```
name (required, ≤200), company (optional, ≤200), email (required, valid email, ≤320),
phone (optional, ≤50), subject (optional, ≤200), message (required, ≤5000),
productInterest (optional, ≤200), source (enum incl. 'project_brief'), consent (must be true), website (honeypot, optional)
```

**Field-for-field match — this integration is correctly wired.** Client-side validation is native-HTML only (`required`, `type="email"`, `type="tel"` — `ContactAndBrief.tsx:230-288`), no client-side email-format or length pre-check beyond the browser default, so a user only learns of a length/format problem from the server's error message (surfaced honestly via `ApiClientError` at `:107-114`, not swallowed). Consent checkbox is required client-side before submit is even attempted (`:80-83`), matching the backend's `z.literal(true)` requirement. No known mismatch found.

---

## 5. Control Center (Artify-Backend/src) — Module Inventory

Full nav/module list is `Artify-Backend/src/lib/permissions.ts:107-424` (`NAV_ITEMS`), grouped by `section`:

- **Platform:** Dashboard, Users, Roles, Permissions, Organizations, Audit Log, Security, Settings
- **CRM:** CRM Dashboard, Leads, Clients, Contacts
- **Onboarding:** Overview, Pending Onboarding (same component, path-switched — see below)
- **Workspaces:** All Workspaces, Members (**same component, NOT path-switched** — see below)
- **Products:** All Products, Product Modules (**same component, NOT path-switched** — see below)
- **CMS:** Pages, Blog Posts, Categories & Tags, Authors, Media Library
- **Commercial:** Contracts, Subscriptions, Invoices, Payments
- **AI:** Overview, Providers & Models, Tools, Prompt Templates, Workflows, Executions, Usage & Costs, Approvals, Copilot
- **Client Portal:** Your Account (`ClientPortalPage`)

**Two nav entries are dead/duplicate UI**, confirmed by absence of any router-path branching in the target component:
- `products-all` (`/products`) and `products-modules` (`/products/modules`) both mount `ProductsPage` (`permissions.ts:236-252`); `ProductsPage.tsx` has no `useRouter`/path check anywhere in the file (grep confirmed zero matches) — clicking either nav item renders the identical page.
- `workspaces-all` (`/workspaces`) and `workspaces-members` (`/workspaces/members`) both mount `WorkspacesPage` (`permissions.ts:218-234`) with the same absence of path-branching (grep confirmed zero matches).
- By contrast, `onboarding-overview`/`onboarding-pending` correctly branch: `OnboardingPage.tsx:80-81` reads `useRouter().path` and sets `isPendingView = path === "/onboarding/pending"`. This is the reference pattern the other two modules should follow but don't.

**CMS — what admins can and can't do:**
- Pages/Posts: full CRUD + status lifecycle (`DRAFT`/`IN_REVIEW`/`SCHEDULED`/`PUBLISHED`/`ARCHIVED`, `server/schemas/postSchemas.ts:43`) including a real **Schedule** modal/date-picker in the UI (`PostsPage.tsx:216,253,290-292`, calling `postsApi.schedule(post.id, scheduledAt)`).
- Categories/Tags: full CRUD via `CmsTaxonomyPage.tsx:35-36,86-87,134` (`categoriesApi`, `tagsApi`).
- Authors: managed via `AuthorsPage.tsx` (create/edit, `userId`/`avatarUrl` fields).
- Media Library: upload + metadata edit including `altText`/`caption`/`displayName` (`MediaLibraryPage.tsx:78,147,223`).
- **SEO fields: NOT manageable from the UI at all.** `grep -i seo` in `PostsPage.tsx` and `PagesPage.tsx` returns zero matches, and `server/schemas/postSchemas.ts` has no `seo`/`metaTitle`/`metaDescription`/`ogImage` field anywhere. The public projection's `seo` object (`publicSiteService.ts:52,70`) is sourced from a generic `revision.metadata` JSON blob that no admin screen writes to — meaning every real post/page's `seo` field is effectively always `{}` in practice, and the frontend's `generateBlogPostSeo`/`generateProductSeo` per-post title/description/OG overrides (`src/utils/seo.ts:691-711`) can never actually be set by a content editor today. This can only be done via direct API/DB access, not the Control Center UI. This is a genuine, confirmed CMS gap.

**CRM — pipeline vs flat list:** `LeadsPage.tsx` implements a `LeadStatus` pipeline — `NEW → CONTACTED → QUALIFIED → CONVERTED/LOST` (`:11,277`) with status-filter buttons and an explicit "convert" action (`:327,332`) gated by `canConvert`. This is a filterable-list-with-stage-transitions, not a drag-and-drop Kanban board, but it does satisfy "lead → opportunity → won/lost" tracking at a functional level.

**Products/Services — what's editable:** `ProductsPage.tsx`'s `ProductFormModal` (`:32-85`) only exposes `code, name, slug, type, shortDescription, description, status, isFeatured`. Cross-checked against `server/schemas/productSchemas.ts:28-65` (`createProductSchema`/`updateProductSchema`) — **there is no `price`, `features`, `screenshots`, or `FAQ` field anywhere in the backend schema**, so this isn't just a missing UI control, it's a missing data model. **An admin cannot manage a product's pricing, features, screenshots, or FAQs from the UI or the API today — the capability doesn't exist end to end.** `status` does support a publish-like lifecycle (`DRAFT/ACTIVE/INACTIVE/ARCHIVED`).

**Client Portal (`ClientPortalPage.tsx`):** Real, read-only, API-backed (`portalApi`, `:10`) — contracts/subscriptions/invoices/payments scoped server-side to the caller's own organization (explicit comment, `:1-6`: "No create/update/issue/void/reverse controls exist here"). See §7 for the duplication with artifysolscom's own mocked portal.

**Notifications:** No nav entry, no Header bell/inbox UI (`Header.tsx` — grep for `notification`/`Bell`/`fetch` returned zero matches). Backend has automation/notification engines (`server/services/automation/NotificationEngine.ts`) but nothing in the Control Center surfaces them to an admin as a UI module. Classify as **UNUSED at the UI layer**.

**Dashboard/Analytics (`DashboardPage.tsx`):** Explicitly commented "real data only, no fabricated metrics" (`:1`) and backs that up — pulls `organizationsApi.summary()` and `auditLogsApi.list()` only (`:41-47`), degrading each card by permission. Minimal but **REAL and honest** — a useful positive contrast to artifysolscom's `PortalSeoHealth` (§7).

No module was found that renders a "coming soon"/placeholder stub — the two path-duplication issues above (Products, Workspaces) are the closest things to a BROKEN/UNUSED nav entry.

---

## 6. Control Center — Design Consistency with Public Site

**No shared design system.** Confirmed independently-styled codebases:
- artifysolscom uses a Tailwind **config-file** token layer (`tailwind.config.js:1-89`) plus a matching Tailwind v4 `@theme` block in `src/index.css:3-60`, with token names like `--color-primary`, `--color-surface`, `--color-card`, dark mode via `.theme-dark` class (`tailwind.config.js:3`).
- Artify-Backend has **no `tailwind.config.js` at all** (confirmed absent) — it uses bare `@import "tailwindcss"` plus a small hand-rolled `:root`/`.dark` CSS-variable block (`Artify-Backend/src/index.css:6-33`) with entirely different token names (`--bg-app`, `--bg-surface`, `--accent`), dark mode via a plain `.dark` class (`:8`) rather than artifysolscom's `.theme-dark`.
- No shared file, package, or import connects the two — each repo declares its own Google Fonts `<link>` independently (`artifysolscom/index.html:63-76` vs `Artify-Backend/index.html:12-14`), both coincidentally choosing **Plus Jakarta Sans + JetBrains Mono**, and both landing on a similar indigo/violet accent hue (`#4f46e5`-family in Artify-Backend's `--accent`, violet/indigo Tailwind utilities in artifysolscom) — but this is convergent/coincidental branding discipline, not a shared token package. A rebrand today would require editing color values in two unrelated files by hand and would very likely drift.
- Component primitives are also separate implementations: artifysolscom has no shared `ui/` kit (styling is per-component Tailwind classes), while Artify-Backend has a small internal kit (`Artify-Backend/src/components/ui/ui.tsx` — `Card`, `Button`, `Modal`, `Badge`, `Pagination`, etc.) that isn't shared with or reused by artifysolscom.
- Accessibility-of-primitives asymmetry: Artify-Backend's shared `Modal` correctly sets `role="dialog"`, `aria-modal="true"`, `aria-labelledby` (`Artify-Backend/src/components/ui/ui.tsx:155-162`); artifysolscom's `AuthModal.tsx` (its closest equivalent, hand-rolled per-component rather than from a shared kit) has none of that.

---

## 7. Cross-Cutting Feature Classification Table

| Feature | Classification | Evidence | Repo / File |
|---|---|---|---|
| Blog publishing → public site | REAL | `PostsPage.tsx` schedule/publish (Backend) → `publicApi.listPosts/getPostBySlug` (site) → `BlogPage.tsx:72-88` | Both repos, wired correctly |
| Blog SEO fields (meta title/desc/OG per post) | **PARTIAL / gap in data model** | No SEO UI in `PostsPage.tsx`/`PagesPage.tsx`; no `seo` field in `postSchemas.ts`; `publicSiteService.ts:52,70` maps a generic unused `revision.metadata` | Artify-Backend |
| Homepage blog teaser | **MOCKED** | `BlogPreviewSection.tsx:3,17` | artifysolscom |
| Global search (products/solutions/blog) | **MOCKED** | `GlobalSearchModal.tsx:23-26` | artifysolscom |
| Case studies | **MOCKED, presented as real customer outcomes** | `CaseStudiesSection.tsx:12` + `data/solutionsData.ts` fabricated metrics | artifysolscom |
| Product catalog (list + detail) | REAL | `AiSolutionsPage.tsx:33-47`, `AiProductDetailPage.tsx:28-49` | artifysolscom (consumes Artify-Backend) |
| Product pricing / features / screenshots / FAQ management | **UNUSED / not implemented anywhere** | No field in `productSchemas.ts:28-65`, no UI in `ProductsPage.tsx` | Artify-Backend (data-model gap, not just UI) |
| Lead capture (contact/brief form) | REAL | `ContactAndBrief.tsx:92-104` ↔ `publicSchemas.ts:40-51` | artifysolscom → Artify-Backend, verified field match |
| CRM pipeline (lead → won/lost) | REAL (flat-list + stage filter, not Kanban) | `LeadsPage.tsx:11,277,327,332` | Artify-Backend |
| Client onboarding | REAL, correctly path-branched | `OnboardingPage.tsx:80-81` | Artify-Backend |
| Client Portal (billing/invoices/contracts, read-only) | REAL | `ClientPortalPage.tsx:1-50`, `portalApi` | Artify-Backend |
| Client Portal (subscriptions/invoices/products, on the public site) | **MOCKED, and DUPLICATED with the above** | `AuthContext.tsx:3`, `PortalSubscriptions.tsx:3`, `PortalProducts.tsx:3` all import `data/portalData.ts`; `apiClient.ts:14-19` documents this is intentionally not yet wired | artifysolscom — two parallel, non-integrated "client portal" experiences under two different domains |
| Site SEO Health / meta-tag AI tool | **BROKEN — fabricated data presented as live telemetry** | `PortalSeoHealth.tsx:309-330` hardcodes fake Core Web Vitals/keyword rankings as initial state; `:334,341-343` fetches a same-origin relative `/api/v1/cms/seo-telemetry` and **silently keeps the fabricated defaults on any failure**; `:367,384-400` has a "fallback" that fabricates an AI-generated meta-tag result when the real Gemini call fails, presented identically to a real result | artifysolscom (backed by its own legacy `server/routes/v1/cmsRoutes.ts:142-199`, itself 100% hardcoded numbers, not derived from Search Console or any analytics source) |
| Legacy duplicate backend | **DUPLICATED / mostly dead** | `artifysolscom/server/` + `server.ts` implement a full second Auth/CMS/Products/Leads/Subscriptions/AI API with an **in-memory** store (`server/core/db.ts:23-41`) that resets on restart and seeds a **plaintext admin password literal in source** (`server/core/db.ts:136`: `ArtifyAdmin2026!`, similarly `:152,181`), hashed only with unsalted SHA-256 (`:47-49`). Only 2 of its ~9 route groups are still called by the frontend (`seo-telemetry`, `optimize-meta` — both fabricated, see above); its own `/api/v1/leads` (`server/routes/v1/leadRoutes.ts`) is not called by any current frontend code (grep confirmed) | artifysolscom — this is what `npm run build`/`start`/`railway.json`/`Dockerfile` actually deploy, running alongside/instead-of the Vercel `api/index.ts` serverless functions that `vercel.json` configures; NOT VERIFIED which one serves production, but the two have diverged feature sets |
| Notifications | **PARTIAL / UNUSED at UI layer** | Backend automation engine exists (`server/services/automation/NotificationEngine.ts`, Artify-Backend); no nav entry, no bell/inbox UI in `Header.tsx` (Artify-Backend) or `Navbar.tsx` (artifysolscom) | Artify-Backend |
| Analytics / admin dashboard | REAL, honest, minimal | `DashboardPage.tsx:1,41-47` (explicit "no fabricated metrics" comment) | Artify-Backend |
| Sitemap / robots.txt | REAL (live-content-derived) | `utils/sitemap.ts:85-181`, `api/index.ts:15-40` | artifysolscom |
| JSON-LD structured data | REAL shell, **fabricated ratings inside it** | `utils/seo.ts:598-599,651-657,748,757-763` (fake `4.9`★/128 and `84` review counts baked into every post/product's schema) | artifysolscom |

---

## Summary of "NOT VERIFIED" items (would require a live/runtime check)
- Which of artifysolscom's two backend entry points (`api/index.ts` on Vercel vs. `server.ts`+`server/` on Railway/Docker) is actually serving production traffic.
- Real-world severity of the stale-meta-on-client-navigation issue (§2) — needs a rendered-DOM crawl, not just code reading.
- Whether Google/Search Console currently has any of the fabricated case-study or AggregateRating claims indexed.
- Full accessibility audit (focus trapping, full ARIA coverage) beyond the sampled components in §3.
