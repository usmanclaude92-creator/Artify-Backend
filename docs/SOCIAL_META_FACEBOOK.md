# Facebook Pages connector (Step 8, provider key `meta_facebook`)

Code: `server/services/social/connectors/{metaGraph,facebookPageProvider,setupInfo}.ts`. Instagram will reuse `metaGraph.ts` (transport, signature check, error classes).

## Meta app dashboard settings
- **Facebook Login → Valid OAuth Redirect URIs:** `<CONTROL_CENTER_BASE_URL>/social/accounts`
- **Webhooks → Page object:** callback URL `<CONTROL_CENTER_BASE_URL>/api/v1/social/webhooks/meta_facebook`, verify token = value of `META_WEBHOOK_VERIFY_TOKEN`; subscribe to `feed`, `messages` (and `mention`, `ratings` if offered).
- **Permissions:** `pages_show_list`, `pages_manage_metadata`, `pages_manage_posts`, `pages_manage_engagement`, `pages_read_engagement`, `pages_read_user_engagement`, `pages_messaging`.
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
