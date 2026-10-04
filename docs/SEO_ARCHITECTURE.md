# SEO Architecture

## Principle
Every piece of SEO metadata the public site emits is derived from real, published content returned by
`/api/v1/public/*` — never invented copy, never a placeholder score presented as real.

## Sitemap / robots.txt (`artifysolscom/src/utils/sitemap.ts`)
`getSitemapUrlList()`/`generateSitemapXml()` are async: they fetch published posts, `ACTIVE` products, and
categories live from the Platform API (`resolveApiBaseUrl()` — `VITE_PLATFORM_API_BASE_URL` in the browser via
`SitemapModal.tsx`, `PLATFORM_API_BASE_URL` server-side via `server.ts`/`api/index.ts`) and build entries only
from that response. A handful of static core routes (`/`, `/blog`, `/solutions`, …) remain fixed since they're
not backed by dynamic content. If the API is unreachable or unconfigured, dynamic entries are simply omitted —
the sitemap degrades to the static core pages rather than fabricating article/product URLs. `robots.txt`
disallows `/api/` and `/portal/admin/` and points at the dynamic sitemap. This generator is **not** duplicated
in this repo (Artify-Backend) — see "Sitemap pagination fix" below for the one bug found and fixed in it as
part of Phase 5.

## Per-page metadata
- **Blog**: `BlogPostPage.tsx` calls the pre-existing `generateBlogPostSeo(post, …)` unchanged — it already
  worked from the `BlogPost` shape, and `mapPostToBlogPost()` supplies that shape from real `Post` data
  (title/excerpt/tags/author/cover image straight from the CMS). `seo.seoScore` — a fabricated always-92/100
  badge in the editor-only SEO Inspector — shows `—` when the real post carries no score rather than a fake
  one.
- **Products**: `AiProductDetailPage.tsx` builds its own `updatePageSeo()` call directly from the real
  `Product` (`name`, `shortDescription`) — the old `generateProductSeo()` generator assumed the fictional
  `AiProductItem` shape and was not reused.

## No unpublished-content leakage
The sitemap and every SEO call source exclusively from `/api/v1/public/*`, which itself only ever returns
`PUBLISHED` Pages/Posts and `ACTIVE` Products (see `PUBLIC_API_ARCHITECTURE.md`) — a draft, scheduled, or
archived record can never reach a `<meta>` tag, JSON-LD block, or sitemap URL.

---

# Phase 5 — SEO Control Center

Closes the two confirmed backend gaps named in `docs/control-center-gap-analysis.md`'s SEO row: no redirects
mechanism, and SEO metadata quality had no visibility beyond the raw fields on Post/Page. Sitemap/robots.txt
generation itself is **not** duplicated here — it already lives in `artifysolscom`'s `src/utils/sitemap.ts` /
`api/index.ts`, sourced from the existing public list endpoints (see above); this phase fixed a real bug there
instead (see "Sitemap pagination fix" below) rather than building a second generator.

## Redirects

`Redirect` (`prisma/schema.prisma`) is a standalone table, not a foreign key onto Post/Page — a redirect must
keep working after the content it originally pointed to is renamed again, deleted, or never existed at all (a
manually-created vanity redirect). `(organizationId, fromPath)` is unique, so the public site's lookup is a
single indexed equality check on its hot path (a 404).

- **CRUD**: `server/services/redirectService.ts` + `server/routes/v1/redirectRoutes.ts`, mounted at
  `/api/v1/redirects`. Permission keys: `seo.redirects.read/create/update/delete` (ADMIN gets all four,
  MANAGER read/create/update, USER/VIEWER read-only — `prisma/rolePermissionSeed.ts`).
