# Forms Architecture — Phase 9 (Forms + Landing Pages + Conversion)

Supersedes the Phase 9 MVP slice. Closes the "Marketing" domain's gap
identified in `control-center-gap-analysis.md`: a production-grade Form
Builder, Landing Page Builder, and Conversion system, built entirely by
extending the existing Form/FormSubmission/Lead/Page/Template/editorBlocks
architecture — no second form, CMS, or CRM system.

## Schema

`Form` and `FormSubmission` (`prisma/schema.prisma`), across two
migrations: `20260927153805_phase9_forms` (MVP slice) and
`20261004024343_phase9_forms_landing_pages_conversion` (this phase).

- **`Form`**: unchanged shape from the MVP slice (`name`/`slug`/`status`/
  `fields` JSON array), plus `notifyUserIds: Json` — org-member user ids to
  notify (in-app only; this codebase has no mail transport) on each new
  submission, validated against real org users (`prisma.user.count`) at
  create/update time so a stale or foreign id can never be stored.
- **`FormSubmission`**: adds `consentGiven: Boolean?`, `landingPagePath:
  String?`, `referrer: String?` (read server-side from the request's own
  `Referer` header — never trusted from the request body) alongside the
  MVP slice's `data`/UTM columns/`leadId`.
- **`Field` type set** (`server/schemas/formSchemas.ts`): `text`, `email`,
  `tel`, `number`, `select`, `multiselect`, `checkbox`, `radio`, `date`,
  `textarea`, `hidden`. Each field supports `placeholder`, `required`,
  `options` (for `select`/`multiselect`/`radio`), `min`/`max` (for
  `number`), and `visibleWhen: {fieldKey, equals}` for conditional
  visibility — validated server-side in both directions: a field's
  `visibleWhen.fieldKey` must reference a real field on the same form, and
  a visible-and-required field cannot be satisfied by hiding it client-side
  (`isFieldActive()` in `publicFormService.ts` re-derives visibility from
  the submitted data before enforcing `required`).
- **No `file` field type.** No safe anonymous-upload path exists in this
  codebase (every upload path requires an authenticated session and a
  pre-authorized media record) — rather than build an insecure
  half-measure, file upload is not implemented. Documented at the top of
  `formFieldTypeSchema`.
- **No booking/scheduling field or block.** No booking/scheduling backend
  exists to attach one to — out of scope by the same reasoning.

## Every real submission reuses the Lead-intake pattern

Unchanged from the MVP slice in spirit: `publicFormService.ts` mirrors
`publicLeadService.createLead`'s shape (honeypot contract, `SYSTEM`-
attributed audit log, the single configured
`PUBLIC_WEBSITE_ORGANIZATION_ID`, never a caller-supplied organization).

- **Duplicate handling**: an anonymous submission whose email matches an
  existing Lead in the org (`leadRepository.findByEmailInOrg`) **merges**
  into that Lead — updates contact name/phone, appends the new submission's
  notes (separated by `\n\n---\n\n`), refreshes `source` — rather than
  hard-rejecting (which would leak existing-lead information to an
  anonymous caller, the behavior reserved for the *authenticated*
  `leadService.createLead` 409 path) or silently duplicating (which would
  pollute the CRM with redundant Lead rows for the same person).
- **Consent tracking**: a `checkbox` field keyed `"consent"` is detected and
  its value stored on `FormSubmission.consentGiven` and folded into the
  Lead's notes as an explicit "Consent to be contacted: given/not given"
  line — real, auditable consent state, never inferred.
- **UTM + landing page + referrer attribution**: captured on
  `FormSubmission` and folded into Lead `source`/notes, same as the MVP
  slice, now joined by `landingPagePath` (client-supplied, the page the
  visitor was on) and `referrer` (server-read from the `Referer` header).
- **Notifications**: each of `Form.notifyUserIds` gets a real, persisted
  in-app `Notification` (`type: "FORM_SUBMITTED"`) on every new submission
  — no email, consistent with `notificationService.ts`'s existing
  architecture.
- **Honeypot**: unchanged — a non-empty `website` value is
  accepted-but-discarded, identical response to a real submission.

## Landing pages — reusing Page + Template + editorBlocks, not a new system

