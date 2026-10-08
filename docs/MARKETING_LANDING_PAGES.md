# Marketing: Landing Pages (Step 12)

## Architecture chosen (10 lines)

1. **Landing pages are existing CMS `Page` rows** (`pageType = LANDING`) with `ContentRevision` for versions (blocks in `editorBlocks`, SEO in `metadata`). No parallel page system: slug uniqueness, revision history and restore, redirect-on-slug-change, audit and the Approvals store already exist and are reused.
2. **Builder pages are marked** by a new column `pages.landing_builder` (and `landing_unpublished_at` for the 410). The one legacy `LANDING` page in production (`dummy-test-landing`, served at its normal CMS path) is untouched.
3. **A restricted block set** (`lp_hero`, `lp_benefits`, `lp_features`, `lp_testimonials`, `lp_pricing`, `lp_faq`, `lp_cta`, `lp_form`, `lp_footer`) joins the existing `editorBlocks` union and is the ONLY thing accepted on builder pages: plain text only (never HTML), images by Media-library id with mandatory alt text, links validated, `isPlaceholder` content blocks publishing.
4. **Lifecycle** maps onto the existing statuses: DRAFT → IN_REVIEW (= pending approval) → PUBLISHED → UNPUBLISHED (= DRAFT + `landing_unpublished_at`) / ARCHIVED. Publishing happens only through the **Approvals center**, as a new source `landing` over the same `automation_approvals` store, decided with `marketing.landing.publish` (ADMIN/SUPER_ADMIN).
5. **Public API**: `GET /public/landing` (published + indexable list, for the sitemap) and `GET /public/landing/:slug` (published only, explicit public projection, media resolved server-side; 410 once a page was unpublished, 404 if it never existed); preview through a hashed, expiring token (`GET /public/landing-preview/:token`, `no-store`, `noindex`).
6. **Public rendering** on artifysols.com at **`/lp/<slug>`** by the website's existing Express function: standalone server-rendered HTML (no React bundle, no inline script), CDN-cached with `s-maxage` + stale-while-revalidate (≤ 60 s staleness after a publish), canonical/OG/robots meta, `noindex` per page, listed in `sitemap.xml` only when published and indexable.
7. **Lead form** = a `lp_form` block whose config (fields, consent text, privacy link, success message/redirect) is synced into a system-managed `Form` row per page, so the existing `publicFormService` pipeline is reused unchanged: validation, honeypot, rate limit, Lead create/merge, `form.submitted` automation, notifications, analytics event. Added: required consent checkbox, **first-touch and last-touch** UTM + referrer stored on the lead, `source = landing:<slug>`.
8. **Analytics** reuse the website's existing first-party beacon (`page_view`, tab-scoped random `sessionId`, no personal data) and `form_submission` events filtered by path `/lp/<slug>`; the UI shows views, **unique sessions** (not "visitors"), submissions, and conversion = submissions / unique sessions, with honest empty states.
9. **Permissions**: `marketing.landing.read` = roles with `content.read`, `.edit` = roles with `content.update`, `.publish` = ADMIN, SUPER_ADMIN (migration derives them in SQL).
10. **Why**: the smallest new surface. Everything risky (forms, leads, approvals, redirects, revisions, media access, public caching) is code that has been audited and tested already; the new work is the block contract, the lifecycle rules, one public projection, and a renderer.

## Audit findings (what was reused, what was missing)

