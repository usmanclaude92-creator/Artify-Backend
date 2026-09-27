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
  the slug and unpublishes the post creates no redirect (there'd be no live page to send visitors to).
  **Pages are not wired to this** — they have no public route yet (see "Known gap: Pages have no public
  route" below), so an auto-created Page redirect would point at a URL format nobody has decided on.
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

## Known gap: Pages have no public route

`publicApi.getPageBySlug()` (`artifysolscom/src/lib/publicApi.ts`) exists and is fully wired end-to-end on the
backend, but nothing in the public site's routing (`App.tsx`) ever calls it — a CMS `Page` can be authored and
published in the Control Center but never actually renders anywhere on `artifysols.com`. This is why the SEO
audit still scores Pages (their metadata will matter once they're reachable) but the auto-redirect and public
redirect-lookup wiring is Post-only for now. Giving Pages a real public route is website-management/
page-builder scope (`control-center-roadmap.md`'s Phase 4, "Website Management" — not started, needs its own
design pass), not an SEO fix.

## RBAC summary

| Key | ADMIN | MANAGER | USER | VIEWER |
|---|---|---|---|---|
| `seo.redirects.read` | ✓ | ✓ | ✓ | ✓ |
| `seo.redirects.create` | ✓ | ✓ | | |
| `seo.redirects.update` | ✓ | ✓ | | |
| `seo.redirects.delete` | ✓ | | | |
| `seo.audit.read` | ✓ | ✓ | ✓ | ✓ |
