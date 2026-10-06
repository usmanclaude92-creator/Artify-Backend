# Social inbox (Step 7)

Provider-agnostic Unified Inbox for comments, DMs, mentions and reviews. Proven against the mock provider only; no real network feed exists yet.

**Flow:** webhook (`POST /api/v1/social/webhooks/:provider`, signature verified by the connector, fails closed) or polling fallback → idempotent ingest
(unique `(account, providerMessageId)`) → deterministic prefilter (spam patterns, banned words) → AI triage (intent, sentiment, priority, language) via the AI module →
routing rules → optional auto-lead / AI draft → human reply. AI never sends, except guarded auto-reply (workspace opt-in, OFF by default).

**Privacy:** workspace-scoped; read = `social.read`, work = `social.reply`, rules/settings = `social.accounts.manage` (+ADMIN). Message text is never logged, audited or
stored in AI execution records; notifications carry a ≤40-char redacted preview. Retention default 180 days, purged by the tick (02–04 UTC).

**Sending:** only through `connector.sendReply/hideComment/markRead`; kill switches (env/global/workspace) block sends; per-account rate limit
(`SOCIAL_REPLY_RATE_PER_MINUTE`); atomic claim so a reply is never sent twice; unknown outcomes are UNCERTAIN and need explicit confirmation to retry.

## Meta connector — what it must implement later
- `verifyWebhook`: `X-Hub-Signature-256` HMAC-SHA256 with the app secret over the raw body (constant-time), plus the GET `hub.challenge` verification handshake.
- `parseWebhook`: map Page `feed` (comments), `messages` (Messenger/Instagram DMs), `mentions`, `ratings` into `InboundEvent` (stable thread + message ids).
- `fetchInbox` (polling backfill/recovery), `sendReply` (comment reply / Send API with the 24-hour messaging window and message tags), `hideComment`, `markRead`.
- Permissions to request: `pages_show_list`, `pages_read_engagement`, `pages_manage_engagement`, `pages_messaging`, `pages_read_user_content`, `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages` (App Review + Business Verification required).
