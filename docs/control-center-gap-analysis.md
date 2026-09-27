# Control Center Gap Analysis

Findings from a direct repository audit (backend `server/`, `prisma/schema.prisma`; frontend `src/`) against
the proposed enterprise IA in `control-center-enterprise-architecture.md`. EXISTS = fully wired
(service+repo+route+schema+RBAC, or frontend page+nav+permission gate). PARTIAL = some layers present, real
gap remains. MISSING = confirmed absent by grep, not just "not seen yet."

## Backend domains

| Domain | Status | Evidence |
|---|---|---|
| CMS (Post/Page/Category/Tag/Author/ContentRevision/MediaAsset) | EXISTS | Full stack per entity in `server/services/`, `server/repositories/`, `server/routes/v1/`, `server/schemas/`; RBAC `content.*`/`authors.*`/`media.*` (`domain.ts:82-93`). |
| SEO (dedicated module) | **Redirects + audit done (Phase 5)** | `Redirect` model + CRUD + auto-create-on-slug-change + public lookup, and a rule-based `seo.audit.read` issue detector — see `docs/SEO_ARCHITECTURE.md`. Sitemap/robots.txt generation still lives in `artifysolscom` (not duplicated here); its `?limit=50` pagination-cap bug was found and fixed in the same phase. |
| CRM | PARTIAL | `Lead` (status pipeline NEW→CONTACTED→QUALIFIED→CONVERTED/LOST, `leadService.ts:17-26`) converts to `Client`; `Contact` belongs to `Client`, not a generic Company. No `Opportunity`/deal-stage model at all. `Organization` is a tenant construct, not a CRM company record. |
| Client management/onboarding | EXISTS | `clientService`, `onboardingService` (`ClientOnboarding` model, checklist + currentStep), `workspaceService`, `invitationService`, `portalRoutes`/`clientPortalService` (read-only portal). Fully wired. |
| Commerce (Contracts/Subscriptions/Invoices/Payments/Products) | EXISTS | Full CRUD + lifecycle actions (activate/suspend/void/reverse), RBAC per domain. |
| Marketing (forms/landing pages/campaigns/UTM) | MISSING | `grep -rliE "form.?builder|landingpage|campaign|utm"` across `server/`+`prisma/` returns nothing. |
| Analytics (traffic/SEO/CRM/business) | MISSING | No pageview/traffic/analytics service, route, or model. `publicLeadService.ts` captures only a static `source` string — no referrer/UTM capture. |
| Notifications (user-facing) | PARTIAL | `Notification`/`NotificationPreference` Prisma models exist (schema.prisma:1325-1385) but **zero** service/route/repository calls `prisma.notification` anywhere. Only `AutomationNotification`, internal to the automation engine (`NotificationEngine.ts`), is live. |
| Audit logging | EXISTS | `auditLogRepository` called from 34 of 35 service files (only `webhookService.ts` doesn't). Broad, consistent. |
| Users & Security / RBAC | EXISTS | Full permission-key enumeration in `domain.ts:46-201`. No keys exist for SEO/Marketing/Analytics/user-facing Notifications — confirming those domains are structurally absent from RBAC too. |
| Settings | PARTIAL | `systemSettingRepository` is a flat key/value/type store per org, no category taxonomy (branding, SEO defaults, email, etc.). |
| AI (providers/workflows/copilot/knowledge) | EXISTS | Confirmed present with full route/schema/repo sets and dedicated RBAC namespaces; not itself a gap. |

Full current Prisma model list (68 models) spans Identity, CMS, CRM, Commerce, AI, Automation, and Knowledge
— see `prisma/schema.prisma` (`grep "^model "`) for the authoritative list; no separate copy is kept here to
avoid drift.

## Frontend (Control Center UI)

| Area | Status | Evidence |
|---|---|---|
| Nav structure | EXISTS | `NAV_ITEMS` config (`src/lib/permissions.ts:107-424`) → `Sidebar.tsx`. 8 sections today: Platform, CRM, Onboarding, Workspaces, Products, CMS, Commercial, AI, Client Portal. No SEO/Marketing/Analytics sections (nothing to point them at yet). |
| Persistent shell | EXISTS | `AppShell.tsx` renders Sidebar + Header + `<main>` across all routes. |
| Breadcrumbs | **Added this phase** | Was MISSING; `Breadcrumbs.tsx` now derives section + page from the matched `NavItem`. |
| Command palette / global search | **Added this phase** | Was MISSING (zero matches for "CommandPalette"/"cmdk"/"Ctrl+K" before this phase); `CommandPalette.tsx` now provides quick actions + live entity search. |
| Notification bell | MISSING | No user-facing notification UI — consistent with the backend gap above; nothing to wire it to yet. |
| Design system / DataTable | PARTIAL | Real shared primitives exist (`ui/ui.tsx`); no shared `DataTable` — Leads/Contacts/Posts/etc. each hand-roll their own `<table>`. |
| Theme | EXISTS | `.dark` class on `<html>`, CSS variables, `ThemeContext`. |
| CRM UI | PARTIAL | Leads/Clients/Contacts/CRM-dashboard pages exist; no Opportunity/Pipeline UI (matches backend gap). |
| Mobile responsiveness | EXISTS | Real mobile drawer (`Sidebar.tsx:126-136`), not just reflow. |
| Code-splitting | MISSING | No `React.lazy`/`import()` anywhere; `permissions.ts` statically imports all ~30 page components — the whole Control Center ships as one bundle (confirmed again post-changes: single ~1.07 MB main chunk). |

## Net gap summary

Four domains have essentially zero backend presence: **SEO** (dedicated), **Marketing** (forms/landing
pages/campaigns), **Analytics**, and user-facing **Notifications**. CRM lacks an Opportunity/pipeline-stage
concept and a true Company entity. Settings is unstructured. On the frontend, breadcrumbs and a command
palette were the two concrete, backend-independent foundation gaps — both closed this phase. Code-splitting
and a shared DataTable remain open, lower-risk frontend-only gaps for a later pass.
