# Artify Control Center — Enterprise Architecture

Target vision: the Control Center (`cc.artifysols.com`, this repo's `src/`) becomes the single operating
system for Artify's digital business — CMS, CRM, Commerce, and Operations all behind one RBAC/tenant
boundary, with `artifysols.com` (the `artifysolscom` repo) as a read-only consumer of its published data.
This document is the target-state map; `control-center-gap-analysis.md` is what exists today vs. this map;
`control-center-roadmap.md` is the phased path between them.

```
                    ARTIFY CONTROL CENTER
                         cc.artifysols.com
                                │
        ┌───────────────────────┼────────────────────────┐
        │                       │                        │
      CMS                     CRM                    COMMERCE
        │                       │                        │
 Posts/Pages/Media       Leads/Clients/Contacts   Contracts/Subscriptions
 Categories/Tags/Authors  (no Opportunity/pipeline) Invoices/Payments/Products
        │                       │                        │
        └───────────────────────┼────────────────────────┘
                                │
                          Platform API (server/)
                                │
                         PostgreSQL (Prisma)
                                │
                                ▼
                        artifysols.com (artifysolscom repo)
                     consumes /api/v1/public/* only
```

## Existing foundation (do not rebuild)

- **Auth/RBAC**: bearer-token sessions, `RolePermission` keyed by string permission (`domain.ts`),
  `requirePermission` middleware server-side, `hasPermission()`/`visibleNavItems()` client-side for UX only.
  See `docs/AUTHORIZATION_MODEL.md`.
- **Shell**: `AppShell.tsx` + `Sidebar.tsx` (collapsible, grouped, persisted, mobile drawer) + `Header.tsx`.
  See `docs/CONTROL_CENTER_ARCHITECTURE.md`.
- **Router**: minimal History-API router (`src/lib/router.tsx`), no react-router dependency.
- **Design system primitives**: `src/components/ui/ui.tsx` (Card, Button, Badge, Input, Select, Modal,
  ConfirmDialog, Pagination, Loading/Empty/Error states). No shared `DataTable` — each list page hand-rolls
  its own `<table>`.
- **CMS** (`docs/CMS_ARCHITECTURE.md`): Post/Page/Category/Tag/Author/ContentRevision/MediaAsset — full
  service+repo+route+schema stack, revisioning, scheduled publish, SEO metadata schema, sanitized HTML body.
- **CRM** (`docs/CRM_ARCHITECTURE.md`): Lead → Client conversion, Contact-per-Client. No Opportunity/pipeline
  stage concept, no Company entity distinct from the tenant-oriented `Organization`.
- **Commerce/Client management** (`docs/COMMERCIAL_ARCHITECTURE.md`, `docs/CLIENT_ONBOARDING_ARCHITECTURE.md`,
  `docs/CLIENT_PORTAL_ARCHITECTURE.md`): Contracts, Subscriptions, Invoices, Payments, Products, onboarding
  checklist, read-only client portal — fully wired end to end.
- **AI** (`docs/AI_ARCHITECTURE.md`, `docs/AUTOMATION_ARCHITECTURE.md`, `docs/KNOWLEDGE_ARCHITECTURE.md`,
  `docs/COPILOT_ARCHITECTURE.md`): providers/models/tools/prompts/workflows/executions/usage/approvals,
  automation engine, RAG knowledge base, chat copilot.

## New in this phase (Control Center Foundation)

- **Global Command Center** (`Ctrl/Cmd+K`, `src/components/layout/CommandPalette.tsx`): permission-gated
  quick actions ("New Post/Page/Lead/Client", "Upload Media") and live search across Posts, Pages, Leads,
  Clients, Products, and Media — backed by each entity's real, already-RBAC-protected `?search=` list
  endpoint, never a client-side mock index. A type is only queried if the signed-in user holds its
  `*.read` permission.
- **Breadcrumbs** (`src/components/layout/Breadcrumbs.tsx`): section + page name, derived from the same
  `NAV_ITEMS` config the sidebar already uses — no separate breadcrumb map to keep in sync.
- **Deep links** (`src/lib/deepLink.ts`): a palette search result or quick action navigates to
  `<listPath>?q=<term>` / `<listPath>?new=1`; the six list pages (Posts, Pages, Leads, Clients, Products,
  Media) read `q` once on mount to pre-fill their existing search box, and `new=1` to open their existing
  create flow. No new "open a specific record" API was needed — this reuses what each page already does.

## Structurally absent domains (confirmed zero backend presence)

SEO (dedicated module — today it's a metadata JSON blob on Post/Page only, no sitemap/robots/redirects
service), Marketing (forms/landing pages/campaigns/UTM attribution), Analytics (traffic/SEO/CRM/business),
and user-facing Notifications (the `Notification`/`NotificationPreference` Prisma models exist but have zero
service/route/repository wired to them — only `AutomationNotification`, internal to the automation engine,
is live). See the gap analysis for full evidence and the roadmap for sequencing.

## Design principles carried forward

- Never duplicate an existing CMS/CRM/Commerce/Auth/Media API — extend the existing service+repo+route+schema
  stack for a domain rather than starting a parallel one.
- Hiding a nav item or disabling a button is UX only; every mutation is authorized server-side regardless of
  what the Control Center renders.
- No mock data, no fake SEO/ranking scores, no placeholder buttons with no backend behind them.
