# Control Center: what exists, how to operate it (index)

One page. Details live in the module documents linked below; where this page and a module document disagree, the code wins and the document should be fixed.

## 1. What exists

| Area | What it does | Document |
|---|---|---|
| Dashboard & reports | Role-aware dashboard from stored data, marketing funnel, weekly/monthly reports, CSV, saved views | [DASHBOARD.md](DASHBOARD.md) |
| Operations | System Health, backups/export, retention, consent register, data privacy (lookup/export/erasure with approval) | [OPERATIONS.md](OPERATIONS.md) |
| Marketing | Campaigns, forms, landing pages (`/lp/<slug>`) | [MARKETING_LANDING_PAGES.md](MARKETING_LANDING_PAGES.md), [FORMS_ARCHITECTURE.md](FORMS_ARCHITECTURE.md) |
| Social | Accounts, composer/queue/publishing, inbox, analytics, listening/reviews | [SOCIAL_FOUNDATION.md](SOCIAL_FOUNDATION.md), [SOCIAL_PUBLISHING.md](SOCIAL_PUBLISHING.md), [SOCIAL_INBOX.md](SOCIAL_INBOX.md), [SOCIAL_ANALYTICS.md](SOCIAL_ANALYTICS.md), [SOCIAL_LISTENING.md](SOCIAL_LISTENING.md), [SOCIAL_META_FACEBOOK.md](SOCIAL_META_FACEBOOK.md), [SOCIAL_INSTAGRAM.md](SOCIAL_INSTAGRAM.md) |
| CRM & commercial | Leads, clients, contacts, opportunities, onboarding, contracts, invoices | [CRM_ARCHITECTURE.md](CRM_ARCHITECTURE.md), [COMMERCIAL_ARCHITECTURE.md](COMMERCIAL_ARCHITECTURE.md) |
| Website / CMS / SEO | Pages, posts, media, templates, redirects, SEO issues, public API | [CMS_ARCHITECTURE.md](CMS_ARCHITECTURE.md), [SEO_ARCHITECTURE.md](SEO_ARCHITECTURE.md), [PUBLIC_API_ARCHITECTURE.md](PUBLIC_API_ARCHITECTURE.md) |
| Automation & AI | Workflows, approvals center, AI tools, copilot | [AUTOMATION_ARCHITECTURE.md](AUTOMATION_ARCHITECTURE.md), [AI_ARCHITECTURE.md](AI_ARCHITECTURE.md) |
| Access | Roles, permissions, sessions, MFA | [AUTHORIZATION_MODEL.md](AUTHORIZATION_MODEL.md), [AUTHENTICATION_ARCHITECTURE.md](AUTHENTICATION_ARCHITECTURE.md), [SECURITY_MODEL.md](SECURITY_MODEL.md) |
| QA | Sidebar role × page matrix (generated) | [QA_ROLE_MATRIX.md](QA_ROLE_MATRIX.md) |

## 2. How to operate

* **Scheduler.** Two Supabase `pg_cron` jobs call the app with `CRON_SECRET`: `artify_publish_tick` (every minute → `/social/internal/publish-tick`) and `artify_automation_tick` (every 5 min → `/automation/internal/tick`). The 5-minute tick also runs social jobs, health recording/alerts, the retention purge window, the optional encrypted export and the scheduled dashboard reports. System Health → Scheduler shows when each last ran.
* **Deploys.** Vercel project `controlcenter` (backend + SPA) and `artifysolscom` (public site) build from GitHub `main`. After changing server code run `npm run build:vercel-api` and commit `api/index.mjs`, otherwise production serves the old bundle.
* **Migrations.** Additive, idempotent SQL in `prisma/migrations/*`. Apply in the Supabase SQL editor (or `prisma migrate deploy`), then record the row in `_prisma_migrations`. Never run `prisma format`.
* **Tests.** `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.server.json`; backend `npx vitest run` (one run at a time, shared test DB); frontend `npx vitest run --config vitest.frontend.config.ts`.
* **Kill switches.** Social publishing (settings), `SOCIAL_PUBLISHING_DISABLED`, `SOCIAL_LISTENING_DISABLED`, `SOCIAL_ANALYTICS_DISABLED`, dashboard-report kill switch (Scheduled Reports page).

