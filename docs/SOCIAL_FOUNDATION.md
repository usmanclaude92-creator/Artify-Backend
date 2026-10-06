# Social Media foundation (Step 4)

Scope: permissions, connected-account schema, encrypted token vault, provider-agnostic connector interface, a mock
provider, the `/v1/social/accounts` API, a daily token-health job and the Connected Accounts UI. No publishing, inbox
or AI drafting yet.

## Tokens
- Stored only in `social_account_credentials` (AES-256-GCM, versioned key ring, bound to the account id as AAD).
- Never selected by default (separate table; every query uses an explicit allow-list), never returned by any API,
  never logged, never in audit metadata or notifications. Errors are passed through `redactSecrets` first.
- Rotation: add a key to `SOCIAL_VAULT_KEYS`, set/raise `SOCIAL_VAULT_ACTIVE_KEY_VERSION`; old records stay readable;
  `tokenVault.rotate()` re-encrypts.

## Environment variables (names only)
`SOCIAL_VAULT_KEYS`, `SOCIAL_VAULT_ACTIVE_KEY_VERSION`, `SOCIAL_MOCK_PROVIDER_ENABLED`, `CONTROL_CENTER_BASE_URL`,
`META_APP_ID`, `META_APP_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`. (`INTEGRATIONS_ENCRYPTION_KEY` /
`SESSION_SECRET` are the fallback key source; `CRON_SECRET` already drives the daily job.)

## OAuth flow
`POST /social/accounts/connect/start` -> `{ authUrl }` (single-use hashed `state`, 10 min, bound to user + workspace +
provider) -> provider -> browser returns to `/social/accounts?state=&code=` -> the page calls
`POST /social/accounts/callback`. A state used by another user/workspace, replayed, forged or expired is rejected.

## Daily job
`runTokenHealthJob()` runs inside the existing daily cron tick (`/automation/internal/tick`). Tokens expiring within 7
days are refreshed; if refresh or the health check fails the account becomes `NEEDS_REAUTH` (or `ERROR`) and every
active user holding `social.accounts.manage` in that workspace is notified once.

## Step 5 — content (Composer, Calendar, Brand Voice, AI drafting)
- Tables: `social_brand_voices`, `social_workspace_settings` (approval mode), `social_content_plans`, `social_posts`, `social_post_targets`.
- Lifecycle: DRAFT → PENDING_APPROVAL → APPROVED → SCHEDULED (PUBLISHING/PUBLISHED/FAILED are reserved for Step 6 workers). Guardrails (banned words, disclaimers, length, media, link, duplicates, account health) block PENDING_APPROVAL / SCHEDULED.
- Approvals: `social` is the fourth source in `/v1/approvals`; decisions delegate to `socialPostService.decide`.
- AI: prompts are registered per workspace in the AI prompt catalog (`social.draft_from_brief`, `social.content_plan`, `social.rewrite`); every call is an `AIExecution` + `AIUsageRecord`, goes through the AI adapter layer, and respects daily AI limits. AI output is always a DRAFT.
