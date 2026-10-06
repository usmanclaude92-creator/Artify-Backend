# Social publishing (Step 6)

Publishing is **OFF by default** everywhere. Nothing is sent to a network until all of these are true, re-read from the
database before every attempt: env `SOCIAL_PUBLISHING_DISABLED` is not `true` → global kill switch off → global enabled →
workspace kill switch off → workspace enabled. Dry-run (global OR workspace) performs everything except the final network call.

## Scheduling
`GET|POST /api/v1/social/internal/publish-tick` (Bearer `CRON_SECRET`, constant-time compare, 404 when unset) runs one pass:
recover stale locks → mark MISSED → claim and publish due targets (batch 20, concurrency 3, ≤2 per account per tick, 8 s budget).
The existing GitHub Actions workflow `automation-tick.yml` already calls `/automation/internal/tick` every 5 minutes, and that
tick runs the same publisher pass, so no new secret or workflow is needed. Vercel Hobby only runs the daily cron, so expect
≈5-minute granularity with best-effort GitHub timing; the grace window (default 60 min) absorbs lateness.

## Target state machine
`PENDING → SCHEDULED → PUBLISHING → PUBLISHED | FAILED | UNCERTAIN`, plus `SCHEDULED → MISSED | CANCELLED`.
Transient failures (network before send, 429, 5xx) go back to SCHEDULED with exponential backoff + jitter (2 min base, 60 min cap,
honours Retry-After) up to `maxAttempts` (default 5), then FAILED. Permanent errors fail at once. Auth errors → account `NEEDS_REAUTH`
+ notification. Unknown outcomes (timeout after send, worker death) → UNCERTAIN: never retried automatically.

## At-most-once
The claim is one atomic `UPDATE … WHERE status='SCHEDULED'` (count 1 wins). `PUBLISHING` older than 10 min becomes UNCERTAIN.
Operator "Retry now / Reschedule" on an UNCERTAIN target requires `confirmNotPosted`. User transitions on a post never touch
PUBLISHED / PUBLISHING / UNCERTAIN targets. LinkedIn has no client idempotency key, so UNCERTAIN + manual resolution is the guard.

## API (all under `/api/v1/social/publishing`)
`GET /queue`, `GET /failures?status=`, `GET /targets/:id` (attempt timeline), `GET /metrics` (social.read) ·
`POST /targets/:id/retry|reschedule|mark-published|cancel` (social.publish) · `GET|PUT /settings` (PUT: social.accounts.manage + ADMIN) ·
`PUT /global` (SUPER_ADMIN). Nav badge `socialFailures` for `social.publish` holders.

## Environment variables (names only)
`CRON_SECRET`, `SOCIAL_VAULT_KEYS`, `SOCIAL_VAULT_ACTIVE_KEY_VERSION`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`,
`LINKEDIN_API_VERSION` (YYYYMM, default 202504), `SOCIAL_PUBLISHING_DISABLED`, `CONTROL_CENTER_BASE_URL`,
`SOCIAL_PUBLISH_BATCH_SIZE`, `SOCIAL_PUBLISH_CONCURRENCY`, `SOCIAL_PUBLISH_PER_ACCOUNT_LIMIT`, `SOCIAL_PUBLISH_TIME_BUDGET_MS`.

## LinkedIn connector — verify before first live use
Written from knowledge of the API; the official docs could not be fetched while building. See the checklist at the top of
`server/services/social/connectors/linkedinApi.ts` and the fixtures in `tests/fixtures/linkedin/` (hand-authored, not recorded).
