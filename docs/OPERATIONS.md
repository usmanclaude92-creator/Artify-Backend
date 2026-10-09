# Operations: System Health, Backups and Data Privacy (Step 13)

## 1. Facts this tooling is based on (read on 2026-10-09)

Sources opened through the Supabase and Vercel documentation search tools (the public websites are blocked from the build environment, so the text below is what those tools returned). **GDPR and UAE PDPL could not be read from the official sources here**; those facts come from secondary summaries and must be confirmed against the statute text by whoever signs off the privacy procedure.

### Supabase backups ([Database Backups](https://supabase.com/docs/guides/platform/backups))
* **Free plan: no automatic backups.** The docs recommend free projects "regularly export their data using the Supabase CLI `db dump` command and maintain off-site backups".
* **Pro: daily backups, last 7 days. Team: last 14 days. Enterprise: up to 30 days.** Restore is from Dashboard → Database → Backups; the project is **unreachable during a restore**, longer for bigger databases.
* **Point-in-Time Recovery (PITR)** is a paid add-on on Pro, Team and Enterprise (needs at least a Small compute add-on). Recovery point objective in the worst case is two minutes. Listed prices: 7 days about USD 100/month, 14 days about USD 200, 28 days about USD 400 ([PITR usage](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery)). **Enabling PITR stops the daily backups** (PITR replaces them).
* **Not in a database backup:** objects stored through the Storage API (only their metadata is in the database); custom role passwords (reset them after a restore). Restoring an old backup does not bring back Storage objects deleted after it.
* Deleting a project permanently deletes its backups.
* Programmatic read: `GET https://api.supabase.com/v1/projects/{ref}/database/backups` with an account access token ([Management API](https://supabase.com/docs/reference/api/v1-list-all-backups)). This is what the Backups page uses when `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` are set.
* Restore into a new project: [Duplicate project](https://supabase.com/docs/guides/platform/clone-project).

### What YOUR Supabase plan covers
**I cannot read your plan from here.** The Supabase organization that owns the project (`artifysols-backend`, ref `cfkymotcnccgvkpmcevp`, Postgres 17.6, region ap-northeast-1) is a Vercel-integration organization and the API refuses to return its plan to this session. What is known: the database is about 24 MB, `max_connections` is 60, and the project has `pg_cron`. Check Supabase Dashboard → Organization → Billing, then Database → Backups:
* If **Database → Backups lists scheduled backups** you are on a paid plan: you have daily backups for 7 days (Pro) and no PITR unless you bought the add-on.
* If it says backups are not available / you are on **Free**: **there is no provider backup at all.** You need either an upgrade to Pro (about USD 25/month per Supabase's own billing example) or your own scheduled export. The scheduled export built in this step (section 4) is that safety net and is **off until you set `BACKUP_EXPORT_ENABLED=true` and `BACKUP_EXPORT_KEY`**.
* On any plan, **uploaded media (Storage) is not covered by database backups.** Nothing in this repo backs up the media bucket; that stays a manual or provider-side task.
* A logical export is not a substitute for PITR: it gives you a daily snapshot of critical tables, not the whole database and not second-level recovery.

### Vercel
* Rollback: `vercel rollback [deployment]`, or Dashboard → Deployments → "Instant Rollback"; rolling back to a specific older deployment is a Pro/Enterprise feature, Hobby can only go back to the previous production deployment ([Rollback](https://vercel.com/docs/deployments/rollback-production-deployment), [CLI](https://vercel.com/docs/cli/rollback)). A rollback changes only which build serves production: **it does not touch the database or environment variables**, so a migration that already ran stays applied.
* Promote a deployment: `vercel promote <url>` ([Promote](https://vercel.com/docs/deployments/promote-preview-to-production)).
* Logs: `vercel logs --environment production --level error --since 1h`; runtime log retention depends on the plan (observed here: about 1 hour through the Vercel tool); use a log drain for longer retention ([Drains](https://vercel.com/docs/drains/reference/logs)).
* Cron: `vercel.json` has one daily cron (`0 0 * * *`) for the tick endpoint; the real schedulers are Supabase `pg_cron` jobs (below).

### Data subject requests (obligations level; confirm against the statutes)
* **GDPR** ([text](https://eur-lex.europa.eu/eli/reg/2016/679/oj)): Art. 15 access (confirmation, a copy of the data, purposes, recipients, the storage period); Art. 16 rectification; Art. 17 erasure on listed grounds (no longer necessary, consent withdrawn, objection, unlawful processing) with exceptions; Art. 12(3) answer **within one month**, extendable by two further months for complex requests; Art. 5(1)(e) storage limitation (keep identifiable data no longer than necessary). Art. 19 requires telling recipients of a correction or erasure.
* **UAE PDPL** (Federal Decree-Law No. 45 of 2021, effective 2 January 2022; official text via the [UAE Legislation portal](https://uaelegislation.gov.ae)): secondary summaries describe rights to access/information, correction, erasure in limited circumstances, restriction, objection and portability, enforced by the UAE Data Office. Exclusions exist (e.g. government data, data governed by DIFC/ADGM law). Executive-regulation details and exact deadlines were not confirmed here.
* What the tooling therefore provides: **access/portability** (export bundle JSON/CSV), **erasure** (anonymisation with preview, reason, two-person approval, immutable audit), **retention** (one policy table, purge jobs), **proof of consent** (register). **Rectification** is done by editing the record in the CRM (no separate tool). Telling third parties (e.g. an email provider) is a manual step.

## 2. What already existed, and what this step added

| Topic | Already in the repo (reused) | Added in Step 13 |
|---|---|---|
| Administration sidebar | Users, Roles, Permissions, Organizations, Audit Log, My Sessions, Security Center, Administration overview, Integrations, Settings | **System Health**, **Backups**, **Data Privacy** (group "Operations") |
| Audit log | `audit_logs`, `auditLogRepository.record`, Audit Log page, security events in the Administration overview | `PRIVACY_*` and `OPS_*` actions; **immutable** `PRIVACY_*` rows (DB trigger) |
| Notifications | `notificationService.notify` (bell), Notification Center | `system_health_alert` type, grouped and rate-limited |
| Scheduler | `pg_cron` job `artify_publish_tick` (every minute) and `artify_automation_tick` (every 5 minutes) calling the CRON_SECRET-protected tick endpoints; the automation tick also runs content scheduling, webhook retries, token health, inbox, analytics and listening | **Heartbeats** (`job_heartbeats`) written by each job, "late" detection, ops pass (health record, alerts, purge, export) on the same tick |
| Health | `/system/live`, `/system/ready`, `/system/database` (SUPER_ADMIN); `aiHealthService`; Integrations health | The full check set in section 3 |
| Retention | Social inbox purge (180 days default, per-workspace setting, 02:00 to 04:59 UTC); expired handoff codes | One **policy table** (`retentionPolicy.ts`), purge jobs for analytics, sessions, preview tokens, exports (gated), dry-run view |
| CRM data | `leads`, `contacts`, `clients`, `form_submissions` (consent boolean, IP, user agent, UTM, first touch) | **Consent register** (`consent_records`), person lookup/export/erasure |
| Social data | `social_conversations` (+ lead/contact link), `social_messages`, listening cursors and review snapshots (no mention bodies stored) | Included in lookup, export and erasure |
| Approvals | Approvals center with sources ai, automation, content, social, landing | New source **privacy** (needs `privacy.erase`, requester cannot approve) |
| Rate limits | `generalApiLimiter` on `/api`; `publicLeadLimiter`, `publicAnalyticsLimiter`, `webhookLimiter`, `authLimiter`, `sensitiveActionLimiter` | Ops and privacy endpoints use `sensitiveActionLimiter` |
| Backups | none in the app | Provider view, encrypted critical export, verify, runbook |

## 3. System Health checks reference

Each check returns `status` (ok, warn, red, unknown, off), a plain `reason`, and the time it ran. `unknown` means the app cannot measure it and says why; it is never shown as green.

| Check | Red when | Warn when |
|---|---|---|
| Database latency | `SELECT 1` fails or takes over 1500 ms | over 300 ms |
| Database connections | 90% or more of `max_connections` | 70% or more |
| Social publish scheduler (every 1 min) | no finished run for 3 minutes, or last run errored | n/a |
| Automation tick, token health, analytics, inbox, listening poll (every 5 min) | no finished run for 15 minutes, or last run errored | n/a |
| Retention purge, scheduled export (daily) | no finished run for 28.8 hours | n/a |
| Listening poll / scheduled export | shown as **off** when their flags are off | |
| Facebook / Instagram / LinkedIn token | token expired, under 7 days left, or account in NEEDS_REAUTH/ERROR | under 14 days |
| Failed social posts (24 h) | one or more | |
| Uncertain social posts | one or more (the network may have published them; check before retrying) | |
| Approvals waiting over 3 days | | one or more |
| Media size, database size | never (no quota is known to the app; values are shown) | |
| API error rate | not available (the app keeps no request log; use Vercel logs) | |
| Failed audited actions (24 h) | | over 50 |
| Required configuration | a required variable is missing | |

The configuration checklist lists variable **names** and present/missing only. Alerts: a check must stay red for **15 minutes**, then **one grouped notification per admin** is sent, repeated at most every **6 hours** while still red; recovery resets the state.

Heartbeats are written by the jobs themselves (`job_heartbeats`). If System Health shows a scheduler check red: open Supabase → `select * from cron.job_run_details order by start_time desc limit 20;` to see whether pg_cron ran, then check the endpoint with the `CRON_SECRET` (never paste it in chat).

## 4. Backups and restore

**Scheduled critical-data export** (off by default). Set on the API project: `BACKUP_EXPORT_ENABLED=true`, `BACKUP_EXPORT_KEY` (32+ random characters; **store it in a password manager: without it the files cannot be read**), optional `BACKUP_EXPORT_RETENTION_DAYS` (default 30, minimum 7). It runs once a day in the 02:00 to 04:59 UTC window on the tick. Contents: organizations, users (no password hashes), memberships, system settings, leads, contacts, clients, opportunities, campaigns, forms, submissions, consent register, pages/posts/case studies and their revisions, templates, navigation, redirects, taxonomy, authors, media **metadata**, products, industries and social account **metadata** (no tokens). Every row is scrubbed of any key that looks like a secret (password, secret, token, hash, credential, api key, ciphertext). `social_account_credentials`, integrations, API keys, sessions, reset/verification tokens, OAuth state and webhook secrets are **never read**. File: gzip, then AES-256-GCM, stored at `private/backups/<org>/…aex` in the configured object storage. Use a **private bucket** for this key prefix; the files are encrypted, but the media bucket may be public.

**Restore-test checklist** (do it after enabling, then quarterly):
1. Backups page → "Verify (restore test)" on the newest export: checksum, decrypt/parse, row counts and "no credential-like fields" must all pass.
2. Download the file from storage, decrypt with `BACKUP_EXPORT_KEY` (format: `AEX1` + 12-byte IV + 16-byte tag + ciphertext; key = HKDF-SHA256 of the secret with salt `artify-export-salt` and info `artify/critical-export/v1`), gunzip, and open the JSON. Spot-check five leads and one page.
3. Record the date and result in your operations log.

**Provider restore runbook (Supabase)**
1. Decide the restore point; tell users the app will be down.
2. Prefer **restore to a new project** ([duplicate project](https://supabase.com/docs/guides/platform/clone-project)) and inspect it first.
3. Restore in Dashboard → Database → Backups (daily) or Point in Time. The project is unreachable meanwhile.
4. Re-set custom role passwords; confirm `select jobname, schedule, active from cron.job;` still lists `artify_publish_tick` and `artify_automation_tick`.
5. Check media in Storage separately (not in the backup).
6. Open System Health; every scheduler check should return to green within 15 minutes.
7. If a bad **deployment** (not data) is the problem: Vercel Instant Rollback; the database is unaffected.

## 5. Data privacy procedure

1. **Verify identity** outside the tool and record the request date: the one-month clock starts there.
2. Administration → Data Privacy → Person: search the email. This lists what is held (contacts, leads, clients, consent events, form/landing submissions, social conversations and messages linked by lead/contact or by handle equal to the email, audit references). The lookup is audited without the email.
3. **Access:** Export JSON or CSV (needs `privacy.export`), send it to the person by a secure channel.
4. **Rectification:** edit the record in the CRM.
5. **Erasure:** Preview erasure (table by table what changes), enter the reason (no personal details in it), **Request erasure** (SUPER_ADMIN). A **different** SUPER_ADMIN approves it in Approvals → Privacy; the requester cannot. Execution anonymises in place, deletes social message text, keeps the consent register (IDs only) and the audit log.
6. **What stays:** audit entries that contain the email inside old change snapshots cannot be rewritten (immutable); the preview tells you how many. Staff accounts cannot be erased here. Business clients are only stripped of email/phone; review by hand.
7. Tell any third party that received the data (manual).
8. A request record keeps only an HMAC pseudonym of the subject, your reason, counts and who approved; no email is stored. The audit entry `PRIVACY_ERASURE_EXECUTED` holds the same and cannot be edited or deleted.

**Consent register:** every lead capture path writes a row (source, status GIVEN / DECLINED / NOT_COLLECTED, time): public lead endpoint, forms, landing page forms (source `landing:<slug>`), manual CRM entry, automation-created leads and social-inbox auto-leads (these last three collect no consent and are recorded as NOT_COLLECTED). Existing data was backfilled from stored consent flags.

## 6. Retention policy (the single source: `server/services/ops/retentionPolicy.ts`)

| Data class | Kept | Purge job | Notes |
|---|---|---|---|
| Social inbox messages and conversations | 180 days (workspace setting, 7 to 3650) | inbox job (always on) | existing behaviour |
| Website analytics events | 395 days | `analytics_events` (gated) | no names or emails; **proposed default** |
| Expired or revoked sessions | 30 days after end | `sessions` (gated) | |
| Expired landing preview tokens | 30 days after expiry | `preview_tokens` (gated) | |
| Encrypted exports | 30 days, newest 3 kept | with the export job | `BACKUP_EXPORT_RETENTION_DAYS` |
| Leads, contacts, clients | until erased or reviewed | none | review at least yearly |
| Form/landing submissions | until erased | none | |
| Consent register, privacy requests | kept | none | no personal data |
| Audit log | kept | none | |

"Gated" purges delete **only when `RETENTION_PURGE_ENABLED=true`**; otherwise the Retention tab shows what would be deleted. The numbers marked proposed are defaults for the owner to confirm or change in the policy file.

## 7. Environment variables added

| Variable | Purpose |
|---|---|
| `BACKUP_EXPORT_ENABLED`, `BACKUP_EXPORT_KEY`, `BACKUP_EXPORT_RETENTION_DAYS` | scheduled export (section 4) |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | let the Backups page read the provider's list (read-only token; never logged or returned) |
| `RETENTION_PURGE_ENABLED` | turn automatic deletion on |

## 8. Roles

| Permission | Roles |
|---|---|
| `ops.health.read`, `ops.backups.read`, `privacy.read`, `privacy.export` | SUPER_ADMIN, ADMIN |
| `privacy.erase` | SUPER_ADMIN only |

Manual "Run export now" is SUPER_ADMIN only (role check). No existing permission was widened. **Two-person erasure needs two SUPER_ADMIN accounts**; with one, an erasure can be requested but never approved.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| All scheduler checks "unknown" | no tick ran since deploy; wait 5 minutes, then check `cron.job_run_details` |
| A scheduler check is red LATE | pg_cron is not firing or the endpoint rejects the secret (401): compare the stored secret in the cron command with `CRON_SECRET` in Vercel |
| Backups page: "Not available here" | set `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`, or read Dashboard → Database → Backups |
| Export refused | `BACKUP_EXPORT_KEY` missing or under 32 characters |
| Verify fails "decrypt" | the key differs from the one used at export time |
| Erasure request can't be approved | only one SUPER_ADMIN exists, or the approver is the requester |
| Retention tab shows eligible rows but nothing is deleted | `RETENTION_PURGE_ENABLED` is not `true` (by design) |
