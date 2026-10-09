# Meta App Review readiness (Step 15)

Nothing in this document has been submitted to Meta. The app has not been switched to Live and no app setting was changed through the API.

## 0. Facts, with sources, and how sure we are

**Honest limit:** `developers.facebook.com` was blocked from the build environment, so Meta's pages could not be opened and quoted. The facts below come from search results that surfaced those pages' titles and snippets, plus third-party write-ups. Each row says which. **Before submitting, open the linked Meta page and confirm the row.** Nothing below is treated as certain unless marked "Meta page (snippet)".

| # | Fact | Source | Confidence |
|---|---|---|---|
| 1 | App Review needs a screen recording for every permission/feature requested. Reviewers use the recording as the guide to test it; a permission they cannot confirm from the recording is not approved. | [Meta: App Review submission guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide), [Meta: Screen recordings](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/) | Meta page (snippet) |
| 2 | Each recording shows the person logging in, **granting the permission**, and then using the feature that needs it. It does not have to justify the permission (the form does). English UI, 1080p or better. | same | Meta page (snippet) |
| 3 | The reviewer needs working access: a publicly reachable app or access instructions, and credentials for a test user if people can sign in without Facebook Login. | same | Meta page (snippet) |
| 4 | Show the first-time consent screen (an already-connected account hides it), and keep recording and submission consistent (do not request write permissions and show only reads). | third-party guides: [singhamandeep.com](https://singhamandeep.com/meta-app-review-screencast-why-your-demo-video-gets-rejected-2026/), [dojolabs.co](https://dojolabs.co/blog/meta-app-review-rejected-what-to-fix/) | Third party |
| 5 | **Data deletion:** apps must give people a way to request deletion. In the app dashboard you enter either a *Data Deletion Request URL* (a callback) or a *Data Deletion Instructions URL*. | [Meta: Data Deletion Request Callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback) | URL from Meta; behaviour from several implementations (below) |
| 6 | Callback format: Meta sends `POST` with a `signed_request` parameter. It is `base64url(HMAC-SHA256(payloadPart, appSecret)) + "." + payloadPart`; the payload is JSON with `algorithm` (`HMAC-SHA256`), `issued_at` and `user_id` (app-scoped id). The response must be JSON `{ "url": "<status page>", "confirmation_code": "<code>" }`. | [Meta: Facebook Login manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow) and community implementations that agree: [Influence-Inc PR 44](https://github.com/Influence-Inc/Creator-Database/pull/44), [471k/pena-e-arte PR 234](https://github.com/471k/pena-e-arte/pull/234), [fjahn gist](https://gist.github.com/fjahn/112ecdd690ba72340deb17169554f016) | Implemented to the common description; **verify against Meta's page** |
| 7 | **Deauthorize callback:** Meta POSTs a `signed_request` (same format) when a person removes the app; field *Deauthorize Callback URL* in Settings → Advanced. It is a notification; the data-deletion callback is separate. | [Meta: manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow), [dev.to walkthrough](https://dev.to/moiz1524/facebook-data-deletion-request-callback-jfk) | Mixed; verify |
| 8 | Privacy policy: must be publicly available, non-geo-blocked, linked in the app's details, and cover the app's data use (a website-only policy is not enough). Must give a way to ask for deletion. | [Meta: Privacy Policy Requirements](https://developers.meta.com/horizon/policy/privacy-policy/) (this is the **Horizon/Quest** page; Facebook-platform rules may differ), [Platform Terms update](https://developers.facebook.com/blog/post/2020/07/01/platform-terms-developer-policies/) | Partly different product; verify |
| 9 | **Advanced access** (needed to serve Pages/Instagram accounts you do not own or manage) requires App Review and **Business Verification**. Standard access works for people with a role on the app. | [Meta: Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview/), [Pages API](https://developers.facebook.com/docs/pages-api/) | Meta page (snippet) |
| 10 | Business Verification is done in Business Settings → Security Center by a Business admin; documents must show the legal name, address and (usually) be recent; a country-specific list applies; decisions can take days to two weeks. Domain verification is a separate step. | third party: [respond.io](https://respond.io/help/whatsapp/meta-business-verification), [herocontent.ai](https://herocontent.ai/en/blog/verify-facebook-business-manager) | Third party |
| 11 | Annual **Data Use Checkup**: apps live with Advanced access must self-certify compliance each year or risk being disabled. | [Meta Horizon Developer Data Use Policy](https://developers.meta.com/horizon/policy/data-use/) (Horizon page), [singhamandeep.com](https://singhamandeep.com/meta-data-use-checkup-app-disabled/) | Verify for Facebook apps |
| 12 | Permission dependencies: `pages_manage_engagement` is reviewed together with `pages_read_user_content`; Instagram messaging/comments need Advanced access with the Page permissions. | third party: [singhamandeep.com Pages permissions](https://singhamandeep.com/facebook-page-api-permissions-app-review/), [bundle.social](https://bundle.social/blog/facebook-api-permissions) | Third party; verify in the dashboard's permission list |

## 1. Audit: what existed

| Area | Found |
|---|---|
| Permissions requested | Facebook: `pages_show_list, pages_manage_metadata, pages_manage_posts, pages_manage_engagement, pages_read_engagement, pages_messaging` (+ `read_insights` when `SOCIAL_ANALYTICS_SCOPES=true`; production also sets `pages_read_user_content` through `META_LOGIN_SCOPES`). Instagram: `instagram_basic, instagram_content_publish, instagram_manage_comments, instagram_manage_messages, pages_show_list, pages_read_engagement, business_management` (+ `instagram_manage_insights`). |
| Webhook | `POST/GET /api/v1/social/webhooks/:provider` with `X-Hub-Signature-256` check and `hub.challenge` handshake (done in Step 8/9). |
| Privacy tooling | Lookup, export, erasure with two-person approval (Step 13). |
| Website | `/privacy` and `/terms` existed but contained unverifiable claims (SOC 2/HIPAA alignment, 99.99 % uptime, zero data retention, "tamper-proof storage") and were not in the sitemap. No deletion page. |
| Missing | Deletion and deauthorize callbacks, status page, a reviewer path, a submission pack. |

### Permission diff

| Permission | Used by (code) | Decision |
|---|---|---|
| `pages_show_list` | `GET /me/accounts` to list Pages and get Page tokens (both connectors) | keep |
| `pages_manage_posts` | `POST /{page}/feed`, `/{page}/photos` (publishing) | keep |
| `pages_read_engagement` | Page feed, tagged posts, conversations, post/Page insight reads | keep |
| `pages_manage_engagement` | reply to and hide/unhide comments | keep |
| `pages_manage_metadata` | `POST /{page}/subscribed_apps` (webhook subscription) | keep |
| `pages_messaging` | Messenger send/receive (`/me/messages`, `/{page}/conversations`) | keep |
| `pages_read_user_content` | read visitor posts/comments on the Page timeline (inbox, listening) | keep (enabled via `META_LOGIN_SCOPES` in production; not in the code default) |
| `read_insights` | Page insights (`/{page}/insights`, `/{post}/insights`) | keep (only when `SOCIAL_ANALYTICS_SCOPES=true`) |
| `instagram_basic` | Instagram account profile and media | keep |
| `instagram_content_publish` | container → `media_publish` | keep |
| `instagram_manage_comments` | comment replies, hide, mention replies | keep |
| `instagram_manage_messages` | Instagram DMs (`/{page}/messages`, conversations) | keep |
| `instagram_manage_insights` | Instagram account/media insights | keep (only when `SOCIAL_ANALYTICS_SCOPES=true`) |
| **`business_management`** | **no API call in the code uses it** (it was added as a workaround for Pages owned by a Business portfolio missing from `/me/accounts`) | **removed from the default Instagram login scopes** |

Diff in code: `DEFAULT_INSTAGRAM_SCOPES` loses `"business_management"` (`server/services/social/connectors/instagramProvider.ts`); two tests and `docs/SOCIAL_INSTAGRAM.md` updated. Effect: only *new* Instagram connections; accounts already connected keep what they granted. If a Page that sits in a Business portfolio is missing from the list after this change, add the permission back for that case through `META_INSTAGRAM_LOGIN_SCOPES` (it would then need review and Business Verification). **Do not request `business_management` in the submission.**

## 2. What was built

| Repo | Built |
|---|---|
| Backend | `POST /api/v1/meta/data-deletion` and `POST /api/v1/meta/deauthorize` (signed_request verified with `META_APP_SECRET`, fails closed, rate limited, audited); `GET /api/v1/meta/deletion-status?code=`; deletion requests feed the existing privacy-erasure approval (Approvals center, source *privacy*, two-person rule; the requester is the system, so any single privacy approver is a different person); `social_accounts.meta_user_id` (filled at connect and backfilled by the daily health check); table `meta_data_requests`; demo workspace seed/remove (`/api/v1/ops/meta-review`, SUPER_ADMIN, page *Administration → Operations → Meta Review Demo*); `business_management` removed. |
| Website | Rewritten `/privacy`, `/terms`, new `/data-deletion` and `/data-deletion-status`; server-rendered HTML for the three public pages (readable without JavaScript); sitemap and footer links; `noindex` on the status page; unfinished owner wording shown as highlighted `[Owner to confirm: …]`. |

### How the callbacks behave

* **Deauthorize:** verified request → accounts whose `meta_user_id` equals the id are set to `NEEDS_REAUTH`, their stored tokens deleted, an audit row `META_DEAUTHORIZED` written (identifier hashed). Always answers 200 for a valid request, even if nothing matched.
* **Data deletion:** verified request → a *pending* privacy request (`kind META_DELETION`) and an approval per workspace that holds linked data → response `{ url, confirmation_code }` (`MDR-…`). A repeat from Meta returns the same code. Nothing is deleted until an approver with `privacy.erase` approves; approval disconnects the accounts, deletes the tokens and the message text of conversations whose participant id equals the Meta user id, and clears their name/handle. Status: `IN_REVIEW → COMPLETED / DECLINED`, or `NOTHING_HELD` at once.
* **Rejections:** missing, malformed, wrong-secret, tampered, expired (older than 3 days or issued in the future), non-HMAC-SHA256 or user-less requests get `400 {"error":"Invalid request."}` and an audit row `META_CALLBACK_REJECTED`; `503` if `META_APP_SECRET` is not set. Nothing is leaked in the body.

### Limits to know about (be honest with the reviewer if asked)

1. Meta's callback gives the **app-scoped user id**. Comment and mention authors have that same id; **Messenger/Instagram DM senders carry a page-scoped id** that Meta does not reveal in the callback, so DM content is not matched automatically. Those requests are handled through the email path on the Data Deletion page, and DMs are auto-purged after the workspace's retention (180 days default).
2. Accounts connected before Step 15 have no `meta_user_id` until the next daily health check fills it from Meta's `debug_token`.
3. The signed_request format was implemented from the documented description and community implementations (fact 6/7); the dashboard's *Test* button should be used once to confirm Meta accepts the response.

## 3. Reviewer support

Two ways, both documented; choose one.

**A. Demo workspace (recommended).** SUPER_ADMIN opens *Administration → Operations → Meta Review Demo → Create demo workspace*. It creates the isolated organization "Meta Review Demo" (no real customer data) with two clearly fictional sample accounts, four sample conversations, two sample posts and one reviewer login `meta-reviewer@artifysols.com` (ADMIN of that workspace only). The password is shown **once**; paste it into the submission's reviewer instructions only. The reviewer connects **their own** Meta test Page and test Instagram account to exercise live permissions. After review, *Remove demo workspace* deletes the organization, the reviewer and everything created in it. Create it just before submitting and remove it when Meta is done.

**B. Existing workspace.** Add the reviewer as a user with role ADMIN and remove them afterwards. Not recommended: they would see real data.

Requirements on the Meta side (not automated; yours): add the reviewers' Facebook accounts as **testers/roles** while the app is in Development mode, or use Meta's *Test users*; create a **test Facebook Page** and a **test Instagram professional account linked to it** and put the Page/Instagram handles into the instructions.

**Publishing must be live for the demo.** Publishing is OFF by default (global switch and per-workspace switch, both with dry-run). For the review window: *Social → Publishing Queue* (SUPER_ADMIN: global on, dry-run off; then the demo workspace: on, dry-run off). Turn both off again afterwards. This path was exercised in earlier steps against a real Page, not re-run for this step.

## 4. Submission pack

### 4.0 Setup text for the "Instructions for reviewers" field (fill the bracketed values)

> Control Center is a web app for businesses to manage their own Facebook Pages and Instagram professional accounts: schedule and publish posts, answer comments and messages in one inbox, and view analytics.
> Open https://cc.artifysols.com and sign in with **[reviewer email]** / **[reviewer password]** (a demo workspace with fictional data, created for this review). No two-factor step.
> Use the Meta **test user** **[name]** and test Page **[Page name]** / Instagram **[handle]**. In the left menu choose *Social Media → Accounts*, then *Connect Facebook Pages* (or *Connect Instagram*) and approve every permission on the Facebook screen.
> Publishing has been switched on for this workspace for the review. Each permission below has its own numbered steps and recording.

Common to all recordings: English UI, 1080p, browser at 100 % zoom, desktop, start from the Accounts page with the account **not yet connected** so the consent screen is shown. Keep each recording to **90 seconds or less** (or join all steps of one use case into one video of 5 minutes, which is allowed if each permission is clearly shown, fact 1/2; confirm in the form).

Retention numbers below are the platform defaults (`RETENTION_POLICY`; see OPERATIONS.md §6).

### 4.1 `pages_show_list`
* **(a) Feature:** Social Media → Accounts → *Connect Facebook Pages*: lists the Pages the person manages so they can choose which to connect.
* **(b) Why:** without the list there is no way to pick the Page to manage.
* **(c) Steps:** 1. Sign in. 2. Menu *Social Media → Accounts*. 3. Click *Connect Facebook Pages*. 4. On Facebook, continue as the test user and approve all permissions. 5. You return to Control Center and see the list of Pages; tick the test Page and click *Connect 1 selected*. 6. The Page appears as *Connected*.
* **(d) Screencast:** (0:00) Accounts page showing no connected account. (0:10) Click *Connect Facebook Pages*. (0:20) Show the Facebook consent screen, scroll so the permission names are readable, approve. (0:45) Show the Page picker listing the Pages. (1:00) Connect the test Page. (1:20) Show it as *Connected*. Stop.
* **(e) Data:** Page id, name, category, picture URL, the per-Page access token. Token encrypted at rest, never shown; deleted on disconnect, on deauthorize, or on an approved deletion request.

### 4.2 `pages_manage_metadata`
* **(a)** Connecting a Page subscribes the app to the Page's webhooks (`POST /{page}/subscribed_apps` for feed, messages, mentions); disconnecting removes the subscription.
* **(b)** Needed to receive comments and messages in real time.
* **(c)** 1. Connect the test Page (4.1). 2. Open *Accounts*, click the Page's card: the warnings area shows no webhook warning. 3. From another Facebook account, comment on a post of the test Page. 4. Open *Social Media → Inbox*: the comment appears within a minute. 5. Back on *Accounts* click *Disconnect* and confirm; the Page is *Disconnected* (webhook subscription removed).
* **(d)** (0:00) Connected Page card. (0:10) On a second browser/profile, write a comment on the Page. (0:30) Inbox shows it. (0:50) Back on Accounts click *Disconnect*, confirm. (1:10) Status shows *Disconnected*. Stop.
* **(e)** Webhook payload fields: Page id, event type, the commenter's name and id, text, timestamps. Stored in the inbox for 180 days (workspace setting 7–3650).

### 4.3 `pages_read_engagement`
* **(a)** Inbox and Listening read the Page's feed and conversations; Analytics reads post engagement counts.
* **(b)** To show comments and engagement on the Page's own content and measure replies.
* **(c)** 1. Open *Social Media → Posts*, pick a published post. 2. Open *Social Media → Analytics*, choose the Facebook Page, show *Top posts* with reactions/comments. 3. Open *Inbox*, filter *Comments*.
* **(d)** (0:00) Posts list. (0:15) Open Analytics → Top posts. (0:40) Open Inbox, filter Comments, open one conversation. Stop.
* **(e)** Counts and text of engagement on the Page's content; metrics kept as daily snapshots (no deletion schedule; deleted when the Page is disconnected and the workspace asks for it); inbox text 180 days.

### 4.4 `pages_manage_posts`
* **(a)** Composer: schedule and publish a text post or one photo to the Page (approval workflow, then the scheduler).
* **(b)** Core feature: publishing from Control Center.
* **(c)** 1. *Social Media → Composer*. 2. Write "Review test post", select the test Page. 3. Click *Submit for approval*. 4. Open *Approvals*, approve it. 5. In Composer choose *Schedule* a minute ahead. 6. Open *Publishing Queue*: status goes to *Published* with a link. 7. Open the link: the post is on the Facebook Page.
* **(d)** (0:00) Composer with text typed. (0:20) Submit; switch to Approvals and approve. (0:40) Schedule one minute ahead. (0:55) Queue shows *Scheduled* then *Published*. (1:15) Click the link and show the post on Facebook. Stop. (Delete the test post afterwards.)
* **(e)** Post text, link, one image; the returned post id/URL. Kept with the workspace's content until deleted by the customer.

### 4.5 `pages_manage_engagement`
* **(a)** Inbox: reply to a comment and hide/unhide a comment.
* **(b)** Community management: answering and moderating comments.
* **(c)** 1. From another account, comment on a Page post. 2. *Inbox* → open the comment. 3. Type a reply and click *Send*; show it under the comment on Facebook. 4. Click *Hide comment*; show it hidden on Facebook; click *Unhide*.
* **(d)** (0:00) Comment written on Facebook. (0:15) Inbox, open it. (0:30) Reply, send. (0:45) Facebook shows the reply. (1:00) Hide, show hidden state. (1:20) Unhide. Stop.
* **(e)** Comment text, commenter name/id, our reply, the hidden flag. Inbox 180 days. Replies are only sent by a person (automatic replies are off by default).

### 4.6 `pages_read_user_content`
* **(a)** Inbox / Listening: read comments and visitor posts written by other people on the Page.
* **(b)** The inbox shows what other people wrote, which needs this permission.
* **(c)** 1. From a second Facebook account, write a post on the test Page's timeline (or comment on a post). 2. Open *Inbox*: the item appears with the author's name. 3. Open *Listening*: the item is listed with sentiment.
* **(d)** (0:00) Second account writes a visitor post/comment. (0:20) Inbox shows it with the author name. (0:40) Listening page shows it. Stop.
* **(e)** Other people's public comment/post text, display name, id. 180 days; erased on request (Data Deletion page) or an approved Meta deletion request.

### 4.7 `pages_messaging`
* **(a)** Inbox: receive Messenger messages to the Page and reply within 24 hours.
* **(b)** Customer support via Messenger.
* **(c)** 1. From the test user's Messenger, send "Hello" to the test Page. 2. *Inbox* → the Messenger conversation appears. 3. Type a reply, *Send*. 4. The reply arrives in Messenger. (Replies are only sent inside the 24-hour window with `RESPONSE` type; no message tags.)
* **(d)** (0:00) Messenger window sends "Hello". (0:15) Inbox shows the conversation. (0:30) Reply sent. (0:45) Messenger shows the reply. Stop.
* **(e)** Message text, sender's page-scoped id (and name if provided), our reply. 180 days; private messages are the most sensitive data we hold, and the retention can be shortened per workspace.

### 4.8 `read_insights`
* **(a)** Social Media → Analytics: Page followers, reach, views, engagement per day, top posts.
* **(b)** Show customers how their Page performs.
* **(c)** 1. *Social Media → Analytics*. 2. Choose the Facebook Page and "Last 28 days". 3. Show the KPI cards and the daily series; click *Export CSV*.
* **(d)** (0:00) Open Analytics. (0:15) Select the Page and range. (0:30) Point at KPIs and chart. (0:50) Export CSV. Stop. Note on screen: a new Page may show "not available yet" until Meta has data; the app never shows made-up numbers.
* **(e)** Aggregated numbers per day (no personal data); stored as snapshots; no automatic deletion.

### 4.9 `instagram_basic`
* **(a)** Accounts → *Connect Instagram*: reads the linked Instagram professional account's profile (id, username, picture) and media.
* **(b)** Identify the account and show its posts.
* **(c)** 1. *Social Media → Accounts* → *Connect Instagram*. 2. Approve the permissions; tick both the Page and the Instagram account on the Facebook screen. 3. Choose the Instagram account in the picker and connect. 4. It appears as *Connected* with its handle.
* **(d)** (0:00) Accounts. (0:10) Connect Instagram, show the consent screen and the selected Instagram account. (0:50) Picker, connect. (1:10) Connected card with handle. Stop.
* **(e)** Instagram id, username, name, picture URL; token as in 4.1.

### 4.10 `instagram_content_publish`
* **(a)** Composer: publish an image to Instagram (container → publish).
* **(b)** Publishing from Control Center.
* **(c)** As 4.4 but select the Instagram account and attach a JPEG image from the Media library; after *Published*, open the link on Instagram.
* **(d)** (0:00) Composer, pick Instagram + image. (0:20) Submit, approve, schedule. (0:50) Queue *Published* (the container may take a moment). (1:10) Open the post on Instagram. Stop.
* **(e)** Caption and image; returned media id/permalink; daily publish cap (default 50, `INSTAGRAM_DAILY_PUBLISH_LIMIT`) enforced by the app.

### 4.11 `instagram_manage_comments`
* **(a)** Inbox: read and reply to comments on the Instagram account's posts; hide; reply to mentions.
* **(b)** Community management.
* **(c)** 1. A second account comments on an Instagram post. 2. *Inbox* → the comment. 3. Reply with *Send*; show it on Instagram. 4. *Hide comment* and show it hidden.
* **(d)** As 4.5 on Instagram. ≤ 90 s.
* **(e)** Comment text, commenter handle/id, our reply. 180 days.

### 4.12 `instagram_manage_messages`
* **(a)** Inbox: receive and answer Instagram direct messages (24-hour window).
* **(b)** Customer support via Instagram DM.
* **(c)** 1. From the test Instagram user, DM the business account. 2. *Inbox* shows the conversation. 3. Reply; it arrives in the Instagram app.
* **(d)** As 4.7 on Instagram. ≤ 90 s.
* **(e)** Message text, sender id; 180 days; see Limits (1).

### 4.13 `instagram_manage_insights`
* **(a)** Analytics for the Instagram account: followers, reach, views, interactions, top posts, audience.
* **(b)** Performance reporting.
* **(c)** Social Media → Analytics → pick the Instagram account → 28 days → KPI cards, *Top posts*, then *Audience* (shown only when Instagram returns it; accounts under the follower threshold show "not available").
* **(d)** (0:00) Analytics, pick Instagram. (0:20) KPIs and chart. (0:45) Top posts. (1:05) Audience. Stop.
* **(e)** Aggregated metrics and audience buckets (no personal data); snapshots, no automatic deletion.

### 4.14 `business_management`
**Not requested.** Removed (section 1). If Meta's form lists it as required for your use case, answer that no API call uses it; do not add it unless a connected Page cannot be found without it.

### 4.15 Data use, shared for every permission
* What the app does with Meta data: shows it to the customer who connected the account; classifies messages (topic, sentiment, priority) and drafts replies with an AI model **for a person to review** (`{{OWNER: confirm AI provider}}`); never sells it, never uses it for advertising or profiling, never trains models on it.
* Who sees it: users of that customer's workspace with the right role.
* Deletion: Facebook removal → deauthorize + deletion callbacks (this document §2); email path on `/data-deletion`; automatic purge by retention.

## 5. Business Verification checklist (owner)

- [ ] You are an admin of the Business portfolio that owns the app (Business Settings → Security Center).
- [ ] Legal business name, registered address, phone and website exactly as on the documents.
- [ ] At least two of: trade licence / certificate of incorporation, tax registration, a recent (within 12 months) utility or bank statement in the company name (Meta's accepted list is country-specific: check it for your country).
- [ ] Business email on your own domain, able to receive the verification code.
- [ ] Domain `artifysols.com` verified in Business Settings → Brand safety → Domains (DNS TXT or meta tag).
- [ ] Documents readable, not self-filed forms, not older than Meta allows.
- [ ] Expect up to about two weeks; do not submit App Review before verification finishes.

## 6. Pre-submission checklist (owner)

App dashboard → Settings → Basic:
- [ ] App icon 1024 × 1024.
- [ ] Category set (e.g. *Business and pages*).
- [ ] Privacy Policy URL: `https://artifysols.com/privacy`.
- [ ] Terms of Service URL: `https://artifysols.com/terms`.
- [ ] **User data deletion:** choose **Data deletion request URL** `https://cc.artifysols.com/api/v1/meta/data-deletion` (this build) *or* the instructions URL `https://artifysols.com/data-deletion`. Use the callback, then press Meta's test button once.
- [ ] Deauthorize callback URL: `https://cc.artifysols.com/api/v1/meta/deauthorize` (Settings → Advanced).
- [ ] App domains: `artifysols.com`, `cc.artifysols.com`.
- [ ] Contact email = the mailbox in the Privacy Policy.
- [ ] Business Verification complete; Data Use Checkup answered if prompted.
- [ ] Every `[Owner to confirm: …]` on the three public pages replaced (list below).
- [ ] Test users / testers added; test Page and linked test Instagram account created.
- [ ] Demo workspace created, reviewer credentials pasted into the reviewer instructions, publishing switched on for the review window.
- [ ] Recordings made per section 4, English, 1080p.
- [ ] App mode: stay in **Development** while submitting; **do not** switch to Live until Meta has approved (switching is your decision, not done by this build).
- [ ] After approval: remove the demo workspace, switch publishing back to your normal setting, put a reminder for the annual Data Use Checkup.

### Owner values still unfilled in the public pages
Run `listOwnerMarkers()` (website repo, `src/components/pages/legalContent.ts`) or search the three pages for "Owner to confirm". Current list: company legal name, registered business address, privacy contact email, contact email, effective date, response time, authority to complain to, legal bases and regulations, AI provider, email provider, hosting regions/transfer mechanism, retention confirmation, minimum age, ownership of custom work, fees, limitation of liability, governing law. Terms sections 8, 10 and 11 need a lawyer.

### Live test result (production, no secrets used)
* Forged, malformed and missing `signed_request` on both callbacks: `400 {"error":"Invalid request."}`; 7 `META_CALLBACK_REJECTED` audit rows written; unknown/junk codes on the status endpoint: 404.
* Demo workspace: created, second create refused (409), reviewer login worked, saw only sample data, could not read the main workspace, workspace removed, reviewer's token invalid afterwards. Found and fixed: the reviewer (ADMIN of the demo workspace) could read System Health; `/ops/health` and `/ops/backups` are now limited to the main workspace.
* **Not verified live:** a correctly signed request. It needs the real app secret, which was deliberately not read. Do it once with Meta's own test button (App dashboard → Settings → Advanced / Use cases → Data deletion → *Test*), then check *Approvals → Privacy* and `meta_data_requests`.

## 7. Operating it

* Approve or reject a Meta deletion request: *Approvals → Privacy* (needs `privacy.erase`, SUPER_ADMIN by default). The requester is the system, so one approver is enough; the rule "requester cannot approve" is not weakened for human-made requests.
* Audit actions: `META_DEAUTHORIZED`, `META_DEAUTHORIZE_RECEIVED`, `META_DELETION_RECEIVED`, `META_CALLBACK_REJECTED`, `PRIVACY_ERASURE_EXECUTED` (kind `META_DELETION`), `META_REVIEW_DEMO_SEEDED/REMOVED`.
* Needs `META_APP_SECRET` (already set in production). `PUBLIC_SITE_BASE_URL` is optional: the status link defaults to `https://artifysols.com`.
* Tests: `tests/unit/metaSignedRequest.test.ts` (fixtures in `tests/fixtures/meta/signed_requests.json`, signatures made with `openssl`), `tests/integration/metaCallbacks.test.ts`.
