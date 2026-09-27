# Forms Architecture — Phase 9 (MVP slice)

Closes the "Marketing" domain's zero-backend-presence gap identified in
`control-center-gap-analysis.md` — but only the slice the roadmap actually
scoped: a Form/FormSubmission model reusing the existing Lead-intake
pattern, UTM capture, and a Forms list in the Control Center. Campaigns,
attribution reporting, and landing-page authoring (which depends on Phase
4's still-not-started section-driven renderer) are explicitly out of
scope — see `control-center-roadmap.md`'s Phase 9 row.

## Schema

Two new tables, `Form` and `FormSubmission` (`prisma/schema.prisma`,
migration `20260927153805_phase9_forms`):

- **`Form`**: organization-scoped (same `findByIdInOrg`-only convention as
  every domain since Phase 5), `name`/`slug` (`@@unique([organizationId,
  slug])`), `status` (`ACTIVE`/`ARCHIVED`), and `fields` — a JSON array of
  `{key, label, type, required}`. Deliberately **not** a normalized
  `FormField` table: this is UI config with no independent lifecycle,
  audit trail, or query pattern of its own, the same reasoning
  `ContentRevision.metadata` already uses for Post/Page SEO fields. There
  is no dynamic form-builder canvas or drag-and-drop UI in this slice —
  the Control Center's `FieldsEditor` is a plain add/remove row list.
- **`FormSubmission`**: the raw submitted `data` (JSON, keyed by field
  `key`) plus `utmSource`/`utmMedium`/`utmCampaign`/`utmTerm`/
  `utmContent` — this is the roadmap's "UTM capture on the existing lead
  source field": `Lead` itself gets **no new columns**; UTM values are
  captured here, on the submission, and folded into the created Lead's
  `source`/`notes` the same way `publicLeadService.ts` already encodes
  `subject`/`productInterest` into free-text notes. `leadId` links to the
  Lead the submission produced.

## Every real submission reuses the Lead-intake pattern

This is the roadmap's explicit instruction — "reusing the existing
Lead-intake pattern (`publicLeadService.ts`) instead of a parallel one" —
and it's why `publicFormService.ts` exists as its own file rather than
folding form logic into `formService.ts`: it mirrors
`publicLeadService.createLead`'s exact shape (same honeypot contract, same
`SYSTEM`-attributed audit log, same "never a caller-supplied organization"
rule, resolving the single configured `PUBLIC_WEBSITE_ORGANIZATION_ID`),
generalized to any Control-Center-authored Form instead of the one
hardcoded Contact/Brief form.

- **Required-field validation is dynamic.** A `Form`'s `fields` are
  author-defined, so there's no static Zod schema for a submission's
  `data` shape the way `createPublicLeadSchema` has for the one hardcoded
  lead form. `publicFormSubmitSchema` only bounds the overall envelope
  (max 30 keys, each value capped at 2000 chars) against abuse;
  `publicFormService.submit` loads the target Form's own `fields` and
  checks required-field presence against that.
- **Identity requirement.** `formFieldsSchema` (`server/schemas/
  formSchemas.ts`) refuses to save a Form whose fields don't include at
  least one of key `"name"` or `"email"` — `Lead.companyName` is a
  required, non-null column with no universal sane fallback otherwise.
  `publicFormService.submit` falls back company name to
  `data.company || data.name || data.email || "Website form submission"`.
- **Lead.source encoding**: `form:<form-slug>` optionally suffixed with
  `:<utmSource>` (e.g. `form:demo-request:google`) — mirrors
  `publicLeadService`'s `website:<source>` convention exactly.
- **Honeypot**: a non-empty `website` field is accepted-but-discarded,
  same §8 contract as the lead form — the response is identical whether
  the submission was real or silently dropped, so a bot learns nothing.

## RBAC

`forms.read/create/update/delete` — ADMIN full, MANAGER read/create/update
(no delete, same "reversible day-to-day, ADMIN-only for delete" tiering
`seo.redirects.*` uses), USER/VIEWER read-only. "read" covers both the
form-definition list and its submissions — a submission has no
independent lifecycle of its own to gate separately from the form it
belongs to (unlike Opportunity's separate `.close` key for a real,
distinct action).

## Public endpoint

`POST /api/v1/public/forms/:slug/submit` (`server/routes/v1/
publicRoutes.ts`) — anonymous, shares `publicLeadLimiter`'s rate-limit
budget with `/public/leads` rather than getting a near-duplicate limiter
(same abuse class: an anonymous, IP-keyed write endpoint). Looks up the
Form by `(organizationId, slug)` and requires `status: "ACTIVE"` — an
`ARCHIVED` form 404s the same as an unknown slug, so a form taken down
stops accepting submissions without needing a separate "is this form
live" flag.

## Control Center UI

`src/components/modules/FormsPage.tsx` — a new "Marketing" nav section
(`src/lib/permissions.ts`), gated on `forms.read`. List + create/edit
modal (name, auto-generated-or-custom slug, the field-row editor,
success message) + archive/restore toggle + delete, plus a per-form
"Submissions" modal (paginated, shows each submission's field values, UTM
summary, and whether it produced a Lead). Wired into the Ctrl/Cmd+K
command palette's quick actions and entity search, same as every other
domain since Phase 1.

## Known, deliberate gaps (MVP slice, not oversights)

- **No public-facing form renderer.** This slice ships the backend
  submission endpoint and the Control Center's authoring UI; it does not
  add a dynamic `<Form slug="...">` widget to `artifysolscom`. Embedding a
  Form on the public site today means hand-building a small fetch-and-post
  component against the documented endpoint — the existing hardcoded
  Contact/Brief form is untouched and keeps using `publicLeadService`
  directly. Building a generic public renderer is landing-page-authoring
  scope, which the roadmap explicitly sequences after Phase 4's
  section-driven renderer.
- **No campaign/attribution reporting.** UTM values are captured and
  stored per submission (queryable via Prisma/SQL) but there is no
  Control Center dashboard aggregating them yet — that's Phase 10
  (Analytics) territory, itself blocked on a product decision.
- **No dynamic field types beyond text/email/tel/textarea** (no
  checkboxes, selects, file uploads) — the MVP's field type set covers
  the Contact/Brief-class use case the roadmap named; a real need for
  richer field types is a natural follow-up, not pre-built speculatively.
