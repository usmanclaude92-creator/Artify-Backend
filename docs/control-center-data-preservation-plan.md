# Database Preservation Plan (Phase 0)

Documented only — no migration in this phase. Principle throughout: **extend before duplicating.** Every row below states, per target module, what's reusable as-is, what needs new columns, and what genuinely needs a new table — preferring the former at every decision point, per the brief's explicit instruction.

Current baseline (verified this session via `grep -c "^model "` / `"^enum "` on `prisma/schema.prisma`): **71 models, ~50 enums**, single schema, `organizationId`-scoped multi-tenancy throughout (with three intentionally-global exceptions: `Product`, `ProductModule`, `Author` — confirmed no `organizationId` column on any of the three, by design).

## Dashboard
No schema impact. Reads across existing modules only.

## Website (the module requiring real new schema)

| Need | Plan | Compatibility risk |
|---|---|---|
| Pages | **Reuse `Page` as-is.** No new table. | None — it's the same content a human already authors today. |
| Media | **Reuse `MediaAsset` as-is.** | None. |
| Site Identity (name/logo/tagline/favicon/contact) | **Extend, don't add a table**: a handful of well-known keys in the existing `SystemSetting` (org-scoped key/value, already has a `type` enum for typed rendering) is sufficient for the current field set (confirmed via `systemSettingRepository.ts`: `upsert({organizationId, key, value, type, ...})`, unique on `(organizationId, key)`). Only promote to a dedicated `SiteIdentity` table if the field set grows structured/relational (e.g. multiple logos per breakpoint) — not justified yet. | Low. `SystemSetting` has no reserved-key collision risk today (grep found no `site.*`/`brand.*` keys in use). |
| Global Styles (color tokens, fonts, spacing) | Same reasoning as Site Identity — a `theme.*`-namespaced set of `SystemSetting` rows, OR (if the token set is large/structured) a new `GlobalStyle` table (`organizationId`, `tokenKey`, `tokenValue`, `category`) modeled directly on `SystemSetting`'s own shape rather than inventing a new pattern. Decide based on actual token count once Phase 3 (of the 18-phase roadmap) is scoped — premature to commit now. | Low either way — additive, no existing table touched. |
| Templates / Template Parts | **New schema needed.** No existing model captures "a reusable layout with named regions." Proposed shape (naming only, not a commitment): `Template(id, organizationId, name, slug, regions Json)` + `TemplatePart(id, organizationId, type[HEADER\|FOOTER\|SIDEBAR\|CUSTOM], name, content Json)`. `Page.templateId` (new nullable FK) links a page to its template — additive column, no data migration required (existing pages simply have `templateId = null` and fall back to a default). | Low — purely additive. The only migration-adjacent risk is deciding the region/content JSON shape well enough that it isn't immediately outgrown; that's a design task for the relevant implementation phase, not this audit. |
| Navigation / Menus | **New schema needed.** Proposed: `NavigationMenu(id, organizationId, key[HEADER\|FOOTER\|...], name)` + `MenuItem(id, menuId, parentId?, label, targetType[PAGE\|POST\|PRODUCT\|EXTERNAL_URL\|CATEGORY], targetId?, externalUrl?, order)`. `targetType`+`targetId` pattern deliberately mirrors existing polymorphic-ish relations elsewhere in the schema (e.g. `Redirect`) rather than inventing a new idiom. | Low — additive; no FK cascade risk since `targetId` references are soft (validated at write time, not enforced by DB constraint, same pattern the codebase already tolerates for a few JSON-referenced ids). |
| Homepage | **Reuse `Page`** + a `Page.isHomepage Boolean` (new nullable/default-false column) or an `Organization`-scoped `SystemSetting` key (`site.homepageId`) pointing at a `Page.id`. The latter needs no schema change at all — prefer it. | None if the `SystemSetting` route is taken. |
| Landing Pages | **Reuse `Page`** + a `Page.pageType` enum (`STANDARD \| LANDING`, new column, defaulted to `STANDARD` for all existing rows — zero-downtime additive migration) rather than a parallel `LandingPage` model. Conversion-specific fields (if any prove necessary) can live in the same `ContentRevision.metadata` JSON pattern already used for SEO fields. | Low — same additive-column pattern already proven safe for this table (SEO fields went into `metadata` JSON with zero migration for existing rows). |

## Content
No new schema. `Post`/`Category`/`Tag`/`Author`/`ContentRevision`/`MediaAsset` already fully support the module. The one real fix this domain needs is *not* database — it's the SSR/crawler-visibility gap (rendering, not persistence).

## Catalog
No new schema. `Product`/`ProductModule` already global-catalog-shaped, reusable by Website's future "Landing Pages that showcase a Product" use case via existing FKs, no new relation needed beyond what a landing page's content can already reference by id in its body/metadata.

## SEO
No new schema for what's scoped. If task #66 (expanded SEO panel with content analysis) needs stored analysis results (vs. computed-on-read), that's a new `SeoAnalysisResult` table — not yet justified, defer until that phase is scoped.

## CRM / Clients / Marketing / Operations
No new schema identified. All target-module capability already has a real, tested table set (see gap analysis). Marketing's landing-page-renderer gap is a Website-module dependency, not a new CRM/Marketing table.

## Analytics
Entirely new schema if self-built (e.g. `PageView`, `AnalyticsEvent`) — explicitly **not** scoped until the build-vs-integrate product decision is made (see roadmap Phase 15). If integrating a provider, no new schema at all — just API credentials in existing env/config.

## Administration
No new schema for Users/Organizations/AuditLog/Security. If custom roles become a real requirement, `RolePermission`'s existing join-table shape already generalizes to org-defined roles with only an `isSystemRole`/`organizationId` addition to `Role` — no redesign needed, confirmed by inspecting `roleRepository.ts`'s current shape.

## AI
No new schema. All four subsystems (AI Control Center, Automation, Knowledge, Copilot) are already fully modeled (71 models includes ~35 AI/Automation/Knowledge/Copilot models across the four subsystems per the background audit's line-range citations).

## Cross-cutting preservation guarantees

- **No existing table is dropped, renamed, or has a column removed** by any plan above — every change is additive (new nullable column, new table with FKs into existing tables, or reuse of `SystemSetting`).
- **No existing API contract changes** — Website-module additions are new endpoints (`GET/POST /templates`, `/menus`, etc.) under the same `requirePermission`/`findByIdInOrg` convention; nothing existing is renamed or has its response shape altered.
- **`organizationId`-scoping is preserved** on every new table — Website content stays multi-tenant-isolated exactly like Content/CRM/Commerce today, so `artifysols.com`'s single-organization deployment and any future multi-org Website use share the same isolation guarantee already proven by 96+ integration tests elsewhere in the schema.
- **RBAC extension, not replacement**: every new Website capability gets new `PERMISSION_KEYS` entries (e.g. `templates.read/create/update`, `menus.read/update`, `site_identity.read/update`) following the existing 149-key naming convention — no new authorization mechanism.
