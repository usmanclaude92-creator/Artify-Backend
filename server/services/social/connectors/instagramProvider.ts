/**
 * Instagram connector (provider key "meta_instagram"): Instagram API with Facebook Login, for Business/Creator accounts linked to a Facebook Page.
 * Facts and doc URLs: docs/SOCIAL_INSTAGRAM.md (top). Shared Graph plumbing: metaGraph.ts (same transport, signature check, error taxonomy as Facebook).
 *
 *  - Connect: the same Facebook Login code flow as meta_facebook (different scopes). `/me/accounts` lists Pages with `instagram_business_account`;
 *    the person picks which Instagram account to connect. The Page access token (non-expiring) is what we store, encrypted, one vault entry per account.
 *  - Publish (at-most-once): container → status poll → media_publish. Only `media_publish` is the commit point. Progress is persisted in the target's
 *    provider state between attempts. A container that is still processing is a "pending" outcome (no attempt consumed, no failure). If media_publish
 *    is sent and no definite answer arrives, the target becomes UNCERTAIN and is never retried by the platform.
 *  - Inbox: webhooks (object "instagram": comments; messaging events for DMs) verified with X-Hub-Signature-256; polling fallback via the media
 *    comments edge and the Conversations API (platform=instagram). Replies: comment reply, hide comment, DM `RESPONSE` only inside 24 hours. No message tags.
 *  - Thread ids: comments → `c:<root comment id>`; DMs → `dm:<IGSID>`.
 */
import { config } from "../../../config/env";
import { redactSecrets, type SocialTokenSet } from "../tokenVault";
import { SocialPublishError } from "../publishing/publishErrors";
import { MESSAGING_WINDOW_MS, dialogUrl, graph, verifySignature, webhookChallenge } from "./metaGraph";
import { instagramAnalytics } from "./instagramInsights";
import {
  ConnectorUserError, DEFAULT_CONSTRAINTS, type ConnectResult, type HealthResult, type InboundEvent, type PublishInput, type PublishMedia, type PublishResult, type ReplyWindow,
  type SelectableAccount, type SendReplyInput, type SendReplyResult, type SocialConnector, type SocialConstraints, type SocialProfile,
} from "./types";

export const DEFAULT_INSTAGRAM_SCOPES = ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_messages", "pages_show_list", "pages_read_engagement", "business_management"] as const;
/** Insights need `instagram_manage_insights` (docs/SOCIAL_ANALYTICS.md §1.2). Added only when SOCIAL_ANALYTICS_SCOPES=true. */
export const INSIGHTS_SCOPE = "instagram_manage_insights";
export const instagramScopes = (): string[] => {
  const base = config.metaInstagramLoginScopes ? config.metaInstagramLoginScopes.split(",") : [...DEFAULT_INSTAGRAM_SCOPES];
  return config.socialAnalyticsScopes && !base.includes(INSIGHTS_SCOPE) ? [...base, INSIGHTS_SCOPE] : base;
};
/** Without these the connector cannot publish or moderate. instagram_manage_messages is optional (DMs only). */
export const REQUIRED_SCOPES = ["instagram_basic", "instagram_content_publish", "instagram_manage_comments"] as const;
export const WEBHOOK_OBJECT = "instagram";
export const WEBHOOK_FIELDS = ["comments", "messages", "mentions"] as const;

const CAPTION_LIMIT = 2200;
const DM_BYTE_LIMIT = 1000;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const CAROUSEL_MAX = 10;
const POLL_INTERVAL_MS = 60_000; // Meta: poll the container no more than once per minute
const IMAGE_PROCESSING_DEADLINE_MS = 10 * 60_000;
const VIDEO_PROCESSING_DEADLINE_MS = 30 * 60_000;

export const instagramConstraints = (): SocialConstraints => ({
  ...DEFAULT_CONSTRAINTS,
  maxChars: CAPTION_LIMIT, maxHashtags: 30, maxMedia: CAROUSEL_MAX, requiresMedia: true, supportsLink: false,
  // JPEG only: the API documents JPEG for feed images. Reels (video) need a video library that does not exist yet, so they are not offered.
  allowedMediaTypes: ["image/jpeg"],
  mediaLimits: { imageMaxBytes: IMAGE_MAX_BYTES, imageMinWidth: 320, imageMinRatio: 0.8, imageMaxRatio: 1.91 },
  notes: [
    "Instagram needs at least one image: text-only posts are rejected.",
    "JPEG only, up to 8 MB each. Aspect ratio between 4:5 and 1.91:1, at least 320 px wide.",
    "Up to 10 images make a carousel (swipe post). The caption can be up to 2,200 characters and 30 hashtags.",
    "Links in captions are not clickable. Reels (video) are not supported yet.",
  ],
});