`PageType.LANDING` and `TemplateType.LANDING_PAGE` enum values existed in
the schema since Phase 1 but no UI ever exposed them. Phase 9 closes that
gap only: `PagesPage.tsx` now has a "Page type" selector (Standard/Landing
page) and a badge on landing pages — the Page itself is authored exactly
like any other Page, through the same Site Editor, Template system, and
SEO panel every Page already uses.

## Conversion elements — two new editorBlocks block types

`form` and `testimonial` are added end-to-end through the existing
editorBlocks pipeline (`server/schemas/editorSchemas.ts`'s discriminated
union, the Site Editor's `SiteEditorPage.tsx` canvas/inspector, the
read-only `BlockRenderer.tsx` preview) — the same data model and validation
layer as every other block type, not a second page-builder. `form` holds a
`formId` reference to a real, org-owned Form; `testimonial` holds a quote/
author/title/`avatarMediaId`. CTA/button, card, and section/columns blocks
already existed and are reused as-is for feature/benefit and trust
sections.

Reusable "booking/request" blocks are explicitly **not** implemented — no
booking backend exists to back one.

## Public rendering (artifysolscom)

Before this phase, artifysolscom never rendered a Page's `editorBlocks` at
all — only the flattened `body` HTML snapshot taken at save time, meaning
a Page composed in the Site Editor couldn't contain anything interactive.
`CmsPageRoute.tsx` now renders `page.editorBlocks` via a new
`PublicBlockRenderer.tsx` when present and non-empty, falling back to the
flattened body otherwise (so every existing page is unaffected).

- **`publicSiteService.ts`** resolves every `mediaId`/`avatarMediaId`
  reference in a page's `editorBlocks` tree server-side into a real
  `resolvedUrl`/`resolvedAvatarUrl` (the same ACTIVE+PUBLIC-only public
  media projection every other public field already uses) — artifysolscom
  has no authenticated media-read path to do this itself, so a raw
  internal `mediaId` is never sent to the public site.
- **`PublicForm.tsx`** (new) is the first genuinely interactive public
  widget this site has — fetches a Form's real field definitions
  (`GET /public/forms/:slug` or `/public/forms/by-id/:id`, both new,
  unauthenticated, unrated-limited reads, same policy as every other public
  GET), renders real controlled inputs per field type, enforces
  client-side required/visibility validation (using `aria-required` rather
  than the native `required` attribute, so the browser's own constraint
  validation never preempts the component's per-field error messages),
  captures UTM params from the current URL and `landingPagePath` from
  `window.location.pathname`, and submits to the real
  `POST /public/forms/:slug/submit` endpoint. Honeypot markup is copied
  verbatim from `ContactAndBrief.tsx`'s existing CSS-hidden-input pattern
  (not `type="hidden"`, which real bots specifically skip).
- Both new public GET routes and the existing submit route are mounted in
  `server/routes/v1/publicRoutes.ts`; only the submit route is
  rate-limited (shares `publicLeadLimiter`'s budget with `/public/leads`,
  unchanged from the MVP slice).

## RBAC, validation, deletion protection

Unchanged `forms.read/create/update/delete` tiering from the MVP slice.
New in this phase:

- **Deletion protection**: a Form with existing submissions cannot be
  deleted (`ConflictError` naming the submission count) — archive instead,
  so submission history stays traceable. A Form with zero submissions can
  still be deleted outright.
- **CSV export** (`GET /forms/:id/submissions/export`, `forms.read`):
  every field value and UTM param is attacker-controllable data from an
  anonymous caller, so every exported cell is checked for a leading
  `=`/`+`/`-`/`@` (CSV formula injection) and neutralized with a leading
  literal quote before quoting — applied uniformly, not just to
  "suspicious-looking" values.

## Known, deliberate gaps (still out of scope, not oversights)

- **No file-upload field type** — no safe anonymous-upload path exists;
  see above.
- **No booking/scheduling elements** — no booking backend exists to back
  one.
- **No campaign/attribution reporting dashboard** — UTM/landing-page/
  referrer values are captured and stored per submission (queryable via
  Prisma/SQL) but there is no Control Center dashboard aggregating them;
  that remains Phase 10+ (Analytics) territory.
- **`templatePart`/`navigationMenu` editorBlocks references are not
  resolved for public page-body rendering** — those are Template-level
  whole-page composition concerns (a separate, already-existing
  region-resolution pathway), not something a Page's own body content
  needs to embed. `PublicBlockRenderer.tsx` renders nothing for these
  block types rather than a confusing, non-functional placeholder.