### Control Center / API (`Artify-Backend`)
| Area | What exists | Used for landing pages |
|---|---|---|
| CMS page model | `Page` + `ContentRevision` (`editorBlocks`, `metadata`), `PageType.LANDING`, `TemplateType.LANDING_PAGE`, revisions + `revertPage`, optimistic concurrency, slug unique per org, scheduling | Extended, not duplicated |
| Lifecycle | `pageService` DRAFT→IN_REVIEW→PUBLISHED→ARCHIVED, `contentApprovalService` (submit → approvals row → approve publishes) | Same engine; landing gets its own approvals source + permission |
| Approvals center | Read-only aggregation over `ai`, `automation`, `content`, `social` sources, decisions delegate to each service | New source `landing` (content approvals whose page is a builder page) |
| Redirects | `Redirect` model + `redirectService`, public `GET /public/redirects` | Slug change → redirect `/lp/old` → `/lp/new` |
| Media | `MediaAsset`, public projection ACTIVE+PUBLIC only, `resolvedUrl` | Images by id, alt text required in the block schema |
| Forms / leads | `Form`, `FormSubmission` (consent, UTM, landing path, referrer), `publicFormService.submit` (honeypot, validation, lead merge, automation event, analytics event, in-app notifications), `publicLeadLimiter` | Reused through a managed Form per page |
| Attribution | `campaignAttributionService.resolveCampaignId(utm_campaign)` | Reused |
| Analytics | `AnalyticsEvent` (`page_view`, `form_submission`, path, sessionId, UTM), public beacon `POST /public/analytics/events` (rate limited) | Per-page counts; no new tracking table |
| Public API | `/api/v1/public/*`, GET cached `s-maxage=60, swr=300`, every response an explicit projection | New `/public/landing*` follows the same rules |
| Sidebar | `NAV_ITEMS`, section **Marketing** (Dashboard, Forms, Campaigns), **Website Management** (Pages, Site Editor, …) | New **Marketing → Landing Pages** item |
| Gaps found | no preview tokens, no 410 semantics, no landing-specific blocks or placeholders, no first/last touch columns, `form` block only references a Form id, no per-page stats, no UTM link helper, `content.publish` could publish any page | Built in this step |

### Website (`artifysolscom`)
| Area | What exists | Notes |
|---|---|---|
| Delivery | Vite SPA + one Express serverless function (`api/index.ts`) behind a catch-all rewrite; it serves `sitemap.xml`, `robots.txt`, and injects server-rendered meta into the SPA shell for known routes | `/lp/<slug>` has no owner today (multi-segment paths fall through) |
| SEO | `ssrMeta.ts` (`renderSeoForPath`, `buildCmsPageMeta`), `sitemap.ts` (core + products + posts + case studies + categories; CMS pages are **not** in the sitemap) | Landing pages add entries only when published + indexable; with none published the sitemap is byte-identical |
| Dynamic content | `publicApi.ts` against `PLATFORM_API_BASE_URL` (`/public/*`), `CmsPageRoute` + `PublicBlockRenderer` for the generic `editorBlocks` | Landing blocks are NOT rendered through the SPA |
| Forms | `PublicForm.tsx` (client-side, honeypot, UTM from `window.location`), `POST /public/forms/:slug/submit` | Landing form works without any client JS (progressive enhancement) |
| Analytics | `analytics.ts` beacon (`page_view`, tab-scoped `sessionStorage` id) | Landing pages send the same beacon from a tiny same-origin script |
| Brand | Violet `#7C3AED` (hover `#6D28D9`, subtle `#EDE9FE`), Plus Jakarta Sans | Templates and renderer use these tokens |
| Build / tests | `npm run build`, `vitest` (`sitemap`, `ssrMeta`, `CmsPageRoute`, `vercelFunctionImports`) | Must stay green; existing pages and sitemap unchanged |

## Setup

1. **Database**: apply `prisma/migrations/20261019090000_marketing_landing_pages` (additive and idempotent: new `pages` columns, `forms.landing_page_id`, `first_touch` on `leads`/`form_submissions`, table `landing_preview_tokens` with RLS, the three permissions and their role grants). In production it is applied with the Supabase migration tool and recorded in `_prisma_migrations`.
2. **Backend env vars** (all already exist, nothing new):
   | Variable | Needed for |
   |---|---|
   | `PUBLIC_WEBSITE_ORGANIZATION_ID` | the workspace whose landing pages, forms and leads the public site uses (must be the workspace the editors work in) |
   | `PUBLIC_SITE_BASE_URL` | builds the public link in the UI, the private preview link and the Composer UTM link. Without it those links show only the relative path (the UTM helper refuses to insert a link) |
   | `CORS_ORIGINS` | must list `https://artifysols.com` so the page can post the form and the page-view beacon to the API |