const pageIdOf = (tokens: SocialTokenSet) => String((tokens.pageId as string | undefined) ?? "");
const epochToIso = (v: unknown) => (typeof v === "number" ? new Date(v * (v < 1e12 ? 1000 : 1)).toISOString() : typeof v === "string" ? v : undefined);

export const instagramReplyWindow = (lastInboundAt: Date | null, now: Date): ReplyWindow => {
  if (!lastInboundAt) return { open: false, closesAt: null, reason: "There is no message from this person to reply to." };
  const closesAt = new Date(lastInboundAt.getTime() + MESSAGING_WINDOW_MS);
  return now.getTime() <= closesAt.getTime()
    ? { open: true, closesAt }
    : { open: false, closesAt, reason: "Instagram only allows replying to a message within 24 hours of the person's last message. The window closed, so this reply can't be sent from here." };
};

// ---------------- webhook parsing ----------------
interface IgWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
    messaging?: Array<{ sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] } }>;
  }>;
}

/** Normalises an Instagram webhook delivery. Unknown shapes are skipped, never thrown on. The account's own comments and echoes are ignored. */
export function parseWebhookPayload(payload: IgWebhookPayload): InboundEvent[] {
  if (payload.object !== WEBHOOK_OBJECT) return [];
  const out: InboundEvent[] = [];
  for (const entry of payload.entry ?? []) {
    const igId = entry.id;
    if (!igId) continue;
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (change.field === "mentions") {
        // The payload only carries ids; the pipeline fetches the content through `resolveMention`.
        const mediaId = typeof v.media_id === "string" ? v.media_id : undefined;
        const mentionCommentId = typeof v.comment_id === "string" ? v.comment_id : undefined;
        if (!mediaId && !mentionCommentId) continue;
        const id = (mentionCommentId ?? mediaId)!;
        out.push({
          type: "MENTION", accountExternalId: igId, providerThreadId: mentionCommentId ? `mc:${mentionCommentId}` : `mm:${mediaId}`, providerMessageId: id,
          participant: {}, text: "", subjectRef: mediaId, createdAt: epochToIso(entry.time), lookup: { kind: mentionCommentId ? "ig_comment" : "ig_media", id },
        });
        continue;
      }
      if (change.field !== "comments") continue;
      const commentId = v.id as string | undefined;
      const from = v.from as { id?: string; username?: string } | undefined;
      const media = v.media as { id?: string } | undefined;
      const text = typeof v.text === "string" ? v.text : "";
      if (!commentId || !from?.id || from.id === igId) continue;
      const parent = v.parent_id as string | undefined; // present on replies: they stay in the parent comment's thread
      out.push({
        type: "COMMENT", accountExternalId: igId, providerThreadId: `c:${parent ?? commentId}`, providerMessageId: commentId,
        participant: { externalId: from.id, handle: from.username, name: from.username }, text: text || "[comment without text]", subjectRef: media?.id, createdAt: epochToIso(entry.time),
      });
    }
    for (const m of entry.messaging ?? []) {
      const igsid = m.sender?.id;
      if (!m.message?.mid || !igsid || igsid === igId || m.message.is_echo) continue;
      const text = m.message.text ?? (m.message.attachments?.length ? "[attachment]" : "");
      if (!text) continue;
      out.push({ type: "DM", accountExternalId: igId, providerThreadId: `dm:${igsid}`, providerMessageId: m.message.mid, participant: { externalId: igsid }, text, createdAt: epochToIso(m.timestamp) });
    }
  }
  return out;
}

// ---------------- publish state machine ----------------
interface PublishState {
  phase: "container" | "publishing";
  containerId: string;
  kind: "image" | "carousel" | "reel";
  createdAt: number;
}

const readState = (raw: PublishInput["state"]): PublishState | null => {
  if (!raw || typeof raw.containerId !== "string" || (raw.phase !== "container" && raw.phase !== "publishing")) return null;
  return { phase: raw.phase, containerId: raw.containerId, kind: (raw.kind as PublishState["kind"]) ?? "image", createdAt: Number(raw.createdAt) || Date.now() };
};

