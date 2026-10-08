# Social Listening & Reviews (Step 10)

Code: `server/services/social/listening/*`, connectors' `fetchMentions` / `resolveMention` / `fetchReviewSummary`, routes under `/api/v1/social/listening` and `/api/v1/social/reviews`, pages *Social Media → Listening / Reviews*. The mention and review streams **reuse the inbox** (conversations, messages, triage, rules, SLA, CRM hand-off, retention); only genuinely new data has new tables.

## 1. Facts this feature relies on (and where they come from)

> **How these were verified.** `developers.facebook.com`, `developers.google.com` and `learn.microsoft.com` cannot be fetched from the build environment (egress proxy). Everything below comes from excerpts of the official pages returned by a domain-restricted search, several from old page revisions. Items marked **[ ]** could NOT be confirmed from any current excerpt; the code treats them defensively and the live test (section 8) records what Meta really returns.

### 1.1 Instagram mentions

| Topic | Fact | Doc |
|---|---|---|
| Webhook | Field **`mentions`** (object `instagram`) fires when another Instagram user @mentions the account **in a comment or in a caption** on media the account does **not** own. The payload only carries IDs: `media_id` (the media holding the mention) and `comment_id` (present for comment mentions). | [Webhooks reference: Instagram](https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram), [Webhooks](https://developers.facebook.com/docs/instagram-api/webhooks) |
| Fetch a comment mention | `GET /{ig-user-id}?fields=mentioned_comment.comment_id({comment_id}){…}`; the reference shows `timestamp`, `text`, `id` coming back. | [Webhooks](https://developers.facebook.com/docs/instagram-api/webhooks) |
| Fetch a caption mention | `GET /{ig-user-id}?fields=mentioned_media.media_id({media_id}){…}`; returnable fields: `caption`, `comments`, `comments_count`, `like_count`, `media_type`, `media_url`, `owner`, `timestamp`, `username`. `permalink` is not listed there **[ ]**. | [Mentioned Media](https://developers.facebook.com/docs/instagram-api/reference/user/mentioned_media) |
| Reply | `POST /{ig-user-id}/mentions` creates a comment on the comment or captioned media the account was mentioned in (`message` plus `comment_id` or `media_id`). The Instagram-Login guide names the permission `instagram_business_manage_comments`; for Facebook Login it is `instagram_manage_comments`. | [Mentions (Instagram Login)](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/mentions/), [IG User](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user) |
| Tags (photo tags) | `GET /{ig-user-id}/tags` lists media where the account was **tagged** by another user. Needs `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement`, `pages_show_list` (Facebook Login). | [IG User tags](https://developers.facebook.com/docs/instagram-api/reference/ig-user/tags) |
| Permissions for the webhook | In Live mode app users must have granted `instagram_manage_comments`. | [Webhooks](https://developers.facebook.com/docs/instagram-api/webhooks) |
| Limits | **Stories mentions are not supported. No webhook is sent when the media was created by a private account.** Replying to photos the account is merely tagged in is not supported. | [Mentions](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/mentions/) |
| Lookup path | The Facebook-Login webhook page and the Instagram-Login guide describe different lookup edges (`mentioned_*` vs `tags`/`mentions`). The code uses the `mentioned_*` edges for webhook IDs and `tags` only as the polling fallback. **[ ]** | both |

### 1.2 Facebook Page tags, mentions and visitor posts

| Topic | Fact | Doc |
|---|---|---|
| Posts that tag the Page | `GET /{page-id}/tagged` returns **public** posts in which the Page is tagged. Needs `pages_read_engagement` **and** `pages_read_user_content`; for Pages the app user does not manage it also needs the Page Public Content Access feature. Posts from other Pages are included only if those Pages are authentic. | [Page feed](https://developers.facebook.com/docs/graph-api/reference/page/feed/), [Pages API](https://developers.facebook.com/documentation/pages-api) |
| Feed webhook | Field `feed` (object `page`) delivers `item` (`post`, `photo`, `video`, `comment`, `status` …) with `verb` (`add`, `edited`, `remove`). A visitor post on the Page's timeline arrives as `item` ≠ `comment`, `verb: add`, `from.id` ≠ the Page. Not sent for ad posts. | [Webhooks for Pages](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-pages/) |
| `mention` webhook field | Subscribable via `POST /{page-id}/subscribed_apps` (Page token). No current official excerpt describes its payload **[ ]**; community reports say it did not fire in Development mode and may need Advanced Access for live data. The code accepts a feed-like payload (`post_id`/`comment_id`, `from`, `message`) and ignores anything else. | [subscribed_apps](https://developers.facebook.com/docs/graph-api/reference/v2.2/page/subscribed_apps), forum thread "Page mention - Not receiving Webhook events" |
| `visitor_posts` edge | Reference states it is **not supported for Pages on the New Pages Experience**; no formal deprecation found. This release does not call it; visitor posts come from the `feed` webhook. **[ ]** | [Page visitor_posts](https://developers.facebook.com/docs/graph-api/reference/page/visitor_posts/) |
| Data limit | With `pages_read_engagement` + `pages_read_user_content` only data **owned by the Page** is accessible. | [Pages API](https://developers.facebook.com/documentation/pages-api) |
| Permissions already held | `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement` are all in the connected Page's granted scopes. | — |

### 1.3 Facebook Page ratings / recommendations — **removed from the API**

| Topic | Fact | Doc |
|---|---|---|
| Deprecation | "Page recommendations have been deprecated for **v22.0 and future versions**. Attempting to read a recommendation, or get recommendations on a page, will return **error code 12**, and **Page ratings webhooks will no longer be sent**." Affected: `GET /{page-id}/ratings`, `GET /{recommendation-id}`, the Page `ratings` webhook. | [v22.0 changelog](https://developers.facebook.com/docs/graph-api/changelog/version22.0/) |
| Product change | Since Aug 2018 reviews are binary recommendations (`recommendation_type` positive/negative) instead of 1–5 stars. The Page's rating number is built from public recommendations/reviews and appears only with enough of them (≈5, unofficial). | [Aug 17 2018 change](https://developers.facebook.com/docs/graph-api/changelog/non-versioned-changes/aug-17-2018) |
| Text | Even before removal the `review_text` was reported as always empty/null in webhooks (forum, 2019). | forum thread "Ratings - review_text is always empty" |
| Replacement | No official replacement endpoint was found. The Page node fields `overall_star_rating` / `rating_count` could not be confirmed **[ ]**; the code reads them read-only and records the result honestly (null with a reason when absent). | — |

### 1.4 Google Business Profile reviews

| Topic | Fact | Doc |
|---|---|---|
| Access | The API is **not open**: you need a verified Business Profile active for **at least 60 days**, a website for the business, and must submit the *GBP API contact form* (Application for Basic API Access). Google says requests are reviewed within about **14 days**; approval is per Google Cloud project. A project quota of **0 QPM = not approved**, 300 QPM = approved. | [Prerequisites](https://developers.google.com/my-business/content/prereqs), [FAQ](https://developers.google.com/my-business/content/faq), [Limits](https://developers.google.com/my-business/content/limits) |
| Endpoints (v4) | `accounts.locations.reviews.list` (page size ≤ 50), `accounts.locations.batchGetReviews` (≤ 50 locations), `reviews.updateReply`, `reviews.deleteReply`. Locations must be verified. | [Work with review data](https://developers.google.com/my-business/content/review-data), [reviews resource](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews) |
| Auth | OAuth scope `https://www.googleapis.com/auth/business.manage`. | same |
| Quota | 300 QPM default for the account-level APIs; the reviews API is not listed separately **[ ]**. 429/RESOURCE_EXHAUSTED when exceeded. | [Limits](https://developers.google.com/my-business/content/limits) |

## 2. What is NOT available to us (and is not built)

- **Keyword / brand-name search over public posts** (on Facebook or Instagram) does not exist in the APIs we have. Facebook Page Public Content Access reads *Pages'* public content, not a search. The Instagram hashtag search is a separate, approval-gated feature (Instagram Public Content Access), limited to hashtags and not mentions of a brand name, and is **not built**. No scraping, no third-party firehose, no look-alike "search" box. Listening therefore only shows what Meta *sends or lists for our own accounts*: @mentions (comments/captions), photo tags, posts that tag the Page, and visitor posts on the Page.
- **Instagram Story mentions**, mentions on media of **private accounts**, replies to photo tags.
- **Facebook reviews / recommendations** (ingest, text, average rating from the ratings edge, webhook) — removed by Meta in v22.0 (1.3). The Reviews page shows this plainly instead of an empty list that looks like "no reviews".
- **Google reviews** — needs Google's API approval (1.4); only a stub that fails closed ships.
- **Instagram caption/comment @mentions cannot be listed** — there is no list endpoint, only the webhook IDs. If the webhook is not delivered the mention is missed; the polling fallback can only list *photo tags* (`/tags`) and Facebook `tagged` posts.
- **Replies to posts that only tag the Page** on someone else's timeline: no API; the UI shows "Reply on the platform" with a deep link.

## 3. Permissions and approvals needed beyond what you already have

- **Meta permissions: none new.** `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement`, `pages_read_user_content`, `pages_show_list`, `pages_manage_engagement` are already granted on both connected accounts.
- **Meta app dashboard (your action):** in *Webhooks → Instagram* subscribe the **`mentions`** field (today `comments` and `messages` are subscribed). The Facebook Page `mention` field is subscribed per Page by the connector (reconnect the Page once if it was connected before this release).
- **Live mode:** webhooks for people without a role on the app need Advanced Access to `instagram_manage_comments` / `pages_read_user_content` (App Review). In Development mode only app-role users' events arrive, which is enough for the live test.
- **Google Business Profile:** see section 6 (approval, ~14 days, 60-day-old verified profile, website).

## 4. Where the docs contradict earlier docs

1. `SOCIAL_META_FACEBOOK.md` / `SOCIAL_FACEBOOK` Step 8 subscribed Pages to `feed,messages,mention,ratings` and the connector parsed `ratings` into REVIEW items. **`ratings` webhooks are gone since v22.0** (the app runs v25.0). `ratings` is dropped from the subscription list; the old parser stays harmlessly in place.
2. `SOCIAL_INBOX.md` says the Meta connector would map "`mentions`, `ratings`". Mentions are now implemented (ID → fetch); ratings cannot be.
3. `SOCIAL_INSTAGRAM.md` lists `mentions` as "exists, not used". It is now used and needs the dashboard subscription (section 3).
4. The Instagram-Login and Facebook-Login docs name different lookup edges and permission names for mentions (1.1); this release targets Facebook Login (the connector's login type).

## 5. How it works

- **One pipeline.** Mentions and reviews are inbox conversations of type `MENTION` / `REVIEW`: webhook (signature verified, fails closed) or the polling fallback → idempotent ingest (unique `(account, providerMessageId)`) → prefilter → AI triage → routing rules → human work. Nothing new to learn for the team, and the SLA, assignment, notes, CRM hand-off (`Create lead`), audit and the **180-day retention purge** apply unchanged. The Inbox list hides mentions/reviews by default (they have their own pages); `?type=MENTION` still shows them.
- **Instagram `mentions` webhook** carries ids only: the pipeline calls `mentioned_comment` / `mentioned_media` with the account's stored token (read-only) and stores the text and author. If Meta refuses, the item is still stored with a clear placeholder so it is not lost.
- **Facebook:** visitor posts arrive through the `feed` webhook (post by someone other than the Page). The `mention` field is accepted defensively (payload undocumented, §1.2).
- **Polling fallback (flag `SOCIAL_LISTENING_POLLING=true`, default off).** Lists only what the networks list: Instagram `/{ig}/tags` and Facebook `/{page}/tagged` + visitor posts from `/{page}/feed`. At most one poll per account every 4 minutes, 30 minutes after an error. Caption/comment @mentions on Instagram are webhook-only.
- **Crisis flag (deterministic, no AI).** At ingest, whole-word match against a built-in list (legal threats, safety, fraud/security claims, public outrage: `scam`, `lawsuit`, `unsafe`, …). A match sets priority URGENT, `needsHuman`, the `crisis` tag and raises an alert immediately, even when the AI provider is down. Add workspace words with an inbox rule (keyword → URGENT).
- **AI triage** (existing triage service): intent, sentiment, priority (urgency), language, category (shown as *topic*). A negative sentiment or a complaint raises an alert after triage (once; not again for items already crisis-flagged).
- **Alerts (existing bell).** Everyone who can work the inbox (`social.reply`) gets one notification; further alerts within **15 minutes** update that notification in place ("4 items need attention"), mark it unread again, and never create a second row. Notifications carry at most a 40-character redacted preview.
- **Replies.** A person writes or edits a draft and presses Send; the inbox sender checks the kill switch, account state, guardrails, per-account rate limit and an atomic claim, and audits it (ids and lengths, never text). Where the network cannot be written to (photo tags, mentions on other people's timelines, all reviews today) the UI shows **Reply on the platform** with a deep link and creates nothing. **Auto-reply can never send a mention or a review**, whatever the workspace setting; with *auto-draft* on, a draft is prepared and waits for a person. (Replies are human-sent and audited like every inbox reply; they do not go through the *post* approvals queue.)
- **Ratings.** The daily job records one row per account per UTC day in `social_review_snapshots` (average rating, review count; append-only; NULL with the reason when the network gives nothing, never 0). Facebook is read from the Page fields `overall_star_rating` / `rating_count` **[ ]**; the live result is in section 8.
- **Kill switch.** `SOCIAL_LISTENING_DISABLED=true` stops mention webhooks being stored, polling and snapshots. Sending stays governed by the publishing kill switches.

## 6. Google Business Profile (not built) — steps to get access

1. A **verified** Business Profile that has been active for **60+ days**, plus a website for the business.
2. In Google Cloud create a project, enable *My Business Account Management*, *Business Information* and (v4) reviews, and note the **project number**.
3. Submit the *GBP API access request form* (Application for Basic API Access) with that project number. Review takes about **14 days**; approval is per project. Check *IAM & Admin → Quotas*: **0 QPM = not approved**, 300 QPM = approved.
4. Create an OAuth client; scope `https://www.googleapis.com/auth/business.manage`; the person who connects must manage the location.
5. Then implement `googleBusinessProvider` (today a stub that fails closed): `accounts.locations.reviews.list` (≤50 per page) into `REVIEW` events, `reviews.updateReply` for replies (the `replyCapability` becomes `api`), average rating + count into `fetchReviewSummary`. The Listening/Reviews UI, triage, alerts and permissions need no change.

## 7. Setup, permissions and limits

- **Meta app dashboard (your action):** *Webhooks → Instagram → subscribe `mentions`*. Reconnect the Facebook Page once if it was connected before this release so the Page subscription is `feed,messages,mention`.
- **Env vars (names only):** `SOCIAL_LISTENING_POLLING` (default false), `SOCIAL_LISTENING_DISABLED` (default false). No new Meta permission.
- **New permissions and the exact role mapping** (migration `20261018090000_social_listening`; derived in SQL from the inbox permissions, so nothing is wider than the inbox):

  | Permission | Meaning | Granted to (same roles as) |
  |---|---|---|
  | `social.listening.read` | read the Listening and Reviews pages | every role with `social.read`: **SUPER_ADMIN, ADMIN, MANAGER, VIEWER** |
  | `social.reviews.respond` | draft and send replies to reviews | every role with `social.reply`: **SUPER_ADMIN, ADMIN** |

  Never CLIENT_PORTAL. Working a mention (assign, status, lead, reply) uses `social.reply` as in the inbox; replying to a **review** additionally needs `social.reviews.respond` on both the Reviews and the Inbox endpoints.
- **Limits:** Instagram mention webhooks only for media of public accounts, no Stories; no replies to photo tags; Facebook `tagged` returns public posts only and visitor posts need the new-Pages-compatible `feed` webhook; retention 180 days (inbox setting); alert grouping 15 minutes; polling 25 items per edge per poll.

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| No Instagram mentions arrive | The `mentions` webhook field is not subscribed in the Meta app; or the media belongs to a private account / is a Story; or (Development mode) the mentioning user has no role on the app. |
| Mention shows "its content could not be loaded" | Meta refused the lookup (permission, deleted media). The permalink may still work; open it on Instagram. |
| Facebook visitor posts missing | Page not subscribed to `feed`: reconnect the Page. Posts made by the Page itself are never mentions. |
| Reviews page says "No review feed" | Expected: Facebook removed reviews/recommendations from the API in v22.0; Google needs approval (§6). |
| "Reply on the platform" | The network gives apps no write access there (§2). Use the deep link. |
| Too many alerts | They are grouped per 15 minutes; add inbox rules to tag/route noise; crisis words are fixed in code. |
| Nothing is polled | `SOCIAL_LISTENING_POLLING` is false (default) or `SOCIAL_LISTENING_DISABLED` is true. |