3. **Website env vars** (no new ones): `PLATFORM_API_BASE_URL` (server side; read by the Express function for pages, previews, sitemap, the no-JS form fallback, and handed to the browser script as `data-api`). No `VITE_*` variable is involved: landing pages are not part of the React bundle.
4. **Roles**: see "Permissions".

## Permissions

| Permission | Granted to |
|---|---|
| `marketing.landing.read` | every role with `content.read`: SUPER_ADMIN, ADMIN, MANAGER, USER, VIEWER (never CLIENT_PORTAL) |
| `marketing.landing.edit` | every role with `content.update`: SUPER_ADMIN, ADMIN, MANAGER |
| `marketing.landing.publish` | SUPER_ADMIN, ADMIN only |

`edit` covers create, save, preview links, submit/withdraw an approval request, archive a page that is not live and restore. `publish` is needed to approve (Approvals center, source "Landing page"), to unpublish, to archive a live page and to change the address of a live page. The generic `content.publish` / automation approval endpoints cannot publish a landing page (the approval engine refuses `landing_page` approvals).

## Publishing flow

```
DRAFT --submit--> PENDING_APPROVAL --approve--> PUBLISHED --unpublish--> UNPUBLISHED (address answers 410)
  ^                    |reject / withdraw             |edit (new draft, live page untouched) -> submit -> approve (replaces live)
  +--------------------+                              +--archive--> ARCHIVED (410 if it was ever live)
```

* The publish checklist (shown in the editor and enforced by the API on submit **and** again on approval) requires: a meta description, no block still flagged `placeholder`, no `[[Replace: …]]` text anywhere, and (for testimonials) the explicit "these are real quotes" confirmation.
* While a request is pending the page is locked; the author can withdraw it.
* The reviewed revision is what goes live. If the draft changed after submission, approving is refused.
* Version history lists every saved revision. Restore never rewrites history: it clones the old revision into a new draft which still needs approval.
* Preview: "Private preview link" creates a 256-bit token (only its SHA-256 is stored), valid 1 to 72 hours, revocable. The URL `https://<site>/lp-preview/<token>` renders the saved draft with the same renderer as production, `Cache-Control: no-store`, `noindex`, `Referrer-Policy: no-referrer`; the form is disabled.
* Address change on a page that has been published creates a 301 from `/lp/<old>` to `/lp/<new>` (query string kept). Unpublished or archived pages answer **410**; addresses that never existed (or never went live) answer 404. Reserved addresses (`admin`, `api`, `blog`, `contact`, … see `RESERVED_LANDING_SLUGS`) cannot be used.
* Cache: pages are sent with `s-maxage=60, stale-while-revalidate=300` by both the website function and the API, so a publish or unpublish is visible within about two minutes. Previews are never cached.

## Blocks reference

All text is plain text with length limits and is escaped on output; there is **no** HTML, script, iframe or style field. Images are Media-library ids (ACTIVE + PUBLIC assets only) with mandatory alt text. Links must be `https://…`, `/path`, `#anchor`, `mailto:` or `tel:`. A page has exactly one hero (first, the only H1), at most one lead form and one footer (last), at most 20 blocks.