/** Creating a container is not a commit: nothing is visible on Instagram until media_publish. So an unanswered create can safely be retried. */
const asSafeRetry = (err: unknown): never => {
  if (err instanceof SocialPublishError && err.kind === "uncertain") throw new SocialPublishError("transient", "No answer from Instagram while preparing the media; will try again.");
  throw err;
};

async function mediaUrl(m: PublishMedia): Promise<string> {
  if (!m.signedUrl) throw new SocialPublishError("permanent", "This media file cannot be shared by URL.");
  return m.signedUrl().catch(() => { throw new SocialPublishError("transient", "Could not prepare the media file for Instagram."); });
}

function validateMedia(input: PublishInput): "image" | "carousel" | "reel" {
  if (input.media.length === 0) throw new SocialPublishError("permanent", "Instagram requires an image: a text-only post can't be published.");
  if (input.text.length > CAPTION_LIMIT) throw new SocialPublishError("permanent", `Instagram captions are limited to ${CAPTION_LIMIT} characters.`);
  const videos = input.media.filter((m) => m.mimeType.startsWith("video/"));
  if (videos.length > 0) {
    if (input.media.length > 1) throw new SocialPublishError("permanent", "A reel is a single video; it can't be combined with other media.");
    return "reel";
  }
  if (input.media.length > CAROUSEL_MAX) throw new SocialPublishError("permanent", `A carousel has at most ${CAROUSEL_MAX} images.`);
  for (const m of input.media) {
    if (m.mimeType !== "image/jpeg") throw new SocialPublishError("permanent", "Instagram feed images must be JPEG.");
    if (m.sizeBytes && m.sizeBytes > IMAGE_MAX_BYTES) throw new SocialPublishError("permanent", "Instagram images must be 8 MB or smaller.");
  }
  return input.media.length > 1 ? "carousel" : "image";
}

async function createContainer(token: string, ig: string, input: PublishInput, kind: PublishState["kind"]): Promise<string> {
  const caption = input.text;
  try {
    if (kind === "image") {
      const m = input.media[0]!;
      const r = await graph<{ id?: string }>({ method: "POST", path: `/${ig}/media`, token, phase: "write", body: { image_url: await mediaUrl(m), caption, ...(m.altText ? { alt_text: m.altText.slice(0, 1000) } : {}) } });
      if (!r.json.id) throw new SocialPublishError("transient", "Instagram did not return a container id.");
      return r.json.id;
    }
    if (kind === "reel") {
      const m = input.media[0]!;
      const r = await graph<{ id?: string }>({ method: "POST", path: `/${ig}/media`, token, phase: "write", body: { media_type: "REELS", video_url: await mediaUrl(m), caption, share_to_feed: true } });
      if (!r.json.id) throw new SocialPublishError("transient", "Instagram did not return a container id.");
      return r.json.id;
    }
    const children: string[] = [];
    for (const m of input.media) {
      const c = await graph<{ id?: string }>({ method: "POST", path: `/${ig}/media`, token, phase: "write", body: { image_url: await mediaUrl(m), is_carousel_item: true, ...(m.altText ? { alt_text: m.altText.slice(0, 1000) } : {}) } });
      if (!c.json.id) throw new SocialPublishError("transient", "Instagram did not return a container id.");
      children.push(c.json.id);
    }
    const parent = await graph<{ id?: string }>({ method: "POST", path: `/${ig}/media`, token, phase: "write", body: { media_type: "CAROUSEL", children: children.join(","), caption } });
    if (!parent.json.id) throw new SocialPublishError("transient", "Instagram did not return a container id.");
    return parent.json.id;
  } catch (err) {
    return asSafeRetry(err);
  }
}

/** Best effort: the documented `content_publishing_limit` edge. Its exact response shape is unverified for this API, so any surprise is ignored. */
async function liveQuotaExhausted(token: string, ig: string): Promise<{ used: number; total: number } | null> {
  try {
    const r = await graph<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>({ method: "GET", path: `/${ig}/content_publishing_limit`, token, phase: "read", query: { fields: "quota_usage,config" } });
    const row = r.json.data?.[0];
    const used = row?.quota_usage;
    const total = row?.config?.quota_total;
    if (typeof used === "number" && typeof total === "number" && total > 0 && used >= total) return { used, total };
  } catch { /* ignore */ }
  return null;
}

// ---------------- connector ----------------
type IgRow = { id: string; username?: string; name?: string; profile_picture_url?: string };
type PageRow = { id: string; name?: string; access_token?: string; tasks?: string[]; instagram_business_account?: IgRow; connected_instagram_account?: IgRow };

