# Target Production Architecture

## 1. Principle

**One authoritative Platform API. Two consuming frontends.** Neither frontend maintains its own data source ever again.

```
Artify-Backend  =  Platform API (Node/Express + PostgreSQL)  +  Control Center UI (React)
artifysolscom   =  Public Website + Client Portal UI (React)  →  consumes Platform API only
```

`Artify-Backend`'s existing `server/` code layer (see `CURRENT_STATE.md` §2.2/§2.4) already has the right shape — routers → services → typed models, an `authService` with RBAC/tenant middleware, a standard response envelope (`server/core/apiResponse.ts`) — but currently lives in the *wrong repository* (`artifysolscom`) and sits on an in-memory, non-persistent store. Phase 1 relocates and hardens that layer into `Artify-Backend`; it is not rebuilt from scratch.

## 2. Current vs. target data flow

**Current (as verified in `CURRENT_STATE.md`):**
```mermaid
flowchart LR
  subgraph AB["Artify-Backend"]
    AdminUI["Admin Console UI"] --> AdminCtx["AdminDataContext<br/>(React state)"]
    AdminCtx --> LS1[("localStorage")]
    AdminCtx -.demo only.-> ABServer["server.ts<br/>(no DB, no auth)"]
  end
  subgraph AS["artifysolscom"]
    PortalUI["Client Portal UI"] --> AuthCtx["AuthContext<br/>(fabricated on login)"]
    AuthCtx --> LS2[("localStorage")]
    MarketingUI["Marketing site widgets"] --> LegacyServer["server.ts / api/index.ts<br/>(duplicated, drifting)"]
    PortalUI -. 2 of 27 routes .-> V1["server/routes/v1/*<br/>(real RBAC, unused, in-memory)"]
  end
```

**Target:**
```mermaid
flowchart LR
  subgraph Clients
    ControlCenterUI["Control Center UI<br/>(Artify-Backend)"]
    PublicPortalUI["Public Site + Client Portal UI<br/>(artifysolscom)"]
  end
  subgraph Platform["Artify-Backend: Platform API"]
    Gateway["/api/v1 Router<br/>(versioned, CORS-scoped)"]
    AuthMW["Auth + RBAC + Tenant<br/>middleware"]
    Services["Domain services<br/>(identity, CRM, products,<br/>subscriptions, CMS, AI)"]
    DB[("PostgreSQL<br/>(single source of truth)")]
    Storage[("Object storage<br/>(media/uploads)")]
  end
  AIProvider["Gemini (server-side only)"]

  ControlCenterUI -->|HTTPS + Bearer session| Gateway
  PublicPortalUI -->|HTTPS + Bearer session| Gateway
  Gateway --> AuthMW --> Services --> DB
  Services --> Storage
  Services --> AIProvider
```

## 3. Why `Artify-Backend`, not `artifysolscom`, is the platform of record

See `ADR/ADR-001-platform-boundary.md`. Summary: the brief itself designates `Artify-Backend` as the future Control Center/Admin Platform and states the public site "must not maintain an independent competing database." `artifysolscom` already has more real backend code than `Artify-Backend` does today (§2 above) — that code must move, not be duplicated again.

## 4. Layering (within the Platform API)

```
routes/v1/*        → HTTP concerns only: parse, call service, format envelope
services/*          → business rules, validation, orchestration, audit-log writes
repositories/*       → SQL / ORM queries only (new layer — today services talk directly to the in-memory db.ts)
db (PostgreSQL)      → source of truth
```

Introducing an explicit repository layer (currently absent — `server/core/db.ts` is both store and query API) is the one structural change beyond a lift-and-shift: it's what makes swapping the in-memory `Map`s for real SQL tractable without rewriting every service.

## 5. Cross-cutting concerns every route must get (none exist today)
CORS allow-list (Control Center origin + artifysolscom origin only), rate limiting, request-size limits, structured request logging with the existing `requestId` (already generated in `apiResponse.ts`, just never logged), centralized Express error-handler middleware, Helmet-equivalent security headers (a subset already exists in `artifysolscom/server.ts:27-32` — reuse and extend it), input validation (zod) at the route boundary before it reaches services.

## 6. Multi-product extensibility

Future Artify products (HCMS, Payroll, Accounting, CRM, ERP) reuse the platform's identity, organization, billing, and audit primitives rather than re-implementing them — each new product is a new set of `services/` + `routes/v1/<product>` modules against the same `companies`/`users`/`audit_logs` tables, not a new backend. This is why identity/org/billing/audit are modeled first (Phase 2-3) before any product-specific schema.
