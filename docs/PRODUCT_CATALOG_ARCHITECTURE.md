# Product Catalog Architecture (Phase 7)

## Ownership decision: platform-global, not organization-scoped

```
Artify Platform
       │
       └── Product Catalog (platform-global, permission-gated)
                │
                ├── Product (Artify HCMS, Payroll, CRM, Consulting, ...)
                │      └── Product Module
                │
                └── (future) Client/Workspace subscribes to a Product
                       (future) Subscription → Subscription Item → Invoice
```

`Product` carries **no `organizationId`.** This was true since Phase 2 (the model's own doc comment: "registry for current and future Artify products... none of these are hardcoded in application logic; they are rows created through this registry") and Phase 7 preserves it deliberately, per the brief's own instruction: "if the current schema clearly establishes products as platform-level catalog records, preserve that architecture."

**Why global is correct here, unlike Client/Lead/Contact or Workspace:**

- A CRM `Client`/`Lead`/`Contact` is inherently tenant data — one organization's record of one of its prospects/customers. It must never be visible across organizations.
- A `Workspace` (Phase 6) is a provisioned `Organization` — by definition tenant-specific.
- A `Product` is the opposite: "Artify HCMS" is the same catalog offering regardless of which client or workspace might one day subscribe to it. Duplicating it per organization would mean creating a new "Artify HCMS" row for every client — exactly the anti-pattern the brief warns against in §9 ("do NOT duplicate products for every client simply because a client uses a product").

**Authorization model**: permission-gated only (`products.read/create/update/archive`, `product_modules.*`), never row-scoped. `requirePermission` is the entire authorization check on every catalog route — there is no `findByIdInOrg`-style ownership re-derivation for `Product` itself, because there is no owning tenant to check against. (`ProductModule` *does* re-derive its parent `Product` on every mutation — see `docs/PRODUCT_MODULE_ARCHITECTURE.md` — but that's product-relationship integrity, not tenant isolation.)

## Product vs. future commercial concepts

A Product/Service is a **catalog offering** — what Artify sells. It is explicitly NOT, and this phase does not implement:

- **Subscription** — a client/workspace's commercial relationship to a product (Phase 2 schema exists: `Subscription.productId`, `Subscription.clientId`; Phase 7 does not create, read, or touch any `Subscription` row).
- **Invoice** — billing for a subscription (Phase 2 schema exists: `Invoice`, `InvoiceItem`; untouched).
- **Contract** — a client's legal agreement (Phase 2 schema exists: `Contract`; untouched).
- **Client** / **Workspace** — who uses the product (Phase 5/6 concepts; a future phase links them to Product via Subscription, not by attaching a Client id to Product).

The relationship a future phase will build:

```
Product ──┐
          ├──> Subscription ──> Subscription Item ──> Invoice
Client ───┘
```

Phase 7 keeps the `Product`/`ProductModule` side of that chain schema-compatible (the FKs already exist from Phase 2, untouched) without building any of the commercial logic itself.

## Product lifecycle

```
DRAFT ──────────────┐
  │                  │
  ▼                  │
ACTIVE ◄──► INACTIVE │
  │            │     │
  ▼            ▼     ▼
        ARCHIVED (terminal)
```

Reuses the existing `ProductStatus` enum (Phase 2), with `DEPRECATED` renamed to `INACTIVE` to match the brief's exact 4-value lifecycle — a safe rename since the value had zero references anywhere in the codebase (verified by grep before the migration was written). Transitions are validated server-side (`productService.assertValidTransition`); `ARCHIVED` is reachable only via the dedicated `POST /products/:id/archive` action (a separate permission, `products.archive`, from the generic `products.update`) — never a physical delete, so `Subscription.productId` always resolves even for an archived product's historical subscriptions.

## Fields

| Field | Notes |
|---|---|
| `code` | required, normalized (trim, uppercase), globally unique, the stable business key — never the display name |
| `name` | display name |
| `slug` | lowercase URL-safe, globally unique, server-generated from `name` by default (collision-safe suffix loop), never trusted from the frontend for uniqueness |
| `type` | `PRODUCT` \| `SERVICE` |
| `shortDescription` / `description` | plain text, length-capped; no rich-text/CMS editor introduced |
| `status` | see lifecycle above |
| `isFeatured` | boolean, permission-gated the same as any other field (`products.update`) |
| `displayOrder` | integer, explicit — list ordering never depends on insertion order |
| `version`, `configuration` | Phase 2 fields, untouched |
| `createdById` / `updatedById` | who — `SetNull` on user deletion, same convention as `Client.accountManager`/`SystemSetting.updatedById` |

## Search, filter, sort, pagination

`GET /api/v1/products` — server-side only, never the full catalog loaded into the browser:

- **Search**: `name`/`code`/`slug`, case-insensitive substring (`ILIKE`), always combined with `AND` against any active filters.
- **Filters**: `type`, `status`, `isFeatured` — combinable (e.g. `status=ACTIVE&type=SERVICE`).
- **Sort**: whitelisted fields only (`name`, `code`, `type`, `status`, `displayOrder`, `createdAt`, `updatedAt`) via a Zod enum — an arbitrary/unlisted sort value is rejected with a 400, never interpolated into the query.
- **Pagination**: `page`/`limit` (capped at 100 per page).

## Known limitations (Phase 7)

- No pricing field exists in this phase — the brief's §28 explicitly scoped pricing out unless the schema already required it; it doesn't.
- `configuration` (Phase 2's JSON field) is preserved but not exposed through any Phase 7 UI or validated schema — a future phase that needs structured per-product configuration should design that deliberately rather than inheriting an untyped blob.
- No product-to-client/workspace assignment exists yet — intentional (§9/§41); that's Subscription's job, in a later phase.

## Phase 10 — Products + Services + Solutions

Closes the gap between "Service" existing only as a `ProductType` value
with no real management UI, and "Solution" not existing at all, while
staying inside the exact architecture above — **no new catalog table, no
second CMS**. A Service is `Product.type = "SERVICE"`; a Solution is the
new `Product.type = "SOLUTION"` value, the identical extension SERVICE
itself got in Phase 7. The Control Center's "Products"/"Services"/
"Solutions" nav entries are one React component (`ProductsPage.tsx`)
whose catalog `type` filter is route-locked per entry — never three
separate list/editor implementations.

### New fields on `Product`

| Field | Notes |
|---|---|
| `featuredMediaId` | Resolved/validated against the single configured `PUBLIC_WEBSITE_ORGANIZATION_ID` org's Media Library — the only org a *global* catalog row can safely borrow a *tenant-scoped* `MediaAsset` from, same bounding assumption `publicSiteService.ts` already uses for every other public media reference. |
| `categoryId` | References the new `ProductCategory` model — platform-global like `Product` itself, not the existing organization-scoped `Category` (built for Posts; reusing it would force a global Product to pick an arbitrary owning org). |
| `currentRevisionId` / `ProductRevision` | Mirrors Template/TemplatePart's stable-identity-plus-revisions pattern, but deliberately lighter: no separate per-revision publish status, because `Product.status` (DRAFT/ACTIVE/INACTIVE/ARCHIVED) already answers "is this published" — a second status would just be two sources of truth for the same question. A revision is an immutable snapshot of `{benefits, features, businessProblem, ctaFormId, seo}` taken on every content-affecting save; `revertProduct` clones an old snapshot into a new current revision, never mutating history. |

### New relationships

- **`ProductCategory`** — platform-global (no `organizationId`, same as `Product`), one per catalog row via `categoryId`. Deletion is refused while any product still references it.
- **`Industry`** / **`ProductIndustry`** — platform-global taxonomy + many-to-many join, for Solution ↔ Industry tagging (the brief's explicit ask; no prior "Industry" concept existed anywhere in this schema). Usable by any type, not restricted to SOLUTION at the schema/validation level — only the Control Center UI surfaces the industries picker for SOLUTION by default.
- **`ProductRelation`** — one symmetric "related to" edge per pair (`@@unique([fromProductId, toProductId])`), covering Product↔Service, Product↔Solution, Solution↔Service, etc. all at once, since they're all just `Product` rows differentiated by `type`. The repository queries both directions so an edge set once is visible from either row.

### CTA (Phase 9 Forms integration)

`content.ctaFormId` is validated at save time the same way `featuredMediaId` is — it must reference a real Form inside the configured public org. The public API resolves it to a real, safe Form projection (`publicFormService.getFormForRender`) and degrades to `ctaForm: null` (never a 500, never fabricated) if the form was since archived or deleted. The public site renders the real `PublicForm` (Phase 9) in place of the generic "Request a Consultation" fallback whenever a CTA form is present.

### RBAC

Reuses `products.read/create/update/archive` for every catalog action this phase adds (revisions/revert/duplicate/bulk-archive/relations/industries-on-a-product) — no new permission keys needed there, since they're all just richer forms of the same create/update/archive actions on the same `Product` row. Two new, narrow keys were added only for the two genuinely new reference-data tables: `product_categories.read`/`.manage` and `industries.read`/`.manage` (ADMIN/MANAGER get `.manage`, every role gets `.read`).

### Public rendering

`publicProductService.ts`'s detail projection (`GET /public/products/:slug`) now includes `category`, `featuredMedia` (resolved URL), `benefits`/`features`/`businessProblem`, `seo`, `ctaForm`, `relatedProducts` (ACTIVE-only), and `industries`. The list projection (`GET /public/products`) is unchanged — every existing consumer of the flat list shape is unaffected. `artifysolscom`'s `AiSolutionsPage`/`AiProductDetailPage` (Phase 11) render these fields when present and fall back to their original plain layout when absent, so every Product created before this phase renders exactly as it did before.

### Known limitations (Phase 10)

- The public site's hand-authored marketing pages for "Services" (`ServicesPage.tsx`) and "Solutions" (`EnterpriseSolutions.tsx`, `SolutionsByFunction.tsx`, `solutionsCatalogData.ts`) are **not** migrated onto this real catalog in this phase — they remain static, hand-authored copy. That is a large, separate content-migration exercise (hundreds of lines of existing marketing copy per page), not part of "build the management system." The real, CMS-driven path — `AiSolutionsPage`/`AiProductDetailPage`, already wired to the real API since Phase 11 — now fully supports SERVICE and SOLUTION rows end-to-end; a future phase can choose to retire the static pages in favor of it.
- No campaign/attribution reporting ties a Product's CTA form submissions back to the Product itself — a submission is a real, persisted `FormSubmission`/`Lead` (Phase 9), but there's no "conversions per product" dashboard. Analytics-territory, out of scope here.
