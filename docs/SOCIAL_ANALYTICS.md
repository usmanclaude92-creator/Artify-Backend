# Social Analytics & Audience (Step 9b)

Code: `server/services/social/analytics/*`, connectors' `fetchInsights`, routes under `/api/v1/social/analytics`, pages *Social Media → Analytics / Audience*, Social Overview.

## 1. Facts this feature relies on (and where they come from)

> **How these were verified.** `developers.facebook.com` and `learn.microsoft.com` cannot be fetched from the build environment (egress proxy). Everything below comes from excerpts of the official pages returned by a domain-restricted search, several of them from old page revisions. Items marked **[ ]** could NOT be confirmed from any current excerpt. The ingestion code is therefore written to **discover** support instead of assuming it: each metric is requested on its own, and a metric the API rejects, deprecates or returns empty is stored as `UNAVAILABLE` (a null value plus the reason), never as 0. The live test (section 8) records what Meta really returned.

### 1.1 Facebook Page Insights

| Topic | Fact | Doc |
|---|---|---|
| Permissions | `read_insights` **and** `pages_read_engagement`, plus a **Page access token** of a person who can perform the *analyze* task on the Page. `read_insights` depends on `pages_read_engagement` and `pages_show_list`. Without it the API returns a permission error. | [Page Insights guide](https://developers.facebook.com/docs/platforminsights/page/), [read_insights reference](https://developers.facebook.com/docs/permissions/reference/read_insights/) |
| Impressions / fans removed | `impressions` and `page fans` metrics were announced for removal on **15 Nov 2025**; `views` replaces `impressions` on all API versions. After removal the API answers with an *invalid metric* error. | [Page Insights API updates (Aug 2025)](https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/) |
| Further removal | "A number of Page Insights metrics" are to be deprecated for all versions by **15 Jun 2026** (already past). The excerpts do not name them. **[ ]** | [Page/insights reference](https://developers.facebook.com/docs/graph-api/reference/insights/) |
| Metrics listed | `page_media_view` (plays/displays of content; periods day/week/days_28; breakdowns `is_from_ads`, `is_from_followers`), `page_total_media_view_unique` (unique viewers, day/week/days_28), `page_post_engagements` (day/week/days_28), `page_follows` (follower count = follows − unfollows, lifetime, **day** period), `page_daily_follows_unique`, `page_daily_unfollows_unique` (estimated; day/week/days_28). | [Page/insights reference](https://developers.facebook.com/docs/graph-api/reference/insights/) |
| Periods | `day`, `week` (rolling 7 days), `days_28`, `month`, `lifetime`. | [Getting started with Page Insights](https://developers.facebook.com/blog/post/2022/11/08/getting-started-with-page-insights-api/) |
| Range limit | With `since`/`until`, at most **90 days** per request; the `since` day is included in the first value. | Page/insights reference |
| Retention | Public Pages: **2 years**. Unpublished Pages: 5 days. Most metrics refresh every 24 h. | [Pages API insights](https://developers.facebook.com/docs/platforminsights/page/) |
| Rate limits | Calls with a Page token use Business Use Case limits: `4800 × engaged users` per rolling 24 h; usage reported in `X-Business-Use-Case-Usage` (`call_count`, `estimated_time_to_regain_access`). | [Rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/) |
| Plain fields (no Insights permission) | Follower/fan totals and post reaction/comment/share counts are ordinary Page/Post fields (`followers_count`, `fan_count`, `reactions.summary`, `comments.summary`, `shares`). **[ ]** current field list not re-confirmed. | Pages API |
| Page demographics | **[ ]** Page audience demographics were not confirmed in any current excerpt; this release does **not** ingest Facebook demographics and says so in the UI. | — |

### 1.2 Instagram Insights (Instagram API with Facebook Login)

| Topic | Fact | Doc |
|---|---|---|
| Permissions | `instagram_basic`, **`instagram_manage_insights`**, `pages_read_engagement` (plus `ads_management`/`ads_read` if the user's role on the Page comes through Business Manager **[ ]**). `instagram_manage_insights` **requires App Review** for accounts you don't own; Standard access covers accounts you own/manage and added to the app. | [Instagram Platform insights](https://developers.facebook.com/docs/instagram-platform/insights/), [Permissions reference](https://developers.facebook.com/documentation/development/permissions) |
| Deprecated | v22.0: `impressions` (media + user), `plays`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count` (media) are deprecated; **`views`** is the new metric on media and user insights. All versions from **21 Apr 2025** return an error for `impressions` on media created after 2 Jul 2024. | [v22.0 changelog](https://developers.facebook.com/docs/graph-api/changelog/version22.0/) |
| Account metrics | `reach` (periods day/week/days_28), `profile_views`, `website_clicks`, `follower_count` (**new followers per day**, not the total; only the last **30 days** are available), tap metrics (`email_contacts`, `phone_call_clicks`, `get_directions_clicks`, `text_message_clicks`). Total followers is the IG User **field** `followers_count`. | [Instagram Platform insights](https://developers.facebook.com/docs/instagram-platform/insights/) |
| Newer names | `accounts_engaged`, `total_interactions`, `follows_and_unfollows`, `profile_links_taps`, the `metric_type=total_value` request mode and `timeframe` options could not be confirmed from any excerpt. **[ ]** They are requested defensively (see 3.2) and recorded as `UNAVAILABLE` when rejected. | — |
| Media metrics | `reach`, `views` (replaces `impressions`/`plays`), likes/comments/shares/saves, `total_interactions`. Likes/comments counts are also plain media fields (`like_count`, `comments_count`). **[ ]** exact per-media-type availability. | IG Media reference, v22.0 changelog |
| Demographics | Older names (`audience_city`, `audience_country`, `audience_gender_age`, `audience_locale`) are **lifetime** metrics without today's data. Current names (`follower_demographics`, `engaged_audience_demographics`, `reached_audience_demographics`, `breakdown`, `timeframe`) **[ ]** not confirmed. | Instagram Platform insights |
| Minimum followers | "Some metrics are not available on accounts with **fewer than 100 followers**." Which ones is not stated; demographics are the usual case. | Instagram Platform insights |
| Empty data | If the data does not exist or is unavailable the API returns an **empty data set, not 0**. | Instagram Platform insights |
| Retention / range | User metrics are stored for up to **90 days**; without `since`/`until` the default is yesterday→today; insights for **one user per request**. | Instagram Platform insights |
| Rate limits | Business Use Case: `4800 × impressions` per rolling 24 h (all insights endpoints). | [Rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/) |

### 1.3 LinkedIn (what a member account can read)

| Topic | Fact | Doc |
|---|---|---|
| Member post analytics | Permission **`r_member_postAnalytics`**, endpoint `memberCreatorPostAnalytics` (single post `q=entity`, all posts `q=me`), **API version ≥ 202506**, included in the **Community Management API** and needs extra member consent. Query types: `IMPRESSION`, `MEMBERS_REACHED`, `REACTION`, `COMMENT`, `RESHARE`. `DAILY` aggregation is not supported for `MEMBERS_REACHED`, `LINK_CLICKS`, follower/profile-view-from-content, and per-post daily impressions are not supported. | [Member Post Statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics) |
| Member profile analytics | `r_member_profileAnalytics` (profile viewers, followers, search appearances), versions ≥ 202504, Community Management API. | [Member Follower Statistics](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/follower-statistics) |
| Organization data | `r_organization_social` (posts/engagement) needs an ADMINISTRATOR/CONTENT_ADMIN-type page role; organization follower/visitor statistics need `r_organization_admin`. | [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) |
| Access | Closed or restricted permissions (`r_member_social` is closed). Permissions are granted only after API access approval. | [Getting access](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access) |
| Versions | Marketing versions are sunset about a year after release (a result states 202510 is sunset on 15 Oct 2026). | [Recent changes](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/recent-changes) |

**Decision:** a LinkedIn member account connected through the standard sign-in can read **no analytics**. This release makes **no LinkedIn insights calls** and shows "Not available: needs Community Management API access (`r_member_postAnalytics`)" instead of empty charts. LinkedIn is not configured in production today.

## 2. Where the docs contradict earlier docs / assumptions

1. **`social.analytics.read` is not new.** `SOCIAL_FOUNDATION.md` (Step 4) already created it and granted it to **SUPER_ADMIN and ADMIN only**. MANAGER and VIEWER can read the Social module but not analytics. Step 9b adds a migration granting it to every role that holds `social.read` (excluding CLIENT_PORTAL), as requested; this *widens it from admin-only to all Social-module readers*.
2. **Two new Meta permissions are required**, contradicting the "no new Meta permissions" stance of Steps 8/9a: `read_insights` (Pages) and `instagram_manage_insights` (Instagram). Neither is in the current login scopes (`SOCIAL_META_FACEBOOK.md`, `SOCIAL_INSTAGRAM.md`). They are added **only when `SOCIAL_ANALYTICS_SCOPES=true`** so nothing changes until the owner has enabled them in the Meta dashboard.
3. **Metric names in older Meta material are deprecated** (`impressions`, `page fans`, `plays`); `views` is the replacement. This release never stores a metric called impressions.
4. **`SOCIAL_FOUNDATION.md` says the daily job runs in the daily cron tick.** In production the tick is pinged every 5 minutes; analytics is self-gated to once per account per UTC day.
5. **The Social Overview placeholder text** ("analytics arrive in later phases") is obsolete and was replaced.
6. **LinkedIn default API version 202504** (`SOCIAL_PUBLISHING.md`) predates the 202506 version needed for post analytics and is probably past its support window. Not changed here; set `LINKEDIN_API_VERSION` when LinkedIn is configured. **[ ]**

## 3. How it works

- **Job.** `analyticsIngest.tick()` runs inside `/api/v1/automation/internal/tick` (pg_cron pings it every 5 minutes with `CRON_SECRET`). Each connected, analytics-capable account is processed **once per UTC day**, at most 2 accounts per tick, within a 10 s budget (Vercel `maxDuration` is 30 s). Work that does not fit resumes on the next tick.
- **Kill switches.** Env `SOCIAL_ANALYTICS_DISABLED=true`, or the publishing global / workspace kill switch, stops the job. Nothing else is affected.
- **Read-only.** Only `GET` calls to Meta. No LinkedIn calls.
- **Tables** (append-only, never overwritten): `social_account_metrics` (one row per account, UTC day, metric), `social_post_metrics` (one row per post target, capture day, metric), `social_audience_snapshots` (per account, capture day, dimension), `social_analytics_state` (per-account run state and discovered capabilities). Uniqueness makes every run idempotent. A stored number is never replaced; a stored NULL may be upgraded by a later real number.
- **Honesty rules.** Missing, rejected or deprecated metrics are stored as `NULL` with a status (`UNAVAILABLE`) and a reason, never `0`. Only completed UTC days are stored (yesterday only after 06:00 UTC, because most Meta metrics refresh daily). Period totals add only days that have data and show the coverage ("20 of 28 days have data"); a percentage change is shown only when both periods are fully covered. Net follower change needs two real snapshots. Best posting times need at least 10 published posts with numbers (at least 2 per slot) and show sample sizes.
- **Backfill.** On first sync the job requests as much history as the network allows: Facebook up to 90 days, Instagram up to 30 days for account metrics. The UI states the real limit and the first day that has data. Instagram follower *totals* cannot be backfilled (Meta only exposes the current total), so the follower line starts on the first run.
- **Re-check.** Metrics marked `UNAVAILABLE` are retried once a week in case Meta enabled them, and at once after the account is reconnected (the account row changed since the check). After an error the account backs off 3 hours.

## 4. Setup

1. In the Meta app dashboard (*Use cases → Permissions and features*) add **`read_insights`** (Facebook Pages) and **`instagram_manage_insights`** (Instagram). For accounts you own or manage and have added to the app these work with Standard access; App Review is only needed for other people's accounts.
2. In Vercel set `SOCIAL_ANALYTICS_SCOPES=true` and redeploy. Login dialogs then ask for the two permissions.
3. In *Social Media → Accounts* reconnect each Facebook Page / Instagram account once so the stored token includes them. Until then the UI says "reconnect to grant analytics access" and shows no numbers.
4. Apply migration `20261016090000_social_analytics` (adds the four tables and grants `social.analytics.read` to roles with `social.read`, except CLIENT_PORTAL).

| Env var | Default | Meaning |
|---|---|---|
| `SOCIAL_ANALYTICS_SCOPES` | `false` | Adds the two insights permissions to the Meta login. |
| `SOCIAL_ANALYTICS_DISABLED` | `false` | Stops the daily snapshot job. |

Permission `social.analytics.read` gates every analytics route, page, the CSV export and the Overview performance card. "Refresh now" additionally needs `social.accounts.manage`.

## 5. Metrics glossary

| Metric | Meaning | Notes |
|---|---|---|
| Followers | Total followers/fans at the end of the day | A level, never summed. Net change = last minus first stored snapshot. |
| New follows / Unfollows | Daily gained / lost | Where Meta provides them. |
| Reach | Unique accounts that saw content | Periods are not additive across days (a day-sum is not unique reach); the UI labels it as a sum of daily reach. |
| Views | Times content was played or displayed | Replaces the deprecated *impressions*/*plays*. |
| Engagement | Reactions, comments, shares, saves etc. | Name differs by network. |
| Profile views, Link clicks | Where the network provides them | Often missing on Pages; shown as "—" with the reason. |
| Post metrics | Reach, views, likes, comments, shares, saves, interactions | Only posts published through Control Center. |

## 6. Limits

- Instagram: account metrics ≈ last 30 days; demographics usually need 100+ followers; one request per account.
- Facebook: ≤ 90 days per request, 2 years retention, most metrics refresh daily.
- Rate limits are Business Use Case based; the job makes a small, fixed number of calls per account per day and backs off on transient errors.
- LinkedIn: no analytics for member accounts (needs Community Management API).
- Posts made outside Control Center are not included.

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Reconnect to grant analytics access" | Token lacks the insights permission: do setup steps 1–3. |
| A metric shows "—" with "Meta rejected the request" | Meta no longer offers that metric for this account. Expected; not an error. |
| Demographics "Not available yet" | Fewer than 100 followers, or Meta returned nothing. |
| No data for yesterday | The job stores yesterday only after 06:00 UTC. |
| Nothing updates | Check `SOCIAL_ANALYTICS_DISABLED`, the kill switch, `social_analytics_state.lastError`, and that pg_cron pings the tick. |

## 8. Live test (8 Oct 2026, production) and unverified items

Confirmed against the live Graph API (v25.0) with the connected Page "Artify Solutions" and @artifysols:

- **Facebook Page.** All six daily metrics returned data for 90 days (10 Jul – 7 Oct): `page_media_view` (views), `page_total_media_view_unique` (reach), `page_post_engagements`, `page_daily_follows_unique`, `page_daily_unfollows_unique`, `page_views_total` (profile views). 540 rows, none null. Link clicks is not offered for Pages and shows "—". Demographics for Pages are not ingested.
- **Before `read_insights` was granted**, Meta answered the Page insights calls with an *empty set* instead of a permission error. The job stored them as UNAVAILABLE ("returned no data"). The job now re-checks cached UNAVAILABLE metrics as soon as the account is reconnected.
- **Instagram.** `views`, `reach`, `total_interactions` (engagement), `profile_views` and `website_clicks` returned 30 days of daily values (some via the per-day `metric_type=total_value` fallback); `follower_count` (new followers) was refused and is shown as unavailable. Demographics are refused below 100 followers; the UI says so with the account's follower count.
- **Instagram per-day fallback** costs one request per day; requests run 6 at a time so a metric fits the job budget. A full first sync of one Instagram account needs about three job runs (about 15 minutes); a "Refresh now" click can time out in the browser while the server continues.

Not verified live: per-post metrics (no posts have been published through Control Center, and production publishing is dry-run), demographics with 100+ followers, rate-limit behaviour, the AI summary (no analytics numbers worth summarising yet), LinkedIn, whether `end_time` maps to the UTC day before it (the **[ ]** in section 1), and the June 2026 Page metric removals beyond the six names above.