async function listPagesWithInstagram(userToken: string): Promise<PageRow[]> {
  const pages: PageRow[] = [];
  let after: string | undefined;
  for (let i = 0; i < 5; i++) {
    const r = await graph<{ data?: PageRow[]; paging?: { cursors?: { after?: string }; next?: string } }>({
      method: "GET", path: "/me/accounts", token: userToken, phase: "read",
      query: { fields: "id,name,access_token,tasks,instagram_business_account{id,username,name,profile_picture_url},connected_instagram_account{id,username,name,profile_picture_url}", limit: "100", after },
    });
    pages.push(...(r.json.data ?? []));
    after = r.json.paging?.next ? r.json.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return pages;
}

export const instagramProvider: SocialConnector = {
  key: "meta_instagram",
  label: "Instagram",
  implemented: true,
  analytics: instagramAnalytics,
  get defaultScopes() { return instagramScopes(); },
  get dailyPublishCap() { return config.instagramDailyPublishLimit; },
  isConfigured: () => !!config.metaAppId && !!config.metaAppSecret,
  get pollsInbox() { return config.metaInboxPolling; },
  getConstraints: () => instagramConstraints(),

  getAuthUrl({ state, redirectUri, scopes }) {
    const q = new URLSearchParams({ client_id: config.metaAppId, redirect_uri: redirectUri, state, response_type: "code", scope: (scopes?.length ? scopes : instagramScopes()).join(",") });
    return `${dialogUrl()}?${q.toString()}`;
  },

  async handleCallback({ code, redirectUri }): Promise<ConnectResult> {
    const short = await graph<{ access_token?: string }>({ method: "GET", path: "/oauth/access_token", phase: "read", query: { client_id: config.metaAppId, redirect_uri: redirectUri, client_secret: config.metaAppSecret, code } });
    if (!short.json.access_token) throw new Error("Meta did not return an access token.");
    const long = await graph<{ access_token?: string }>({ method: "GET", path: "/oauth/access_token", phase: "read", query: { grant_type: "fb_exchange_token", client_id: config.metaAppId, client_secret: config.metaAppSecret, fb_exchange_token: short.json.access_token } });
    const userToken = long.json.access_token;
    if (!userToken) throw new Error("Meta did not return a long-lived token.");
    const [me, perms, pages] = await Promise.all([
      graph<{ id?: string; name?: string }>({ method: "GET", path: "/me", token: userToken, phase: "read", query: { fields: "id,name" } }),
      graph<{ data?: Array<{ permission: string; status: string }> }>({ method: "GET", path: "/me/permissions", token: userToken, phase: "read" }),
      listPagesWithInstagram(userToken),
    ]);
    const scopes = (perms.json.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
    if (pages.length === 0) throw new ConnectorUserError("This Facebook account does not manage any Pages. Instagram connects through a Facebook Page: link your Instagram professional account to a Page you manage, then try again.");
    const selectable: SelectableAccount[] = [];
    for (const p of pages) {
      const ig = p.instagram_business_account ?? p.connected_instagram_account;
      if (!ig?.id || !p.access_token) continue;
      const warnings: string[] = [];
      const missing = REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
      if (missing.length) warnings.push(`Permissions not granted: ${missing.join(", ")}. Reconnect and approve them.`);
      if (!scopes.includes("instagram_manage_messages")) warnings.push("Direct messages are unavailable (instagram_manage_messages was not granted).");
      if (p.tasks?.length && !p.tasks.includes("CREATE_CONTENT")) warnings.push("You can't publish for this Page's Instagram account (needs the Create content task on the linked Page).");
      selectable.push({
        profile: { externalAccountId: ig.id, displayName: ig.name ? `${ig.name} (@${ig.username ?? ig.id})` : `@${ig.username ?? ig.id}`, handle: ig.username ?? null, avatarUrl: ig.profile_picture_url ?? null, accountType: "BUSINESS" },
        tokens: { accessToken: p.access_token, pageId: p.id, igId: ig.id, scopes }, tasks: p.tasks, warnings: [...warnings, `Linked Facebook Page: ${p.name ?? p.id}.`],
      });
    }
    if (selectable.length === 0) {
      const seen = pages.map((p) => p.name ?? p.id).slice(0, 5).join(", ");
      const missingScopes = ["instagram_basic", "pages_show_list"].filter((x) => !scopes.includes(x));
      throw new ConnectorUserError(`Facebook shared ${pages.length} Page${pages.length === 1 ? "" : "s"} (${seen}) but no linked Instagram account.${missingScopes.length ? ` Permissions missing: ${missingScopes.join(", ")}.` : ""} Check that the Instagram account is a Business or Creator account linked to one of these Pages, and that on the Facebook screen you tapped "Edit settings" and selected both the Page and the Instagram account. Then try again.`);
    }
    return { profile: { externalAccountId: me.json.id ?? "user", displayName: me.json.name ?? "Facebook user", accountType: "USER" }, tokens: { accessToken: "" }, selectable };
  },

  async refreshToken(): Promise<SocialTokenSet> {
    throw new Error("The Page access token used for Instagram cannot be refreshed automatically; reconnect the account to renew access.");
  },

  async getProfile(tokens: SocialTokenSet): Promise<SocialProfile> {
    const id = String(tokens.igId ?? "");
    const target = id || "me";
    const r = await graph<{ id: string; username?: string; name?: string; profile_picture_url?: string }>({ method: "GET", path: `/${target}`, token: tokens.accessToken, phase: "read", query: { fields: "id,username,name,profile_picture_url" } });
    return { externalAccountId: r.json.id, displayName: r.json.name ? `${r.json.name} (@${r.json.username ?? r.json.id})` : `@${r.json.username ?? r.json.id}`, handle: r.json.username ?? null, avatarUrl: r.json.profile_picture_url ?? null, accountType: "BUSINESS" };
  },

  async healthCheck(tokens: SocialTokenSet): Promise<HealthResult> {
    const r = await graph<{ data?: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; error?: { message?: string } } }>({
      method: "GET", path: "/debug_token", token: `${config.metaAppId}|${config.metaAppSecret}`, phase: "read", query: { input_token: tokens.accessToken },
    });
    const d = r.json.data;
    if (!d?.is_valid) return { ok: false, error: redactSecrets(d?.error?.message ?? "The access token is no longer valid; reconnect the account.", [tokens.accessToken]).slice(0, 200) };
    const granted = new Set(d.scopes ?? []);
    const missing = REQUIRED_SCOPES.filter((s) => d.scopes && !granted.has(s));
    if (missing.length) return { ok: false, error: `Missing permissions: ${missing.join(", ")}. Reconnect the account and approve them.` };
    const times = [d.expires_at, d.data_access_expires_at].filter((t): t is number => typeof t === "number" && t > 0);
    return { ok: true, expiresAt: times.length ? new Date(Math.min(...times) * 1000).toISOString() : null };
  },

  async publish(tokens: SocialTokenSet, input: PublishInput): Promise<PublishResult> {
    const ig = input.accountExternalId;
    const token = tokens.accessToken;
    const saved = readState(input.state);

    // A previous attempt already sent media_publish and never learned the answer: the post may be live. Never send it again.
    if (saved?.phase === "publishing") throw new SocialPublishError("uncertain", "A previous attempt sent the publish request to Instagram but never recorded the answer; the post may be live.");

    const kind = saved?.kind ?? validateMedia(input);
    let state = saved;
    if (!state) {
      const quota = await liveQuotaExhausted(token, ig);
      if (quota) throw new SocialPublishError("permanent", `Instagram's publishing limit is reached for this account (${quota.used}/${quota.total} in the last 24 hours). Reschedule for later.`);
      const containerId = await createContainer(token, ig, input, kind);
      state = { phase: "container", containerId, kind, createdAt: Date.now() };
      await input.saveState?.({ ...state });
    }

    // Poll the container (Meta: at most once a minute; the publisher re-schedules while it is still processing).
    const st = await graph<{ status_code?: string; status?: string }>({ method: "GET", path: `/${state.containerId}`, token, phase: "read", query: { fields: "status_code,status" } });
    const code = st.json.status_code;
    if (code === "ERROR" || code === "EXPIRED") {
      await input.saveState?.(null);
      const detail = redactSecrets(st.json.status ?? "", [token]).replace(/\s+/g, " ").slice(0, 160);
      throw new SocialPublishError("permanent", code === "EXPIRED" ? "The Instagram media container expired before it was published (they last 24 hours). Retry to create a new one." : `Instagram could not process the media${detail ? `: ${detail}` : "."}`);
    }
    if (code !== "FINISHED" && code !== "PUBLISHED") {
      const deadline = state.kind === "reel" ? VIDEO_PROCESSING_DEADLINE_MS : IMAGE_PROCESSING_DEADLINE_MS;
      if (Date.now() - state.createdAt > deadline) {
        await input.saveState?.(null);
        throw new SocialPublishError("permanent", "Instagram is taking too long to process the media. Retry later.");
      }
      throw new SocialPublishError("transient", "Instagram is still processing the media.", { pending: true, retryAfterMs: POLL_INTERVAL_MS });
    }
    if (code === "PUBLISHED") throw new SocialPublishError("uncertain", "Instagram reports this container as already published; check the account.");

    // Commit point. Persist the intent FIRST so a crash after sending can never lead to a second media_publish.
    await input.saveState?.({ ...state, phase: "publishing" });
    let published: { id?: string };
    try {
      published = (await graph<{ id?: string }>({ method: "POST", path: `/${ig}/media_publish`, token, phase: "write", body: { creation_id: state.containerId } })).json;
    } catch (err) {
      if (err instanceof SocialPublishError && err.kind === "transient" && (err.httpStatus ?? 0) < 500 && err.retryAfterMs) {
        await input.saveState?.({ ...state, phase: "container" }); // rate limit: Instagram answered "no", so retrying later is safe
        throw err;
      }
      if (err instanceof SocialPublishError && (err.kind === "permanent" || err.kind === "auth")) {
        await input.saveState?.(null); // definitive rejection
        throw err;
      }
      // A 5xx, an unlabelled transient error or no answer at all: Instagram may have published. Leave the intent saved; the publisher marks UNCERTAIN.
      throw err instanceof SocialPublishError && err.kind === "uncertain" ? err : new SocialPublishError("uncertain", "Instagram did not give a clear answer to the publish request; the post may be live.");
    }
    if (!published.id) throw new SocialPublishError("uncertain", "Instagram answered without a media id; the post may have been published.");
    await input.saveState?.(null).catch(() => undefined);

    let permalink: string | null = null;
    try {
      const m = await graph<{ permalink?: string }>({ method: "GET", path: `/${published.id}`, token, phase: "read", query: { fields: "permalink" } });
      permalink = m.json.permalink ?? null;
    } catch { /* the post is live; the link is a nicety */ }
    return { externalPostId: published.id, externalUrl: permalink };
  },

  // ---------------- inbox ----------------
  verifyWebhook: ({ rawBody, headers }) => verifySignature(rawBody, headers["x-hub-signature-256"], config.metaAppSecret),
  handleWebhookChallenge: ({ query }) => webhookChallenge(query, config.metaWebhookVerifyToken),
  parseWebhook({ rawBody }) {
    try { return parseWebhookPayload(JSON.parse(rawBody.toString("utf8")) as IgWebhookPayload); } catch { return []; }
  },
  replyWindow: ({ type, lastInboundAt, now }) => (type === "DM" ? instagramReplyWindow(lastInboundAt, now) : { open: true, closesAt: null }),

  async onConnected(tokens) {
    const page = pageIdOf(tokens);
    if (!page) return { warnings: ["The linked Facebook Page is unknown, so direct-message webhooks could not be enabled."] };
    try {
      // POST /{page}/subscribed_apps REPLACES the field list, so merge with what is already subscribed (e.g. the Facebook connector's fields).
      const cur = await graph<{ data?: Array<{ id?: string; subscribed_fields?: string[] }> }>({ method: "GET", path: `/${page}/subscribed_apps`, token: tokens.accessToken, phase: "read" });
      const existing = (cur.json.data ?? []).find((a) => a.id === config.metaAppId)?.subscribed_fields ?? (cur.json.data?.length === 1 ? cur.json.data[0]!.subscribed_fields ?? [] : []);
      const merged = [...new Set([...existing, "messages"])];
      if (merged.length !== existing.length) await graph({ method: "POST", path: `/${page}/subscribed_apps`, token: tokens.accessToken, phase: "write", body: { subscribed_fields: merged.join(",") } });
      return {};
    } catch {
      return { warnings: ["Could not subscribe the linked Page to message webhooks, so new Instagram DMs will not arrive in real time. Comments use the app-level Instagram webhook. Check the Meta app's Webhooks settings, then reconnect."] };
    }
  },
  async onDisconnect() { /* The Page subscription may be shared with the Facebook connector; leave it. */ },

  async fetchInbox(tokens, { accountExternalId, cursor }) {
    const ig = accountExternalId;
    const page = pageIdOf(tokens);
    const now = Date.now();
    const since = cursor ? Number(cursor) : now - 6 * 3600_000;
    const events: InboundEvent[] = [];
    if (page) {
      const convs = await graph<{ data?: Array<{ updated_time?: string; messages?: { data?: Array<{ id: string; message?: string; from?: { id?: string; username?: string }; created_time?: string }> } }> }>({
        method: "GET", path: `/${page}/conversations`, token: tokens.accessToken, phase: "read", query: { platform: "instagram", fields: "updated_time,messages.limit(10){id,message,from,created_time}", limit: "25" },
      }).catch(() => ({ json: { data: [] as never[] } }));
      for (const c of convs.json.data ?? []) {
        if (c.updated_time && Date.parse(c.updated_time) <= since) continue;
        for (const m of c.messages?.data ?? []) {
          if (!m.from?.id || m.from.id === ig || m.from.id === page || !m.message || !m.created_time || Date.parse(m.created_time) <= since) continue;
          events.push({ type: "DM", accountExternalId: ig, providerThreadId: `dm:${m.from.id}`, providerMessageId: m.id, participant: { externalId: m.from.id, handle: m.from.username, name: m.from.username }, text: m.message, createdAt: m.created_time });
        }
      }
    }
    const media = await graph<{ data?: Array<{ id: string; comments?: { data?: Array<{ id: string; text?: string; username?: string; from?: { id?: string }; timestamp?: string; parent_id?: string }> } }> }>({
      method: "GET", path: `/${ig}/media`, token: tokens.accessToken, phase: "read", query: { fields: "id,comments.limit(25){id,text,username,from,timestamp,parent_id}", limit: "10" },
    });
    for (const post of media.json.data ?? []) {
      for (const c of post.comments?.data ?? []) {
        if (!c.timestamp || Date.parse(c.timestamp) <= since || c.from?.id === ig) continue;
        events.push({ type: "COMMENT", accountExternalId: ig, providerThreadId: `c:${c.parent_id ?? c.id}`, providerMessageId: c.id, participant: { externalId: c.from?.id, handle: c.username, name: c.username }, text: c.text ?? "[comment without text]", subjectRef: post.id, createdAt: c.timestamp });
      }
    }
    return { events, nextCursor: String(now - 60_000) };
  },

  // ---------------- listening (Step 10) ----------------
  async resolveMention(tokens, { accountExternalId, lookup }) {
    if (!/^\d{5,30}$/.test(lookup.id)) return null; // ids come from a verified webhook, but never build a field expression from anything else
    const attempts = lookup.kind === "ig_comment"
      ? [`mentioned_comment.comment_id(${lookup.id}){id,text,timestamp,username}`, `mentioned_comment.comment_id(${lookup.id}){id,text,timestamp}`]
      : [`mentioned_media.media_id(${lookup.id}){id,caption,media_type,timestamp,username,permalink}`, `mentioned_media.media_id(${lookup.id}){id,caption,media_type,timestamp,username}`];
    for (const fields of attempts) {
      try {
        const r = await graph<{ mentioned_comment?: { text?: string; timestamp?: string; username?: string }; mentioned_media?: { caption?: string; media_type?: string; timestamp?: string; username?: string; permalink?: string } }>({
          method: "GET", path: `/${accountExternalId}`, token: tokens.accessToken, phase: "read", query: { fields },
        });
        const c = r.json.mentioned_comment;
        const m = r.json.mentioned_media;
        const item = c ?? m;
        if (!item) return null;
        const text = c?.text ?? m?.caption ?? (m ? `[${(m.media_type ?? "post").toLowerCase()} that mentions you]` : "");
        return { text, participant: { handle: item.username, name: item.username }, createdAt: item.timestamp, permalink: m?.permalink };
      } catch (err) {
        if (!(err instanceof SocialPublishError && err.kind === "permanent")) throw err; // permanent = a field was refused: try the smaller list
      }
    }
    return null;
  },

  /** Polling fallback: only what Instagram LISTS. Caption and comment @mentions have no list endpoint (webhook only); photo tags do. */
  async fetchMentions(tokens, { accountExternalId, cursor }) {
    const since = cursor ? Number(cursor) : Date.now() - 24 * 3600_000;
    const now = Date.now();
    const r = await graph<{ data?: Array<{ id: string; caption?: string; media_type?: string; permalink?: string; timestamp?: string; username?: string }> }>({
      method: "GET", path: `/${accountExternalId}/tags`, token: tokens.accessToken, phase: "read", query: { fields: "id,caption,media_type,permalink,timestamp,username", limit: "25" },
    });
    const events: InboundEvent[] = [];
    for (const m of r.json.data ?? []) {
      if (!m.timestamp || Date.parse(m.timestamp) <= since) continue;
      events.push({
        type: "MENTION", accountExternalId, providerThreadId: `tag:${m.id}`, providerMessageId: `tag:${m.id}`, participant: { handle: m.username, name: m.username },
        text: m.caption || `[${(m.media_type ?? "post").toLowerCase()} that tags you]`, subjectRef: m.id, createdAt: m.timestamp, permalink: m.permalink,
      });
    }
    return { events, nextCursor: String(now - 60_000) };
  },

  replyCapability: ({ type, providerThreadId }) => {
    if (type === "MENTION" && (providerThreadId.startsWith("mc:") || providerThreadId.startsWith("mm:"))) return { mode: "api" };
    if (type === "MENTION") return { mode: "platform", reason: "Instagram does not let apps reply to a photo you were tagged in. Reply on Instagram." };
    return { mode: "platform", reason: "Instagram has no reviews." };
  },

  async sendReply(tokens: SocialTokenSet, input: SendReplyInput): Promise<SendReplyResult> {
    if (input.conversationType === "MENTION") {
      const fromComment = input.providerThreadId.startsWith("mc:");
      if (!fromComment && !input.providerThreadId.startsWith("mm:")) throw new SocialPublishError("permanent", "Instagram does not let apps reply to a photo you were tagged in. Reply on Instagram.");
      if (!input.subjectRef) throw new SocialPublishError("permanent", "The media this mention is on is unknown, so it cannot be answered from here. Reply on Instagram.");
      const body: Record<string, unknown> = { message: input.text, media_id: input.subjectRef };
      if (fromComment) body.comment_id = input.inReplyToProviderMessageId ?? input.providerThreadId.slice(3);
      const r = await graph<{ id?: string }>({ method: "POST", path: `/${input.accountExternalId}/mentions`, token: tokens.accessToken, phase: "write", body });
      if (!r.json.id) throw new SocialPublishError("uncertain", "Instagram answered without a comment id; the reply may have been posted.");
      return { providerMessageId: r.json.id };
    }
    if (input.conversationType === "COMMENT") {
      if (!input.inReplyToProviderMessageId) throw new SocialPublishError("permanent", "There is no comment to reply to.");
      const r = await graph<{ id?: string }>({ method: "POST", path: `/${input.inReplyToProviderMessageId}/replies`, token: tokens.accessToken, phase: "write", body: { message: input.text } });
      if (!r.json.id) throw new SocialPublishError("uncertain", "Instagram answered without a comment id; the reply may have been posted.");
      return { providerMessageId: r.json.id };
    }
    if (input.conversationType === "DM") {
      const page = pageIdOf(tokens);
      if (!input.participantExternalId) throw new SocialPublishError("permanent", "The recipient is unknown.");
      if (!page) throw new SocialPublishError("permanent", "The linked Facebook Page is unknown. Reconnect the account.");
      if (Buffer.byteLength(input.text, "utf8") > DM_BYTE_LIMIT) throw new SocialPublishError("permanent", `Instagram messages are limited to ${DM_BYTE_LIMIT} bytes of text (about ${DM_BYTE_LIMIT / 2}–${DM_BYTE_LIMIT} characters). Shorten the reply.`);
      // RESPONSE only: a reply inside the 24-hour window. The HUMAN_AGENT tag and message tags are deliberately NOT used.
      const r = await graph<{ message_id?: string }>({ method: "POST", path: `/${page}/messages`, token: tokens.accessToken, phase: "write", body: { recipient: { id: input.participantExternalId }, messaging_type: "RESPONSE", message: { text: input.text } } });
      if (!r.json.message_id) throw new SocialPublishError("uncertain", "Instagram answered without a message id; the message may have been sent.");
      return { providerMessageId: r.json.message_id };
    }
    throw new SocialPublishError("permanent", "Replying to this kind of item is not supported yet.");
  },

  async hideComment(tokens: SocialTokenSet, { providerMessageId, hidden }) {
    await graph({ method: "POST", path: `/${providerMessageId}`, token: tokens.accessToken, phase: "write", body: { hide: hidden } });
  },

  async markRead() { /* Instagram has no documented read-receipt call we rely on. */ },
};
