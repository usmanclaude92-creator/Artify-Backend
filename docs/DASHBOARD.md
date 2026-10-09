# Dashboard, Marketing Funnel & Scheduled Reports (Step 14)

Every number on the Dashboard is read from data this platform already stores. There are no live Meta/Google calls on page load, no email or
WhatsApp widgets, no benchmarks and no invented KPIs. Each widget carries an **as of** time: when it was computed, and (for snapshot data)
when its source was last refreshed.

## 1. Widget catalogue

| Widget | Data source (table / service) | Refresh method | Permission | Empty state says |
|---|---|---|---|---|
| Attention · Approvals waiting | `approvalCenterService.summary` (ai_approval_requests, automation_approvals, social_posts `PENDING_APPROVAL`, landing/privacy approvals) — only the sources the caller may act on | Computed on request | `approvals.read` | "Nothing is waiting for your approval." |
| Attention · Failed / uncertain / missed posts | `social_post_targets` status `FAILED`/`UNCERTAIN`/`MISSED` (last 30 days) | Computed on request; rows written by the publish tick | `social.read` | "No failed or uncertain posts in the last 30 days." |
| Attention · Inbox SLA breaches | `social_conversations` OPEN/PENDING with `sla_due_at` < now | Computed on request; conversations are filled by the inbox poll/webhook | `social.read` | "No conversation is past its reply deadline." |
| Attention · Red health checks | `health_check_results` (`status = red`) | Written by the 5-minute tick (`opsTick`) | `ops.health.read` | "All stored health checks are OK or not yet checked." / "Health has not been recorded yet." |
| Attention · Social accounts needing action | `social_accounts` status `NEEDS_REAUTH`/`ERROR`, or `token_expires_at` within 14 days | Written when accounts connect/refresh | `social.read` | "No connected account needs attention." (Meta reports no expiry for the current tokens; none is guessed.) |
| Website | `analytics_events` (`page_view`: views, distinct sessions, top pages) | Written by the website beacon; computed on request | `analytics.read` | "No website traffic has been recorded yet." |
| CRM | `leads` (by status, created in period), `opportunities` (open count/value, won in period) | Computed on request | `leads.read` / `opportunities.read` (each half shown separately) | "No leads yet." / "No opportunities yet." |
| Social | `social_account_metrics` (followers, reach, views, engagement per day), `social_post_metrics` (top posts); coverage from `social_analytics_state` | Daily snapshot job (existing); read only | `social.analytics.read` (ADMIN/SUPER_ADMIN) | "No analytics have been stored yet — they appear after the first daily sync." |
| Social accounts (basic) | `social_accounts` count by status | Computed on request | `social.read` | "No social account is connected." |
| Marketing · Landing pages | `analytics_events` with path `/lp/…`, `form_submissions` of landing-managed forms, `pages.landing_builder` | Computed on request | `marketing.landing.read` | "No landing page has been published." / "No views recorded yet." |
| Marketing funnel | landing views → form submits → CRM leads (`source LIKE 'landing:%'`) → qualified → converted, by UTM source | Computed on request | `marketing.landing.read` for the first two stages, `leads.read` for the last three (missing stages are hidden, never zero) | "No landing-page activity in this period." |
| Operations | `job_heartbeats` (scheduler jobs), `health_check_results` summary | Written by ticks | `ops.health.read` (ADMIN/SUPER_ADMIN) | "Health has not been recorded yet." |

Not included on purpose: SEO audit scores (computed live from page content, not stored), website performance/Lighthouse (not stored),
email, WhatsApp, ad spend, revenue forecasts.

## 2. Period selector and comparison

Periods: last 7, 28 or 90 completed days (ending yesterday, UTC). The previous equal-length period is compared **only when both periods are fully
covered**:

* website / funnel: the first stored `analytics_events` row is on or before the start of the previous period;
* CRM: the oldest lead is on or before the start of the previous period;
* social: the existing social-analytics rule (every day of both periods has a stored number).

Otherwise the card shows the reason ("Comparison needs data from <date>") instead of a percentage. A previous value of 0 gives no percentage.

## 3. Permissions

No new permission is needed for reading: every widget is gated by the permission of the module it summarises, so the Dashboard shows exactly what the
user could already open. `GET /api/v1/dashboard` needs only a signed-in internal user; widgets the user cannot read come back as
`{ "state": "forbidden" }` and are hidden in the UI (the server never computes them). CLIENT_PORTAL users are refused.

New: **`reports.manage`** (create/edit/delete report schedules, set the global kill switch, view run history) — granted to **SUPER_ADMIN and ADMIN only**.
Saved views and CSV export use the widget's own read permission.

## 4. Scheduled reports

* Schedules: weekly (Monday 07:00 UTC) or monthly (1st, 07:00 UTC); chosen sections; chosen recipients.
* **Dry run is the default** for every new schedule: the run renders each recipient's report and stores it, but nothing is delivered.
* **Kill switch** (`dashboard_report_settings.kill_switch`): stops all scheduled and test deliveries immediately; runs are skipped and recorded as `KILLED`.
* Recipients must be active internal users (not CLIENT_PORTAL) with the permission of **every** selected section — enforced when saving and again at generation time. If
  permissions changed afterwards, the recipient receives only the sections they may still read; with none left they are skipped.
* Delivery: **in-app notification with a downloadable HTML file** always. **Email** is added only when an outbound email provider is configured (`EMAIL_PROVIDER`
  = `resend`); in production it is currently `none`, so reports are in-app only. PDF is not generated (no PDF renderer in the stack); the HTML file prints to PDF cleanly.
* "Send test to me" delivers one real copy to the caller only (blocked by the kill switch).
* Every create/update/delete/run/send/kill-switch change writes an audit entry. Run results (per recipient: sections, outcome) are stored in `dashboard_report_runs` / `dashboard_report_deliveries`.
* Scheduler: runs on the existing 5-minute automation tick via `reportTick`; a heartbeat key `dashboard_reports` appears in System Health.

## 5. Saved views and CSV

A saved view stores `{ name, period }` per user (`dashboard_views`). CSV export is per widget: `GET /api/v1/dashboard/export/:widget.csv?period=…`, same permission
as the widget, same numbers as on screen (it reuses the dashboard computation).

## 6. Endpoints

| Method + path | Permission |
|---|---|
| `GET /dashboard?period=` | signed-in internal user (per-widget permissions) |
| `GET /dashboard/funnel?period=` | `marketing.landing.read` (stages by permission) |
| `GET /dashboard/export/:widget.csv?period=` | widget's permission |
| `GET/POST/DELETE /dashboard/views` | signed-in internal user (own views) |
| `GET/POST/PATCH/DELETE /dashboard/reports/schedules`, `GET …/runs`, `POST …/schedules/:id/run`, `POST …/schedules/:id/send-test`, `PUT /dashboard/reports/settings` | `reports.manage` |
| `GET /dashboard/reports/inbox`, `GET /dashboard/reports/deliveries/:id/download` | the recipient only |

## 7. Funnel attribution

A landing session is attributed to the UTM source of its **first** landing view in the period; submissions use their own `utm_source`; leads use `leads.utm_source` (source tag `landing:…`). Qualified/converted are the lead's current status. Stages are counts, never rates.