## 3. Runbooks (short)

| Situation | Do this |
|---|---|
| A check is red in System Health | Read its reason; scheduler red → check the two pg_cron jobs and `CRON_SECRET`; connector red → reconnect the account on Social → Accounts. Full list: [OPERATIONS.md](OPERATIONS.md) §runbooks. |
| Posts failed / uncertain | Social → Failures; an UNCERTAIN post is never retried automatically: check the network, then resolve manually. [SOCIAL_PUBLISHING.md](SOCIAL_PUBLISHING.md). |
| Erasure request | Data Privacy → request; a second person approves in Approvals. [OPERATIONS.md](OPERATIONS.md). |
| Report went to the wrong people | Turn the kill switch on (Scheduled Reports), fix recipients, run a dry run, send a test to yourself, turn the switch off. [DASHBOARD.md](DASHBOARD.md) §4. |
| Restore data | Supabase backups per plan + the encrypted export ([OPERATIONS.md](OPERATIONS.md) §backups). |

## 4. Environment variable reference (names only; never commit values)

| Group | Variables |
|---|---|
| Core (required) | `DATABASE_URL`, `SESSION_SECRET`, `WEBHOOK_SECRET`, `CORS_ORIGINS`, `NODE_ENV` |
| Scheduler | `CRON_SECRET` (required for ticks) |
| Public site link | `PUBLIC_WEBSITE_ORGANIZATION_ID` (required for site/landing/health), `PUBLIC_SITE_BASE_URL`, `CONTROL_CENTER_BASE_URL` |
| Sessions & accounts | `SESSION_TTL_HOURS`, `ACCOUNT_LOCKOUT_THRESHOLD`, `ACCOUNT_LOCKOUT_DURATION_MINUTES`, `PASSWORD_MIN_LENGTH`, `PASSWORD_RESET_TOKEN_TTL_MINUTES`, `INVITATION_TOKEN_TTL_HOURS`, `EMAIL_VERIFICATION_TTL_HOURS`, `ALLOW_ADMIN_SELF_REGISTRATION` (default off in production), `COOKIE_DOMAIN` |
| Email | `EMAIL_PROVIDER` (`none`/`resend`), `RESEND_API_KEY`, `EMAIL_FROM` |
| Rate limiting | `REDIS_URL` (limits are **not enforced** without it) |
| Storage | `OBJECT_STORAGE_PROVIDER`, `OBJECT_STORAGE_*`, `SUPABASE_STORAGE_URL`, `SUPABASE_STORAGE_SERVICE_ROLE_KEY`, `LOCAL_STORAGE_DIR`, `MEDIA_*` |
| AI | `AI_PROVIDER`, `GEMINI_API_KEY`, `AI_REQUEST_TIMEOUT_MS` |
| Social | `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_API_VERSION`, `META_APP_MODE`, `META_LOGIN_SCOPES`, `META_INSTAGRAM_LOGIN_SCOPES`, `META_INBOX_POLLING`, `SOCIAL_ANALYTICS_SCOPES`, `SOCIAL_LISTENING_POLLING`, `SOCIAL_VAULT_KEYS`, `SOCIAL_VAULT_ACTIVE_KEY_VERSION`, `INTEGRATIONS_ENCRYPTION_KEY`, `LINKEDIN_*`, `SOCIAL_MOCK_PROVIDER_ENABLED` (**must stay off in production**), `SOCIAL_PUBLISH_*`, `SOCIAL_REPLY_RATE_PER_MINUTE`, `INSTAGRAM_DAILY_PUBLISH_LIMIT`, `SOCIAL_*_DISABLED` |
| Operations | `BACKUP_EXPORT_ENABLED`, `BACKUP_EXPORT_KEY`, `BACKUP_EXPORT_RETENTION_DAYS`, `RETENTION_PURGE_ENABLED`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` |
| Bot protection | `TURNSTILE_SECRET_KEY` |
| Misc | `LOG_LEVEL`, `PORT` |

System Health → Configuration shows which of these are present (names and present/missing only).
