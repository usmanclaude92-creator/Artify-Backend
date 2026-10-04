# Case Study Architecture (Phase 11)

## Ownership decision: reuse Post/Page's workflow architecture, not a new CMS

```
Organization
    │
    └── CaseStudy (organization-scoped, same as Page/Post)
            ├── ContentRevision (version history — exactly the same table Page/Post use)
            ├── Industry (platform-global, Phase 10)         — singular FK
            ├── CaseStudyProduct   → Product (Phase 10's global catalog)   — many-to-many
            ├── CaseStudyRelatedPage → Page                                — many-to-many
            └── CaseStudyRelatedPost → Post                                — many-to-many
```

A Case Study is organization-scoped content with a draft/review/schedule/publish/archive
workflow and a full revision history — structurally identical to `Post`/`Page`. The brief's
own instruction ("Reuse existing Post/category/content architecture where appropriate...
Do not create duplicate CMS/catalog systems") is taken literally: `caseStudyService.ts` and
`caseStudyRepository.ts` mirror `postService.ts`/`postRepository.ts` method-for-method
(`createCaseStudy`/`updateCaseStudy`/`submitForReview`/`publishCaseStudy`/`scheduleCaseStudy`/
`archiveCaseStudy`/`revertCaseStudy`/`deleteCaseStudy`/trash+restore/`bulkAction`), and
`caseStudyRoutes.ts` reuses the exact same `content.read/create/update/publish/delete`
permission keys Page/Post already share — **zero new permission keys were added.**

What's genuinely new, and why each piece is a real, justified addition rather than
duplication:

- **`clientName`/`industryId` on the `CaseStudy` row itself** — a case study belongs to one
  client and (optionally) one industry; a singular FK is correct, not a join table (the brief:
  "Avoid unnecessary many-to-many tables if existing structures can support the relationship
  safely").
- **`ContentRevision.caseStudyId`** — a third, additive parent column on the same revision
  table Page/Post already use (see "The exactly-one-parent CHECK constraint" below), rather
  than a parallel `CaseStudyRevision` table.
- **Three join tables** — `CaseStudyProduct`, `CaseStudyRelatedPage`, `CaseStudyRelatedPost`
  — because a case study genuinely has a many-to-many relationship with each of those three
  content types (a case study can reference several products; a product can appear in several
  case studies), and none of the three existing models has a slot for it. All three are plain
  `Cascade`-on-both-sides join tables, no additional fields.

## Why Product/Service/Solution is ONE join table, not three

Phase 10 made Product/Service/Solution the same `Product` row differentiated by `type`
(`PRODUCT`/`SERVICE`/`SOLUTION`). A Case Study referencing "the Zero-Touch Close solution"
and a Case Study referencing "the Payroll product" are both just rows in `CaseStudyProduct`
— there is no second table for "services" or "solutions". `Solution ↔ Service/Product` and
`Product ↔ Service/Solution` (the brief's other requested relationships) already exist from
Phase 10's own `ProductRelation` self-join and need no Case-Study-specific change.

## The exactly-one-parent CHECK constraint

`ContentRevision` has a hand-written, DB-enforced CHECK constraint (not expressible in
Prisma's schema DSL, added via raw SQL in the Phase 2 migration):

```sql
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_exactly_one_parent"
  CHECK (num_nonnulls("page_id", "post_id") = 1);
```

Phase 11's migration (`20261004120000_phase11_case_studies`) widens it additively:

```sql
ALTER TABLE "content_revisions" DROP CONSTRAINT "content_revisions_exactly_one_parent";
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_exactly_one_parent"
  CHECK (num_nonnulls("page_id", "post_id", "case_study_id") = 1);
```

Every existing revision already has `case_study_id = NULL`, so this is a pure no-op for all
current data — no backfill, no destructive step. A revision is still required to have
*exactly* one real parent, now one of three instead of two.

## Structured fields live in `ContentRevision.metadata`, not new columns

Challenge/solution/implementation/results/testimonial/technologies/gallery/CTA-form-id are
stored on the same `ContentRevision.metadata` JSON column Page/Post already use for SEO —
`caseStudyContentSchema` (`server/schemas/caseStudySchemas.ts`) is `seoMetadataSchema`
(`.strict()`) `.extend()`ed with those fields, so a save still rejects an unknown key outright
rather than silently losing a field, exactly like Page/Post's own SEO save path. This means a
Case Study's structured content versions alongside its body/title/SEO in the exact same
revision row — reverting to a prior revision reverts the whole thing together, which is the
correct behavior (the brief: "revisions/rollback").

## Site Editor integration — no second page builder

`?caseStudyId=` is a third recognized query param on the existing `/website/site-editor` route
(`SiteEditorPage.tsx`'s `PageOrPartEditor`), alongside `?pageId=` and `?templatePartId=`. It
reuses the exact same canvas, block palette, Media Library picker, and Global Styles — only
the load/save/publish/revisions/revert network calls branch to `caseStudiesApi` instead of
`pagesApi`. The stored `editorBlocks` document is the identical shape Page already uses
(`editorDocumentSchema`/`sanitizeEditorDocument` from `server/schemas/editorSchemas.ts`,
unchanged). No new block types, no new renderer, no new editor UI.

## Public rendering

`GET /public/case-studies` and `GET /public/case-studies/:slug` (`publicSiteService.ts`'s
`listCaseStudies`/`getCaseStudyBySlug`, resolved against the single configured
`PUBLIC_WEBSITE_ORGANIZATION_ID`, same contract as every other `/public/*` endpoint) return
PUBLISHED-only data, with every related Product/Page/Post filtered to its own
ACTIVE/PUBLISHED state — a related item that's since been unpublished or archived is silently
omitted, never a broken reference (mirrors `publicProductService.ts`'s identical
`relatedProducts` filter). A CTA referencing an archived form degrades to "no CTA" the same
way a Product's CTA already does.

On artifysolscom, this is rendered two ways, both additive:

1. **`/case-studies/:slug`** — a brand-new detail route (`CaseStudyDetailPage.tsx`), with real
   crawler-visible SEO (title/description/canonical/OG/JSON-LD injected server-side by
   `ssrMeta.ts`/`api/index.ts`, the same mechanism `/blog/:slug` and `/ai-solutions/:slug`
   already use — not just a client-side `useEffect`), a redirect-table lookup on a 404 (so a
   renamed published case study's old URL still resolves), and sitemap entries
   (`src/utils/sitemap.ts`).
2. **The existing `/case-studies` index** (`CaseStudiesPage.tsx`) keeps rendering its honest
   "Illustrative Architecture Scenarios" content completely unchanged, with a new "Customer
   Case Studies" section shown *above* it only when real published case studies actually
   exist — every organization today has none, so the page is visually identical until a real
   one is published. This satisfies "preserve existing public rendering as fallback" literally:
   nothing was deleted or rewritten, something was added.

CTA forms reuse the existing `<PublicForm formId=.../>` renderer verbatim — it already reads
UTM params and `landingPagePath` from `window.location` and posts through the real
`publicApi.submitForm`/CRM lead-intake path, so a Case Study's CTA gets correct
attribution with no new code.
