# Step 14 final QA report

Method: local server + scratch database (never production) driven by Playwright for all six roles over all 81 sidebar pages; API probes per permission; a load test on a seeded scratch DB; read-only SQL and Vercel metadata checks against production.

## Findings

| # | Area | Finding | Severity | Status |
|---|---|---|---|---|
| 1 | Sidebar/roles | All 81 pages × 6 roles: every page a role may open loads without JS errors; every page it may not open shows *Access denied*; hidden items match the permission catalogue (0 mismatches). See [QA_ROLE_MATRIX.md](QA_ROLE_MATRIX.md). | – | Verified |
| 2 | API vs UI | 47 sidebar permissions × 6 roles + anonymous: forbidden roles get 403, allowed roles never 401/403/5xx, anonymous gets 401 (`tests/integration/qaRoleMatrix.test.ts`). | – | Verified |
| 3 | Copilot | `GET /copilot/workspaces` returned 500 on a first visit when two requests raced to create the default workspaces (unique-constraint error). | Medium | **Fixed** (duplicate error treated as "already created") |
| 4 | CLIENT_PORTAL | `CRM Dashboard` and `Marketing Dashboard` had no permission requirement, so portal users saw staff pages with empty states. `/dashboard` for portal users would have shown staff widgets. | Low | **Fixed** (nav now requires a CRM/marketing read permission; `/dashboard` shows a pointer to the portal; API refuses portal users) |
| 5 | Client Portal page | Staff roles that hold `portal.dashboard.read` saw "Your Account" (client portal) in the sidebar; the API refuses them (403, correct) so the page showed an error. | Low | **Fixed** (item is portal-only; direct URL shows Access denied) |
| 6 | Site Editor | MANAGER can open the Site Editor (`content.update`) but it also reads global styles (`settings.read`), which MANAGER lacks → one 403 in the console; page still loads. | Low | **Fixed** (the call is skipped without `settings.read`) |
| 7 | Accessibility | At 360 px and 1280 px, on dashboard, composer, inbox, approvals, scheduled reports, system health and CRM: no horizontal overflow, no unnamed buttons/links, no unlabeled inputs, no images without alt, first Tab stop is the menu button. System Health and Scheduled Reports had no `<h1>`. | Low | **Fixed** (h1 added). 1–2 icon buttons on composer/inbox are smaller than 24 px: open. A full contrast audit and screen-reader pass were **not** done. |
| 8 | Performance | Production bundle: entry 396 kB (113 kB gzip); every page is a lazy route chunk; the rich-text editor (470 kB) loads only on editor pages. | – | OK |
| 9 | Performance | Dashboard, 8 concurrent, 60 000 events + 8 000 leads: `/dashboard?period=28` p50 476 ms / p95 634 ms; period 90 p95 992 ms; each widget alone 18–46 ms; query count does not grow with data (no N+1). Other pages p95 62–417 ms. Single dev process on a laptop-class sandbox, not production hardware. | Info | OK |
| 10 | DB indexes | Added `leads(organization_id, created_at)`, `form_submissions(organization_id, created_at)`, `opportunities(organization_id, stage)`; new dashboard tables are indexed by schedule/user/run. Social, landing and ops tables already index organization + status/time. | Low | **Fixed** (in migration) |
| 11 | Data hygiene | Production still holds QA leftovers: 3 QA users (2 are SUPER_ADMIN), 1 QA lead, 1 QA landing page, 1 QA social post; plus 6 "phase1-…" ADMIN preview accounts. Sessions of QA users are revoked. | **High** (two extra SUPER_ADMIN logins exist, with password login disabled) | **Open – needs your approval to delete** (`docs/ops-qa-cleanup.sql`; add the six phase1 accounts) |
| 12 | Production flags | `SOCIAL_MOCK_PROVIDER_ENABLED` is not set, so the mock provider is off in production (default is on only outside production). `ALLOW_ADMIN_SELF_REGISTRATION` is not set (off in production). No route is mounted conditionally on NODE_ENV (checked by search); debug flags are limited to log level. | – | OK |
| 13 | Production flags | `SOCIAL_LISTENING_POLLING=true` and `META_INBOX_POLLING=true` are on. The first was meant to be temporary (its own comment says so). | Medium | Open (yours to switch off) |
| 14 | Rate limiting | Public/API rate limits are not enforced in production because `REDIS_URL` is not set (they fall back to per-instance memory on serverless). | **High** | Open (needs a Redis URL) |
| 15 | Env vars | Required-but-missing or recommended-but-missing (names only): `REDIS_URL`, `PUBLIC_SITE_BASE_URL`, `CONTROL_CENTER_BASE_URL`, `EMAIL_PROVIDER`/`RESEND_API_KEY`/`EMAIL_FROM` (so reports are in-app only), `SOCIAL_VAULT_KEYS`, `INTEGRATIONS_ENCRYPTION_KEY`, `BACKUP_EXPORT_KEY`. Set but possibly unused: `COOKIE_DOMAIN` (the app authenticates with a bearer token, not a cookie), `PORT`, `LOCAL_STORAGE_DIR`, `META_APP_MODE` (informational). | Medium | Open |
| 16 | Security | `npm audit --audit-level=high`: 3 high, all one chain: `deepmerge-ts` → `@prisma/config` → `prisma` **CLI** (dev tooling; not loaded by the running API). Fix needs a Prisma upgrade. | Medium | Open (not auto-fixed to avoid a Prisma major bump) |
| 17 | Security | CORS: explicit origin list with credentials. Auth: bearer token in sessionStorage (no auth cookie). Webhook and CRON paths verified in earlier steps (signature / secret). CSP of the public website was not re-tested in this step. | – | Not re-verified: website CSP |
| 18 | MFA / accounts | No MFA on any account, including the only real SUPER_ADMIN. | High | Open |
| 19 | **Production role grants** | The production permission catalogue lacks 15 rows the code and seed expect: `analytics.read`, `campaigns.*`, `navigation_menus.*`, `industries.*`, `product_categories.*`. So in production Analytics, Campaigns, Marketing Dashboard, Navigation Menus and Taxonomy are usable only by SUPER_ADMIN, the Analytics page shows no website data even for SUPER_ADMIN, and the new dashboard's Website widget is "forbidden" for ADMIN/MANAGER/USER/VIEWER. Found in the live test. | **High** (functional) | **Fixed** – `docs/prod-permission-sync.sql` applied to production |
| 20 | Live test | Dashboard opened as SUPER_ADMIN, ADMIN, MANAGER, USER, VIEWER (each saw exactly their permitted widgets; CLIENT_PORTAL got 403); 6 numbers compared with their source (below); report dry run, kill switch (run KILLED, test send refused), real in-app delivery to your account only; CSV export 200, forbidden export 403; `reports.manage` endpoints 403 for MANAGER/VIEWER. | – | Verified |

## Live numbers compared (production, SUPER_ADMIN, last 28 days 2026-09-11 to 2026-10-08)

| # | Dashboard | Source | Result |
|---|---|---|---|
| 1 | Website page views 167 | `analytics_events` count (SQL) | equal |
| 2 | Website sessions 71 | distinct `session_id` (SQL) | equal |
| 3 | CRM leads 2, qualified 1 | CRM summary page | equal |
| 4 | Social accounts 2 | Social accounts page | equal |
| 5 | Followers 0 / 0 (both accounts) | Social analytics summary | equal |
| 6 | Health ok 15, unknown 4, disabled 2 | System Health page | equal |

Not compared numerically: approvals (0 on the dashboard; the Approvals endpoint shape differs). The previous-period comparison correctly showed no percentage: the first stored page view is 2026-10-05, so the previous period is not covered.

## What was not verified

* Contrast ratios and a screen-reader pass; dialogs' focus trapping was not exercised beyond first-Tab order.
* Load figures are from a sandbox, not production hardware; Supabase connection limits (max 60) were not stressed.
* The website's CSP and public-endpoint rate limiting on production (limits are off without Redis).
* Email delivery (no provider configured).
