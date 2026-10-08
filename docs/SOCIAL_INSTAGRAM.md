# Instagram connector (Step 9a, provider key `meta_instagram`)

Code: `server/services/social/connectors/instagramProvider.ts` (+ shared `metaGraph.ts`, `setupInfo.ts`). Instagram API **with Facebook Login** (Business/Creator account linked to a Facebook Page), Graph API `v25.0` on `graph.facebook.com`.

## 1. Facts this connector relies on (and where they come from)

> **How these were verified.** `developers.facebook.com` could not be fetched directly from the build environment (egress proxy). The facts below come from excerpts of the official pages returned by a domain-restricted search; some excerpts were from older page revisions. Anything not confirmed by an excerpt is listed in section 8 as **unverified** and must be checked on the first live test. Nothing here was coded from memory alone.

| Topic | Fact used | Doc |
|---|---|---|
| Overview / two login flavours | Two products exist: Instagram API with **Instagram Login** and with **Facebook Login**. Facebook Login needs the professional account linked to a Page and uses the Page's access token. | `/docs/instagram-platform/overview/`, `/docs/instagram-platform/instagram-api-with-facebook-login` |
| Publishing flow | 1) `POST /{ig-user-id}/media` creates a **container** (`image_url`, `caption`, `alt_text`, `media_type`, …); 2) the container is processed; 3) `POST /{ig-user-id}/media_publish` with `creation_id`. Only step 3 makes the post visible. | `/docs/instagram-platform/content-publishing/`, `/docs/instagram-api/reference/user/media_publish`, `/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/` |
| Container status | `GET /{container-id}?fields=status_code` → `IN_PROGRESS`, `FINISHED`, `ERROR`, `EXPIRED`, `PUBLISHED`; `status` carries a text/ error code. Poll **at most once a minute**, for up to **5 minutes**. Containers **expire after 24 hours**; max **400 containers per 24 h**. | `/docs/instagram-platform/content-publishing/`, `.../reference/ig-container` |
| Image rules | **JPEG only**, ≤ **8 MB**, aspect ratio **4:5 to 1.91:1**, width 320–1440 px. | `/docs/instagram-platform/content-publishing/` |
| Carousel | Up to **10** items. Children: `POST /{ig-user-id}/media` with `is_carousel_item=true` (no caption); parent: `media_type=CAROUSEL`, `children=id1,id2,…`, `caption`. Publish the parent. | `/docs/instagram-platform/content-publishing/` |
| Reels | `media_type=REELS`, `video_url`, optional `share_to_feed`; video containers need processing time (poll). MP4/MOV family. | `/docs/instagram-platform/content-publishing/` |
| Caption | ≤ **2,200** characters, ≤ **30** hashtags, ≤ 20 @-tags; `alt_text` ≤ 1,000. | `/docs/instagram-platform/content-publishing/` |
| Daily publishing limit | **The docs conflict**: the current page says 100 API-published posts per 24 h (carousels count once); other revisions say 50 (and a 2021 post said 25). Live quota: `GET /{ig-user-id}/content_publishing_limit` (`quota_usage`, `config.quota_total`). | `/docs/instagram-platform/content-publishing/` (see §8) |
| Comments | Read: `GET /{ig-media-id}/comments` (top-level, 50 per query; replies by expansion). Reply: `POST /{ig-comment-id}/replies` (`message`). Hide: `POST /{ig-comment-id}` with `hide=true`. A reply to a hidden comment is rejected. | `.../reference/ig-media/comments`, `.../reference/ig-comment/replies`, `/docs/marketing-api/reference/instagram-comment/` |
| Messaging | Instagram DMs use the **Messenger Platform** with the linked Page: send `POST /{PAGE-ID}/messages` with `recipient.id` = the **IGSID**, `messaging_type`, `message.text` (≤ **1,000 UTF-8 bytes**). Standard window: **24 hours** after the person's last message. `HUMAN_AGENT` tag extends to **7 days** but needs the Human Agent feature / App Review. The professional account must enable "Allow access to messages". Conversations: `GET /{PAGE-ID}/conversations?platform=instagram`. | `/documentation/business-messaging/messenger-platform/send-messages`, `.../policy`, `/docs/messenger-platform/conversations/`, `/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api` |
| Webhooks | Object **`instagram`** with its own callback URL / verify token in the app's Webhooks product. Fields used: `comments`, `messages` (also `mentions`, `live_comments` exist, not used). Deliveries carry `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret). Verification handshake: `hub.mode`, `hub.verify_token`, `hub.challenge`. | `/docs/instagram-api/webhooks`, `/docs/graph-api/webhooks/reference/instagram`, `/documentation/business-messaging/messenger-platform/webhooks` |
| Page subscription | `POST /{page-id}/subscribed_apps` with `subscribed_fields` **replaces** the list (it does not add). | `/docs/graph-api/webhooks`, Pages `subscribed_apps` reference |
| Permissions (Facebook Login) | `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`, plus `pages_show_list`, `pages_read_engagement` and `business_management` (listed as required on the app dashboard's "API setup with Facebook login" page; without it Pages owned by a Business portfolio may be missing from `/me/accounts`). Standard access works for people with a role on the app (Development mode); Live mode needs App Review. | `/docs/instagram-platform/instagram-api-with-facebook-login`, `/documentation/development/permissions` |

## 2. Where the docs contradict (or differ from) the Step 8 Facebook assumptions

1. **Comment replies:** Facebook uses `POST /{comment}/comments`; Instagram uses `POST /{comment}/replies`.
2. **Hide:** Facebook `is_hidden=true`; Instagram `hide=true` (field name differs; exact syntax still to confirm live).
3. **DM send:** Facebook Step 8 used `POST /me/messages` with the Page token. Instagram's docs address the **Page id**: `POST /{page-id}/messages`. Limits differ too: 2,000 characters on Messenger vs **1,000 bytes** on Instagram.
4. **Webhooks are a separate object.** Facebook = `page` object (`feed`, `messages`, …); Instagram = `instagram` object (`comments`, `messages`) with a **separate callback URL** (`/webhooks/meta_instagram`). The same `META_WEBHOOK_VERIFY_TOKEN` and app secret are reused. Instagram DM events are also delivered through the Page subscription (`messages`), whose field list is **replaced**, not merged, on every `subscribed_apps` POST: Instagram's `onConnected` therefore reads the current list and merges. (Step 8's Facebook `onConnected` writes `feed,messages,mention,ratings`, which already includes `messages`, so it cannot remove Instagram's field.)
5. **Media rules are stricter:** Facebook accepted JPEG/PNG/GIF and a text-only post; Instagram requires media, **JPEG only**, 8 MB, ratio 4:5–1.91:1.
6. **Publishing is multi-step and asynchronous.** Step 8 assumed one write call. Instagram needs container → poll → publish across minutes; the platform now keeps provider progress in `social_post_targets.provider_state` and has a "pending" outcome (§4).
7. **The daily limit is a documented hard cap** (docs disagree on the number, §8); Facebook had none enforced.
8. **Account identity:** a Facebook account is the Page id; an Instagram account is the **Instagram user id**, authorised with the **Page's** token. The Page token is stored (encrypted) separately for the Instagram account, so reconnecting the Facebook Page does not refresh Instagram's copy: reconnect Instagram too if its health check fails.
9. **Rate-limit/usage headers** are per-Page for Facebook; Instagram also has its own `content_publishing_limit` quota edge.

## 3. Can the existing Facebook Login flow be reused?

**Yes: the same login, the same redirect URI, the same code → long-lived token → `/me/accounts` flow.** No separate Instagram Login is needed (the "Instagram API with Instagram Login" product is a different path and is not used). What differs:

- the **scopes** requested (`instagram_*` + `pages_show_list`, `pages_read_engagement`; the default set is in `DEFAULT_INSTAGRAM_SCOPES`);
- `/me/accounts` is queried with `instagram_business_account{id,username,name,profile_picture_url}`, and only Pages with a linked professional account are offered in the picker.

This code uses the classic `scope=` parameter. A Facebook Login for Business `config_id` is **not** used (same as Step 8); if the app is later switched to configurations, only `getAuthUrl` changes.

## 4. Behaviour

**Connect.** Connected Accounts → *Connect Instagram* → Facebook dialog → picker lists Instagram accounts linked to Pages you manage. Errors (no Pages / no linked Instagram account) are shown verbatim as guidance (`ConnectorUserError`). The Page token is stored in the encrypted vault (bound to the account id); the user token is discarded.

**Publish (at-most-once).**
1. Guardrails block: text-only (`media_required`), non-JPEG, > 8 MB, width < 320 px, ratio outside 4:5–1.91:1, > 10 images, caption > 2,200. Links in captions raise a warning (not clickable).
2. Publisher claim → gate re-check (kill switch, dry-run, workspace scope) → **daily cap** (default 50, `INSTAGRAM_DAILY_PUBLISH_LIMIT`; counts PUBLISHED + UNCERTAIN in 24 h; plus the live `content_publishing_limit` when available) → dry-run branch (nothing sent).
3. Container(s) are created. Creating a container is **not** a commit, so an unanswered creation is a safe retry.
4. Status poll: `FINISHED` → continue; `IN_PROGRESS` → outcome **pending** (no attempt consumed, rechecked ~1 min later, gives up after 10 min for images); `ERROR`/`EXPIRED` → permanent failure with Instagram's text.
5. Before `media_publish` the intent (`phase: "publishing"`) is saved. Success → `PUBLISHED` (+ permalink). **No answer / 5xx / unlabelled error → `UNCERTAIN`**, never retried; a stored `publishing` phase makes any later attempt refuse to call `media_publish` again. Definite rejections are permanent; rate limits (code 4/17/32/613) are retried later. Manual *Retry now* / *Reschedule* clears the saved state (the operator has confirmed nothing was posted).
6. Reels: the connector path exists and is contract-tested, but the media library has no video type, so **reels are not offered** (`allowedMediaTypes` is JPEG only).

**Inbox.** Webhook (signature-verified, fail closed) → idempotent ingest as for Facebook. Polling fallback (`META_INBOX_POLLING`) reads `/{ig-id}/media?fields=comments…` and `/{page}/conversations?platform=instagram`. Reply to comment, hide comment, DM reply as `RESPONSE` inside 24 h only (checked before every send; the Inbox blocks it with a clear message when closed). **No message tags, no HUMAN_AGENT, auto-reply stays OFF.** Thread ids: `c:<root comment id>`, `dm:<IGSID>`.

## 5. Setup (Meta app dashboard)

1. **Use cases / products:** add the Instagram use case with `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`; Facebook Login is already configured (Step 8). Keep `pages_show_list`, `pages_read_engagement`, `business_management` (all already enabled).
2. **Facebook Login → Valid OAuth Redirect URIs:** unchanged: `<CONTROL_CENTER_BASE_URL>/social/accounts`.
3. **Webhooks → Instagram object:** callback `<CONTROL_CENTER_BASE_URL>/api/v1/social/webhooks/meta_instagram`, verify token = value of `META_WEBHOOK_VERIFY_TOKEN`, subscribe `comments` and `messages`.
4. **Roles:** your Facebook user must be an admin/developer/tester of the app (Development mode). The Instagram account must be a **Business or Creator** account, **linked to a Facebook Page you manage** (Create content, Moderate and Messages tasks). In Instagram: Settings → Messages and story replies → *Allow access to messages*.
5. Connect from Connected Accounts. The *Instagram setup* panel there shows the exact URLs and which env vars are set.

## 6. Environment variables (names only)

| Variable | Needed | Notes |
|---|---|---|
| `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | already set (Step 8) | reused as-is |
| `META_INSTAGRAM_LOGIN_SCOPES` | optional | comma-separated override. Facebook rejects the **whole** login if one permission is not enabled for the app; list only enabled ones (e.g. drop `instagram_manage_messages`). |
| `INSTAGRAM_DAILY_PUBLISH_LIMIT` | optional, default 50 | 1–100; the platform's own per-account cap per rolling 24 h |
| `META_INBOX_POLLING`, `CRON_SECRET`, `META_API_VERSION`, `META_APP_MODE` | existing | unchanged |

Database: migration `20261015090000_social_provider_state` (additive: `social_post_targets.provider_state JSONB NULL`).

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Invalid Scope" on the Facebook dialog | A listed permission is not enabled for the app. Set `META_INSTAGRAM_LOGIN_SCOPES` to the enabled ones. |
| "None of your Facebook Pages has an Instagram professional account linked" | Switch the account to Business/Creator and link it to a Page you manage; the logged-in Facebook user must manage that Page. |
| Post stays "scheduled" for minutes | The container is still processing (pending); it is rechecked every minute. |
| `Instagram could not process the media: … 2207xxx` | Image URL not fetchable, wrong format, or bad ratio. Use a JPEG within the limits; the signed media URL must be reachable by Meta. |
| Post is UNCERTAIN | `media_publish` got no clear answer. Check the Instagram profile, then *Mark published* or *Retry now* (after confirming it is not there). |
| "daily_limit" failure | The cap was reached. Reschedule; adjust `INSTAGRAM_DAILY_PUBLISH_LIMIT` only up to what the live quota shows. |
| DMs never arrive | "Allow access to messages" off; `messages` not subscribed on the Instagram webhook object or Page; app in Development mode and sender has no role on the app (only roles/testers' messages are delivered). |
| Reply refused: "within 24 hours" | The messaging window closed; this platform deliberately does not use tags. |
| Health check fails after reconnecting the Facebook Page | Reconnect Instagram too (it stores its own copy of the Page token). |

## 8. Unverified: check on the first live test (fixtures are hand-authored, not recordings)

- [ ] Daily publish limit: 100 vs 50 (docs conflict); the exact response shape of `content_publishing_limit` for this API (handled defensively: surprises are ignored).
- [ ] Hide-comment syntax (`hide=true`) and that it works with a Page token.
- [ ] Error codes/subcodes for container and publish failures (classified generically by `metaGraph.ts`; `error_user_msg` is shown).
- [ ] Exact Instagram `messages` webhook payload (assumed Messenger-shaped `entry[].messaging[]`) and the comment payload (`changes[].value.{id,text,from,media,parent_id}`).
- [ ] Which fields `/{page}/conversations?platform=instagram` returns for `from` (id vs username) and whether it needs `instagram_manage_messages`.
- [ ] Whether `instagram_manage_messages` is available to the app in Development mode without App Review, and that DMs from users without an app role are not delivered until Live.
- [ ] Reels (video) end to end; the media library has no video type, so this path is contract-tested only.
- [ ] That Meta can fetch the signed media URL (10-minute expiry) when creating the container.
- [ ] Container status text for `ERROR` and the typical processing time for images.