- **Auto-creation on slug change**: `postService.updatePost` calls
  `redirectService.autoRedirectOnSlugChange()` when a post's slug changes AND the post is (still) `PUBLISHED`
  after that same update — gated on the *resulting* status, not the prior one, so a PATCH that both renames
  the slug and unpublishes the post creates no redirect (there'd be no live page to send visitors to). Since
  Phase 4, `pageService.updatePage` does the identical thing for Pages, now that they have a real public URL
  format to redirect within (`/:slug` at the site root, not `/blog/:slug`) — see "Pages have a public route"
  below.
- **Chain collapse**: renaming twice (A→B, then B→C) repoints the A→B redirect to A→C directly
  (`redirectRepository.repointChainedRedirects`) rather than leaving a dead intermediate hop.
- **Open-redirect hardening**: `fromPath`/`toPath` must be site-relative (`/...`, not `//...`) and must not
  contain a URL scheme anywhere in the string (`server/schemas/redirectSchemas.ts`) — a redirect's `toPath`
  drives a real HTTP redirect on the public site, so this blocks the classic bypasses (`//evil.com`,
  `/ok/https://evil.com`).
- **Public consumption**: `GET /api/v1/public/redirects?path=...` (unauthenticated, `publicSiteService.
  getRedirectForPath`) returns `{ toPath, statusCode } | null` for the single configured
  `PUBLIC_WEBSITE_ORGANIZATION_ID` tenant, same pattern as every other `/public/*` route. `artifysolscom`'s
  `BlogPage.tsx` calls this when a `/blog/:slug` lookup 404s, before showing a hard not-found page.

## Rule-based SEO audit

`server/services/seoAuditService.ts`, exposed at `GET /api/v1/seo/issues` (permission `seo.audit.read`).
Every check is a plain, explainable rule against real content the org already has:

- Missing meta title / meta description (severity `critical` if the post/page is `PUBLISHED`/`SCHEDULED`,
  `warning` if still `DRAFT`/`IN_REVIEW` — nothing is flagged for `ARCHIVED` content, which is excluded from
  the audit entirely).
- Meta title over ~60 characters, meta description outside the ~50–160 character range likely to display
  cleanly in a search snippet.
- A featured image with no alt text.
- Duplicate meta titles across Posts/Pages within the same organization.

**Deliberately not checked**: missing `canonicalUrl`. The public site's `generateBlogPostSeo()`/
`updatePageSeo()` (in `artifysolscom`) already compute a sane default canonical from the slug when one isn't
set explicitly, so an absent canonical isn't actually broken — flagging it would be a fabricated issue.
Nothing here is framed as, or contributes to, a numeric "SEO score" — each finding names the specific rule it
failed and links back to the record via `resourceId`.

## Sitemap pagination fix

Not a new capability, but found and fixed as part of this phase's audit: `artifysolscom/src/utils/sitemap.ts`
called `/public/posts?limit=50` and `/public/products?limit=50` once each — the public list endpoints cap
`limit` at 50 per page server-side (`server/schemas/publicSchemas.ts`), so any org with more than 50 published
posts or products had a sitemap that silently omitted everything past the 50th from search engines. Fixed to
follow `meta.pagination.totalPages` and fetch every page (`fetchAllPages()`, capped at 40 pages as a sanity
ceiling against a runaway total).

## Pages have a public route (Phase 4)

Was a known gap through Phase 5/11: `publicApi.getPageBySlug()` existed and was fully wired end-to-end on the
backend, but nothing in the public site's routing (`App.tsx`) ever called it — a CMS `Page` could be authored
and published in the Control Center but never actually rendered anywhere on `artifysols.com`. Phase 4 (scoped)
closed this: `App.tsx`'s router now falls back to a generic single-segment-path catch-all after every reserved
static route, resolved by the new `CmsPageRoute.tsx` against the real API — with the same
redirect-table-fallback-then-genuine-404 pattern `BlogPage.tsx` already used for posts. Pages render at the
site root (`/:slug`), not under a `/blog/`-style prefix. This is a real public route, not the full
website-management/page-builder vision (`control-center-roadmap.md`'s Phase 4, "Website Management" — still
not started: no homepage/nav/section-driven authoring, no visual builder). A published Page whose slug
collides with one of the site's existing hardcoded routes (`/services`, `/about`, etc.) is unreachable —
the reserved static routes always win — a known, accepted limitation of a slug-based catch-all with no shared
registry between the two, not a bug.

## RBAC summary

| Key | ADMIN | MANAGER | USER | VIEWER |
|---|---|---|---|---|
| `seo.redirects.read` | ✓ | ✓ | ✓ | ✓ |
| `seo.redirects.create` | ✓ | ✓ | | |
| `seo.redirects.update` | ✓ | ✓ | | |
| `seo.redirects.delete` | ✓ | | | |
| `seo.audit.read` | ✓ | ✓ | ✓ | ✓ |

---

# Phase 8 — Advanced SEO Control Center

Extends Phase 5 rather than replacing it: same `Redirect` table, same `seoAuditService`, same per-content
`metadata` JSON field (`server/schemas/contentSchemas.ts`'s `seoMetadataSchema`, already comprehensive).

## Crawler-visible metadata (server-rendered, not just client-side)

`artifysolscom` is a client-rendered SPA — before this phase, every `<meta>`/`<title>`/`<link rel="canonical">`
tag was written by `updatePageSeo()` mutating `document.head` **after** hydration, which a crawler that doesn't
execute JS (or times out before React mounts) never sees. `artifysolscom/api/index.ts`'s catch-all handler now
resolves the same metadata server-side (`src/utils/ssrMeta.ts`: `renderSeoForPath`) and injects it into the
real HTML response before it reaches the client — a lightweight "SSR for `<head>` only," not a full
React-SSR rewrite. It mirrors each page's own client-side SEO-building logic exactly (reuses
`generateBlogPostSeo`/`generateDefaultPlatformSeo`, mirrors `AiProductDetailPage.tsx`'s inline logic) so
server- and client-rendered tags never drift apart; the client's own `updatePageSeo()` call after mount is a
harmless no-op re-application of the same values. Also fixes two real bugs found during this work: a redirect
cycle (A→B→A, however created) previously recursed forever instead of terminating in a not-found state
(`CmsPageRoute.tsx`'s `resolveSlug`, and the server-side `resolveRedirectChain`, both now guarded by a
`visited` set); and every unmatched path previously returned HTTP 200 (a soft-404) instead of a real 404 with
`noindex, nofollow`.

## Redirect Manager hardening

- **Loop prevention**: `redirectService.assertNoRedirectCycle` walks the chain from a new/updated redirect's
  `toPath` (same bounded-walk pattern as `pageService.assertParentUsable`'s parent-cycle check) and rejects
  with 409 if it would ever land back on its own `fromPath` — both the 1-hop case (`A -> A` directly) and a
  multi-hop cycle through other existing redirects (`A -> B -> C -> A`).
- **Active/inactive + notes**: `isActive` (default `true`) and `notes` (nullable) columns
  (migration `20261003192318_phase8_redirect_active_notes`). `publicSiteService.getRedirectForPath` skips an
  inactive redirect entirely (treated as if it didn't exist) — a redirect can be kept for reference/history
  without it being live. `GET /api/v1/redirects` accepts `?isActive=true|false` to filter the list.

## Expanded rule-based SEO audit

Three new checks added to `seoAuditService.ts`, same deterministic/explainable shape as Phase 5's:
- `duplicate_meta_description` — same cross-content duplicate-detection as `duplicate_meta_title`, generalized
  into one `findDuplicateField` helper.
- `invalid_slug_format` — flags a slug outside `^[a-z0-9]+(-[a-z0-9]+)*$` (this system's own `slugify()` output
  shape); the input schema's own regex is looser (allows doubled/leading/trailing hyphens), so this catches a
  slug that's technically valid input but not what this system would ever generate itself.
- `missing_social_image` — a `PUBLISHED`/`SCHEDULED` post or page with no `ogImage` **and** no featured image
  set at all (one or the other is enough; this only fires when neither exists).

## Global → content SEO defaults precedence

Phase 3's Site Identity already had `defaultMetaTitle`/`defaultMetaDescription`/`socialImageMediaId` fields,
but nothing read them for individual content — they were configurable but dead. `publicSiteService.
applySeoDefaults` now fills a post/page's `metaTitle`/`metaDescription`/`ogImage` from the organization's
published Site Identity **only when the content's own field is genuinely unset** — an explicit value on the
post/page always wins, and a featured image still outranks the site-wide social image for `ogImage` specifically.
This is the global layer of the precedence chain (global → content-type → template → page/post override);
template- and content-type-level SEO defaults are not implemented in this phase — every post/page currently
either sets its own values or falls straight through to the global Site Identity defaults.

## Content SEO field coverage + previews (Control Center UI)

`PostFormModal`/`PageFormModal`'s SEO section previously exposed only `metaTitle`/`metaDescription`/`ogImage` —
`seoMetadataSchema` already supported `canonicalUrl`, `robotsDirective`, `ogTitle`, `ogDescription`,
`twitterImage`, `ogType`, `twitterCard`, `focusKeywords`, and `schemaType` with no UI to set them. The new
shared `src/components/common/SeoFieldsPanel.tsx` exposes every field (with character counts against the same
limits `seoMetadataSchema` enforces) and renders a live Google-result preview and an Open Graph/Twitter card
preview, both built from the same fallback chain the public site actually uses (explicit value → content
title/excerpt → nothing) — never a fabricated example. The SEO Dashboard (`SeoIssuesPage.tsx`) was extended
with real counts (active/total redirects, total posts+pages, posts/pages with no flagged issues) alongside the
existing issue list — still no fabricated "SEO score," traffic estimate, or ranking prediction, since this
system has no real data source for any of those.