| Block | Fields |
|---|---|
| `lp_hero` | eyebrow, headline (H1), subheadline, primary CTA, secondary CTA, image |
| `lp_benefits` | heading, 2 to 6 items (title, text) |
| `lp_features` | heading, intro, 1 to 8 items (title, text, image) |
| `lp_testimonials` | heading, 1 to 6 quotes (quote, name, role, company), `confirmedReal` attestation |
| `lp_pricing` | heading, intro, 1 to 4 plans (name, price, period, description, features, CTA, highlighted), footnote |
| `lp_faq` | heading, 1 to 12 question/answer pairs |
| `lp_cta` | heading, text, button |
| `lp_form` | heading, intro, up to 8 fields (key, label, type text/email/tel/textarea/select, required, options), consent (enabled, text, privacy link), submit label, success message, optional redirect |
| `lp_footer` | text, up to 6 links, copyright line |

Starter templates (`lead-gen`, `product-launch`, `consultation`) contain example wording only inside `[[Replace: …]]` markers on blocks flagged `placeholder`. They contain no testimonials with names, no numbers, no logos; publishing is blocked until each placeholder is replaced and confirmed.

## Lead form and attribution

* Saving a published form block syncs a system-managed `Form` (hidden from the Forms list) so the existing `publicFormService` pipeline runs unchanged: server-side validation of the live field list (unknown fields are rejected), required consent ticked, honeypot (`website`), the IP rate limit `publicLeadLimiter` (5 per 15 minutes per IP), Lead create-or-merge by email, `form.submitted` automation trigger, in-app notifications to the page creator, analytics event.
* The lead's `source` is `landing:<slug>[:utm_source]`; `landing_page_path`, UTM fields (last touch) and referrer are stored on the lead and the submission; `first_touch` (JSON, set once, never overwritten by later submissions) holds the first-touch UTM + referrer. Consent is stored (`consent_given`) with the submission.
* The browser script `public/lp.js` stores first touch and last touch in `localStorage` (campaign parameters and external referrer only, no identifiers), sends one `page_view` beacon per load (random per-tab session id in `sessionStorage`), and posts the form directly to the API so the rate limit sees the visitor's IP. Without JavaScript the form posts to `/lp/<slug>/submit` on the website, which forwards it server-side (UTM taken from the `Referer`; the visitor IP is forwarded in `X-Forwarded-For`, but behind the platform's proxy chain such posts may share one rate-limit budget, which is acceptable for a fallback).
* Privacy: the privacy policy of the site should mention the first-party attribution storage and the page-view beacon.

## Analytics

Performance tab per page: page views, unique **sessions** (not people), form submissions and conversion rate (= submissions / unique sessions) over 7/30/90 days, top sources, daily series. Nothing is estimated: with no recorded data the tab says so, and the rate is "n/a" when there are no sessions. Ad blockers can hide views, so the rate can read high.

## Composer: landing page UTM link

In Social → Composer, under the post link field, "Create landing page UTM link" lists LIVE landing pages and builds `https://<site>/lp/<slug>?utm_source=…&utm_medium=…&utm_campaign=…` (values validated to `[A-Za-z0-9._~-]`), then puts it into the post's link field.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Public page shows "Temporarily unavailable" (503) | the website function cannot reach the API: check `PLATFORM_API_BASE_URL` on the website project and that the API is up. 503s are never cached. |
| A new page returns 404 right after approval | edge cache (up to about 2 minutes) or `PUBLIC_WEBSITE_ORGANIZATION_ID` differs from the workspace the editors use. |
| Form says "Something went wrong" in the browser console with a CORS error | `CORS_ORIGINS` on the API lacks the website origin. |
| "Private preview link" shows only a path | `PUBLIC_SITE_BASE_URL` is not set on the API. |
| Submit for approval is disabled | the checklist lists what to fix (placeholders, meta description, testimonial confirmation, invalid content). |
| Approving says "The page changed after it was submitted" | the author saved after submitting; they must submit again. |
| Page missing from `sitemap.xml` | it is not published, is marked noindex, or the sitemap response is cached (up to 4 hours at the edge). |
| Form returns 429 | rate limit (5 submissions per 15 minutes per IP). |
| Lead was not created | the honeypot field was filled, consent was not ticked, or the page is not live. |
