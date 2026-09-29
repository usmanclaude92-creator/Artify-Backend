# Control Center → Website + Business Operating Center: Architecture (Phase 0)

Audit-only. No implementation in this document. Scope: `cc.artifysols.com` (this repo, `Artify-Backend`'s `src/`) and its production dependency on `artifysols.com` (`artifysolscom` repo). Both stay live, same DB, same auth/RBAC, same APIs — this document maps what exists onto the target IA and names what's structurally new.

## Current architecture (verified this session + prior sessions' first-hand work)

```
Browser (cc.artifysols.com)
  → React 19 SPA (src/), route-level React.lazy per nav item
  → apiClient (Bearer token, sessionStorage) → /api/v1/*
  → Express routes → requirePermission/requireRole → services → repositories (findByIdInOrg convention)
  → Prisma → PostgreSQL (71 models, single schema, organizationId-scoped multi-tenancy)

Browser (artifysols.com)
  → React 19 SPA (static Vite build, Vercel), 17 lazy chunks + eager home bundle
  → publicApi.ts → /api/v1/public/* (read-only, unauthenticated)
  → same Express app, same Prisma, same PostgreSQL — NOT a separate backend
  → api/index.ts (own Vercel serverless fn) additionally serves /sitemap.xml, /robots.txt, /api/ai-consultant
```

One platform API, two frontends. `artifysolscom` has no database of its own — confirmed (no Prisma, no DB env var beyond `PLATFORM_API_BASE_URL`). This is the single most important existing-architecture fact for everything below: **the Website module's job is to let the Control Center author what artifysolscom already fetches and renders — not to stand up a second content system.**

## Target module tree (this audit's mapping — conceptual grouping only, no code obligation implied by names)

| Target module | Maps onto | Status (see gap analysis for detail) |
|---|---|---|
| Dashboard | `DashboardPage` | EXISTS |
| **Website** (Site Editor, Site Identity, Global Styles, Templates, Template Parts, Navigation, Menus, Pages, Homepage, Landing Pages, Media) | Pages/MediaAsset exist; everything else is net-new | Pages/Media EXIST; rest MISSING |
| Content | Posts/Categories/Tags/Authors | EXISTS |
| Catalog | Product/ProductModule | EXISTS |
| SEO | Redirect/SEO audit | EXISTS (PARTIAL — see gap doc) |
| CRM | Lead/Contact/Opportunity | EXISTS |
| Clients | Client/Onboarding/Workspace/Portal | EXISTS |
| Marketing | Form/FormSubmission | EXISTS (MVP slice) |
| Analytics | — | MISSING (blocked on product decision, not engineering) |
| Operations | Contract/Subscription/Invoice/Payment (today under "Commercial" nav) + Automation engine (backend-only) | EXISTS, needs IA regrouping only |
| Administration | Users/Roles/Permissions/Organizations/AuditLog/Security/Settings | EXISTS |
| AI | AI Control Center + Copilot (+ Knowledge/RAG backend-only) | EXISTS |

11 of 12 target modules already have a real backend home. **Website is the only module requiring genuinely new architecture** — everything else is extension, regrouping, or a named, previously-deferred gap (Analytics).

## WordPress-class functional benchmark (conceptual only — no WP code, branding, or UI copied)

What "WordPress-class" means for this audit, functionally:
1. **Site identity is data, not code** — name, tagline, logo, favicon, contact info editable without a deploy.
2. **Visual structure is composable** — homepage/pages assembled from reusable sections/template parts (header, footer, nav), not one hardcoded JSX tree per page.
3. **Navigation is authored, not hardcoded** — menus are DB rows resolved at render time, not a `getRouteFromPath()` switch statement.
4. **A page has a template**, and templates are swappable independent of content.
5. **Global styling is tokenized** — colors/fonts/spacing as data the renderer reads, not Tailwind classes baked into each component.
6. **Every content type participates in SEO** (meta, OG, schema) through one consistent authoring surface, and that metadata is crawler-visible without JS execution.

Artify's implementation of each must stay proprietary (Artify's own data model, its own Control Center UI, its own renderer) — this benchmark is a checklist of *capabilities*, not a spec to clone.

## Anti-patterns to avoid (explicit, per brief)

- No parallel content system alongside Post/Page — Website's "Pages" IS the existing `Page` model, extended, not duplicated.
- No new auth/session/RBAC mechanism — every new Website/Template/Menu permission follows the existing `PERMISSION_KEYS` + `requirePermission` + `findByIdInOrg` convention (149 keys today, `server/types/domain.ts`).
- No client-side-only SEO for anything the Website module produces — the existing gap (client-side `document.title`/`head` mutation only, confirmed this audit, tracked as task #64) must not be reproduced in the new renderer; it should be the thing that finally forces a real fix (SSR/prerender or edge-injection), not another instance of it.
- No hardcoded per-organization branding in `artifysolscom`'s component tree — Site Identity data must be organization-scoped like everything else in this schema.

## What stays untouched by this initiative

Auth (bcrypt+DB-sessions), RBAC (role→permission, 5 system roles), tenant isolation convention, audit logging (append-only `auditLogRepository.record()`), CRM/Commerce/Clients/AI domains, and `artifysols.com`'s existing routing/rendering contract with the Platform API (`publicApi.ts`'s 11 endpoints) — the Website module adds new public read endpoints under the same contract, it does not change the existing ones.
