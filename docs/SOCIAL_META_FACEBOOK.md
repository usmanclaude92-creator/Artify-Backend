# Facebook Pages connector (Step 8, provider key `meta_facebook`)

Code: `server/services/social/connectors/{metaGraph,facebookPageProvider,setupInfo}.ts`. Instagram will reuse `metaGraph.ts` (transport, signature check, error classes).

## Meta app dashboard settings
- **Facebook Login → Valid OAuth Redirect URIs:** `<CONTROL_CENTER_BASE_URL>/social/accounts`
- **Webhooks → Page object:** callback URL `<CONTROL_CENTER_BASE_URL>/api/v1/social/webhooks/meta_facebook`, verify token = value of `META_WEBHOOK_VERIFY_TOKEN`; subscribe to `feed`, `messages` (and `mention`, `ratings` if offered).
- **Permissions:** `pages_show_list`, `pages_manage_metadata`, `pages_manage_posts`, `pages_manage_engagement`, `pages_read_engagement`, `pages_messaging` (the default login set; `pages_read_user_engagement` is NOT available to this app and makes Facebook reject the login). Optional: add `pages_read_user_content` in the dashboard, then list it in `META_LOGIN_SCOPES`.
- Webhook subscription per Page is done by the connector right after the Page is connected (`POST /{page-id}/subscribed_apps`), using that Page's token.

## Env vars (names only)
`META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_API_VERSION` (default `v25.0`), `META_APP_MODE` (informational: development|live|unknown), `META_INBOX_POLLING` (default false; polling backfill safety net).

## Tokens
code → short-lived user token → long-lived user token (`fb_exchange_token`) → `GET /me/accounts` → one Page access token per Page. A Page token obtained from a long-lived user token has no expiry; only Page tokens are stored (encrypted, bound to the account id); the user token is discarded. `/debug_token` (app token) checks validity, scopes and `data_access_expires_at`; the earliest non-zero expiry feeds the 7-day warning. Page tokens cannot be refreshed: reconnect.

## Messaging rules
Messenger replies use `messaging_type=RESPONSE` only, inside 24 hours of the person's last message (checked before every send; the Inbox shows a banner and blocks sending when closed). Message tags are not used. Comment replies have no window.

## Documentation relied on (developers.facebook.com) — excerpts only, see the verify list
Manual login flow, long-lived tokens, debug_token, Pages API getting started, Page webhooks + Messenger webhooks (verify token, `X-Hub-Signature-256`), Send API, Page feed / comments / conversations reference, rate limits, permissions reference, app modes. The pages could not be fetched in full from the build environment.

## Verify on the first live test (hand-authored fixtures, not recordings)
Comment webhook payload fields (`comment_id`, `parent_id`), ratings payload, `subscribed_fields` names (`mention`, `ratings`), JSON bodies on every POST edge, `appsecret_proof`, `/me/permissions`, the `tasks` values (`CREATE_CONTENT`, `MODERATE`, `MESSAGING`), polling edge fields, Messenger text limit (2000), error codes.

## Scheduled publishing needs an external trigger

Vercel's own cron entry for this project runs once a day (`0 0 * * *`), and the in-process scheduler only runs while a
serverless instance is warm. Scheduled posts therefore publish late unless something calls the tick regularly:

- `POST /api/v1/social/internal/publish-tick` with `Authorization: Bearer <CRON_SECRET>` (404 if `CRON_SECRET` is unset).
- It is subject to the same gate as every publish: global/workspace enabled, kill switch, dry-run.
- Options: the bundled GitHub Actions workflow `.github/workflows/social-publish-tick.yml` (every 5 minutes; add repo secret
  `CRON_SECRET`; it only runs once it is on the default branch), or any external pinger (for example cron-job.org at 1-minute
  intervals) sending the request above. Manual **Retry now** never depends on this.
