/**
 * Facebook Pages connector (provider key "meta_facebook"). Shared Graph plumbing lives in metaGraph.ts so an Instagram connector can reuse it.
 *
 * Design (see metaGraph.ts for the documentation sources and the open verification items):
 *  - OAuth: dialog/oauth (code flow) → short-lived user token → long-lived user token (fb_exchange_token) → GET /me/accounts lists the Pages the
 *    person manages, each with a Page access token. A Page token derived from a LONG-LIVED user token has no expiry; we store only Page tokens
 *    (encrypted by the token vault), one SocialAccount per Page, and never keep the user token.
 *  - Health: /debug_token (is_valid, scopes, expires_at, data_access_expires_at) with the app token. Page tokens can't be refreshed — reconnect.
 *  - Publishing: POST /{page}/feed (message, link) and POST /{page}/photos (url, caption). `scheduled_publish_time` is NOT used: our scheduler decides.
 *  - Inbox: webhooks (feed → comments, messages → Messenger, ratings) verified with X-Hub-Signature-256 over the raw body; GET hub.challenge handshake.
 *    Replies: comment reply (POST /{comment}/comments), Messenger Send API with messaging_type=RESPONSE only, inside the 24-hour window. No message tags.
 *  - Thread ids: comments → `c:<root comment id>`; Messenger → `dm:<PSID>`.
 */
import { config } from "../../../config/env";
import { redactSecrets, type SocialTokenSet } from "../tokenVault";
import { SocialPublishError } from "../publishing/publishErrors";
import {
  MESSAGING_WINDOW_MS, dialogUrl, graph, verifySignature, webhookChallenge,
} from "./metaGraph";
import {
  DEFAULT_CONSTRAINTS, type ConnectResult, type HealthResult, type InboundEvent, type PublishInput, type PublishResult, type ReplyWindow, type SelectableAccount,
  type SendReplyInput, type SendReplyResult, type SocialConnector, type SocialProfile,
} from "./types";

export const FACEBOOK_SCOPES = ["pages_show_list", "pages_manage_metadata", "pages_manage_posts", "pages_manage_engagement", "pages_read_engagement", "pages_read_user_engagement", "pages_messaging"] as const;
/** Without these the connector cannot do its core job (publish + moderate). pages_messaging is optional (Messenger only). */
export const REQUIRED_SCOPES = ["pages_manage_posts", "pages_manage_engagement", "pages_read_engagement"] as const;
export const SUBSCRIBED_FIELDS_FULL = "feed,messages,mention,ratings";
export const SUBSCRIBED_FIELDS_CORE = "feed,messages";
const MESSENGER_TEXT_LIMIT = 2000;

const appToken = () => `${config.metaAppId}|${config.metaAppSecret}`;
const pageIdOf = (tokens: SocialTokenSet, fallback?: string) => String((tokens.pageId as string | undefined) ?? fallback ?? "");
const epochToIso = (seconds: number | undefined) => (typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : undefined);

export const postUrl = (id: string): string => {
  const cut = id.lastIndexOf("_"); // ids are `<pageId>_<postId>`
  return cut > 0 ? `https://www.facebook.com/${id.slice(0, cut)}/posts/${id.slice(cut + 1)}` : `https://www.facebook.com/${id}`;
};

export const messengerReplyWindow = (lastInboundAt: Date | null, now: Date): ReplyWindow => {
  if (!lastInboundAt) return { open: false, closesAt: null, reason: "There is no message from this person to reply to." };
  const closesAt = new Date(lastInboundAt.getTime() + MESSAGING_WINDOW_MS);
  return now.getTime() <= closesAt.getTime()
    ? { open: true, closesAt }
    : { open: false, closesAt, reason: "Facebook only allows replying to a Messenger message within 24 hours of the person's last message. The window closed, so this reply can't be sent from here." };
};

// ---------------- webhook parsing ----------------
interface WebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
    messaging?: Array<{ sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] } }>;
  }>;
}

/** Normalises a Page webhook delivery. Unknown shapes are skipped, never thrown on. The Page's own comments/messages (echoes) are ignored. */
export function parseWebhookPayload(payload: WebhookPayload): InboundEvent[] {
  if (payload.object !== "page") return [];
  const out: InboundEvent[] = [];
  for (const entry of payload.entry ?? []) {
    const pageId = entry.id;
    if (!pageId) continue;
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      if (change.field === "feed" && v.item === "comment" && v.verb === "add") {
        const commentId = v.comment_id as string | undefined;
        const postId = v.post_id as string | undefined;
        const from = v.from as { id?: string; name?: string } | undefined;
        const text = typeof v.message === "string" ? v.message : "";
        if (!commentId || !from?.id || from.id === pageId) continue; // no id, or the Page's own comment
        const parent = v.parent_id as string | undefined;
        const root = parent && parent !== postId ? parent : commentId; // replies stay in their parent comment's thread
        out.push({ type: "COMMENT", accountExternalId: pageId, providerThreadId: `c:${root}`, providerMessageId: commentId, participant: { externalId: from.id, name: from.name }, text: text || "[comment without text]", subjectRef: postId, createdAt: epochToIso(v.created_time as number | undefined) });
      } else if (change.field === "ratings" && (v.review_text || v.rating_text || v.recommendation_type)) {
        const reviewer = v.reviewer_id as string | undefined;
        const id = (v.open_graph_story_id as string | undefined) ?? (reviewer ? `${reviewer}:${v.created_time ?? ""}` : undefined);
        if (!id || reviewer === pageId) continue;
        out.push({ type: "REVIEW", accountExternalId: pageId, providerThreadId: `r:${id}`, providerMessageId: id, participant: { externalId: reviewer, name: v.reviewer_name as string | undefined }, text: String(v.review_text ?? v.rating_text ?? v.recommendation_type), createdAt: epochToIso(v.created_time as number | undefined) });
      }
    }
    for (const m of entry.messaging ?? []) {
      const psid = m.sender?.id;
      if (!m.message?.mid || !psid || psid === pageId || m.message.is_echo) continue;
      const text = m.message.text ?? (m.message.attachments?.length ? "[attachment]" : "");
      if (!text) continue;
      out.push({ type: "DM", accountExternalId: pageId, providerThreadId: `dm:${psid}`, providerMessageId: m.message.mid, participant: { externalId: psid }, text, createdAt: m.timestamp ? new Date(m.timestamp).toISOString() : undefined });
    }
  }
  return out;
}

// ---------------- connector ----------------
type PageRow = { id: string; name?: string; category?: string; access_token?: string; tasks?: string[]; picture?: { data?: { url?: string } } };

async function listPages(userToken: string): Promise<PageRow[]> {
  const pages: PageRow[] = [];
  let after: string | undefined;
  for (let i = 0; i < 5; i++) {
    const r = await graph<{ data?: PageRow[]; paging?: { cursors?: { after?: string }; next?: string } }>({ method: "GET", path: "/me/accounts", token: userToken, phase: "read", query: { fields: "id,name,category,access_token,tasks,picture{url}", limit: "100", after } });
    pages.push(...(r.json.data ?? []));
    after = r.json.paging?.next ? r.json.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return pages;
}

const toSelectable = (p: PageRow, scopes: string[]): SelectableAccount | null => {
  if (!p.access_token) return null;
  const tasks = p.tasks ?? [];
  const warnings: string[] = [];
  if (tasks.length) {
    if (!tasks.includes("CREATE_CONTENT")) warnings.push("You can't publish posts to this Page (needs the Create content task).");
    if (!tasks.includes("MODERATE")) warnings.push("You can't moderate comments on this Page (needs the Moderate task).");
    if (!tasks.includes("MESSAGING")) warnings.push("You can't read or send Messenger messages for this Page (needs the Messages task).");
  }
  return { profile: { externalAccountId: p.id, displayName: p.name ?? p.id, handle: null, avatarUrl: p.picture?.data?.url ?? null, accountType: "PAGE" }, tokens: { accessToken: p.access_token, pageId: p.id, scopes }, tasks, warnings };
};

export const facebookPageProvider: SocialConnector = {
  key: "meta_facebook",
  label: "Facebook Pages",
  implemented: true,
  defaultScopes: [...FACEBOOK_SCOPES],
  isConfigured: () => !!config.metaAppId && !!config.metaAppSecret,
  get pollsInbox() { return config.metaInboxPolling; },
  getConstraints: () => ({ ...DEFAULT_CONSTRAINTS, maxChars: 63206, maxHashtags: 30, maxMedia: 1, allowedMediaTypes: ["image/jpeg", "image/png", "image/gif"], supportsLink: true }),

  getAuthUrl({ state, redirectUri, scopes }) {
    const q = new URLSearchParams({ client_id: config.metaAppId, redirect_uri: redirectUri, state, response_type: "code", scope: (scopes?.length ? scopes : [...FACEBOOK_SCOPES]).join(",") });
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
      listPages(userToken),
    ]);
    const scopes = (perms.json.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);
    const selectable = pages.map((p) => toSelectable(p, scopes)).filter((x): x is SelectableAccount => !!x);
    if (selectable.length === 0) throw new Error("This Facebook account does not manage any Pages (or no Page access was granted).");
    // The user token is NOT returned for storage: only per-Page tokens are persisted, after the person picks which Pages to connect.
    return { profile: { externalAccountId: me.json.id ?? "user", displayName: me.json.name ?? "Facebook user", accountType: "USER" }, tokens: { accessToken: "" }, selectable };
  },

  async refreshToken(): Promise<SocialTokenSet> {
    throw new Error("Facebook Page access tokens cannot be refreshed automatically; reconnect the Page to renew access.");
  },

  async getProfile(tokens: SocialTokenSet): Promise<SocialProfile> {
    const id = pageIdOf(tokens);
    const r = await graph<{ id: string; name?: string; username?: string; picture?: { data?: { url?: string } } }>({ method: "GET", path: `/${id}`, token: tokens.accessToken, phase: "read", query: { fields: "id,name,username,category,picture{url}" } });
    return { externalAccountId: r.json.id, displayName: r.json.name ?? r.json.id, handle: r.json.username ?? null, avatarUrl: r.json.picture?.data?.url ?? null, accountType: "PAGE" };
  },

  async healthCheck(tokens: SocialTokenSet): Promise<HealthResult> {
    const r = await graph<{ data?: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; error?: { message?: string } } }>({
      method: "GET", path: "/debug_token", token: appToken(), phase: "read", query: { input_token: tokens.accessToken },
    });
    const d = r.json.data;
    if (!d?.is_valid) return { ok: false, error: redactSecrets(d?.error?.message ?? "The Page access token is no longer valid; reconnect the Page.", [tokens.accessToken]).slice(0, 200) };
    const granted = new Set(d.scopes ?? []);
    const missing = REQUIRED_SCOPES.filter((s) => d.scopes && !granted.has(s));
    if (missing.length) return { ok: false, error: `Missing permissions: ${missing.join(", ")}. Reconnect the Page and approve them.` };
    // 0 means "never". The earliest non-zero of token expiry / data-access expiry is what the 7-day warning should track.
    const times = [d.expires_at, d.data_access_expires_at].filter((t): t is number => typeof t === "number" && t > 0);
    return { ok: true, expiresAt: times.length ? new Date(Math.min(...times) * 1000).toISOString() : null };
  },

  async publish(tokens: SocialTokenSet, input: PublishInput): Promise<PublishResult> {
    const page = pageIdOf(tokens, input.accountExternalId);
    if (!input.text.trim() && !input.linkUrl) throw new SocialPublishError("permanent", "The post has no text or link.");
    if (input.media.length > 1) throw new SocialPublishError("permanent", "Facebook publishing currently supports one photo per post.");
    const photo = input.media[0];
    if (photo && !["image/jpeg", "image/png", "image/gif"].includes(photo.mimeType)) throw new SocialPublishError("permanent", "Facebook photos must be JPEG, PNG or GIF.");

    let res;
    if (photo) {
      if (!photo.signedUrl) throw new SocialPublishError("permanent", "This media file cannot be shared by URL.");
      const url = await photo.signedUrl().catch(() => { throw new SocialPublishError("transient", "Could not prepare the photo for upload."); });
      // A photo post cannot carry a separate link preview, so the link goes into the caption.
      const caption = input.linkUrl && !input.text.includes(input.linkUrl) ? `${input.text}\n\n${input.linkUrl}`.trim() : input.text;
      res = await graph<{ id?: string; post_id?: string }>({ method: "POST", path: `/${page}/photos`, token: tokens.accessToken, phase: "write", body: { url, caption, published: true } });
      const id = res.json.post_id ?? res.json.id;
      if (!id) throw new SocialPublishError("uncertain", "Meta answered without a post id; the photo may have been published.");
      return { externalPostId: id, externalUrl: postUrl(id) };
    }
    res = await graph<{ id?: string }>({ method: "POST", path: `/${page}/feed`, token: tokens.accessToken, phase: "write", body: { message: input.text, ...(input.linkUrl ? { link: input.linkUrl } : {}), published: true } });
    if (!res.json.id) throw new SocialPublishError("uncertain", "Meta answered without a post id; the post may have been published.");
    return { externalPostId: res.json.id, externalUrl: postUrl(res.json.id) };
  },

  // ---------------- inbox ----------------
  verifyWebhook: ({ rawBody, headers }) => verifySignature(rawBody, headers["x-hub-signature-256"], config.metaAppSecret),
  handleWebhookChallenge: ({ query }) => webhookChallenge(query, config.metaWebhookVerifyToken),
  parseWebhook({ rawBody }) {
    try { return parseWebhookPayload(JSON.parse(rawBody.toString("utf8")) as WebhookPayload); } catch { return []; }
  },
  replyWindow: ({ type, lastInboundAt, now }) => (type === "DM" ? messengerReplyWindow(lastInboundAt, now) : { open: true, closesAt: null }),

  async onConnected(tokens, profile) {
    const page = profile.externalAccountId;
    for (const fields of [SUBSCRIBED_FIELDS_FULL, SUBSCRIBED_FIELDS_CORE]) {
      try {
        await graph({ method: "POST", path: `/${page}/subscribed_apps`, token: tokens.accessToken, phase: "write", body: { subscribed_fields: fields } });
        return {};
      } catch { /* try the smaller field set, then warn */ }
    }
    return { warnings: ["Could not subscribe this Page to webhooks, so new comments and messages will not arrive in real time. Check the Meta app's Webhooks settings, then reconnect."] };
  },
  async onDisconnect(tokens, profile) {
    await graph({ method: "DELETE", path: `/${profile.externalAccountId}/subscribed_apps`, token: tokens.accessToken, phase: "write" }).catch(() => undefined);
  },

  async fetchInbox(tokens, { accountExternalId, cursor }) {
    const page = pageIdOf(tokens, accountExternalId);
    const now = Date.now();
    const since = cursor ? Number(cursor) : now - 6 * 3600_000;
    const events: InboundEvent[] = [];
    const convs = await graph<{ data?: Array<{ updated_time?: string; messages?: { data?: Array<{ id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string }> } }> }>({
      method: "GET", path: `/${page}/conversations`, token: tokens.accessToken, phase: "read", query: { platform: "messenger", fields: "updated_time,messages.limit(10){id,message,from,created_time}", limit: "25" },
    });
    for (const c of convs.json.data ?? []) {
      if (c.updated_time && Date.parse(c.updated_time) <= since) continue;
      for (const m of c.messages?.data ?? []) {
        if (!m.from?.id || m.from.id === page || !m.message || !m.created_time || Date.parse(m.created_time) <= since) continue;
        events.push({ type: "DM", accountExternalId: page, providerThreadId: `dm:${m.from.id}`, providerMessageId: m.id, participant: { externalId: m.from.id, name: m.from.name }, text: m.message, createdAt: m.created_time });
      }
    }
    const feed = await graph<{ data?: Array<{ id: string; comments?: { data?: Array<{ id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string; parent?: { id?: string } }> } }> }>({
      method: "GET", path: `/${page}/feed`, token: tokens.accessToken, phase: "read", query: { fields: "id,comments.filter(stream).limit(25){id,message,from,created_time,parent{id}}", limit: "10" },
    });
    for (const post of feed.json.data ?? []) {
      for (const c of post.comments?.data ?? []) {
        if (!c.from?.id || c.from.id === page || !c.created_time || Date.parse(c.created_time) <= since) continue;
        events.push({ type: "COMMENT", accountExternalId: page, providerThreadId: `c:${c.parent?.id ?? c.id}`, providerMessageId: c.id, participant: { externalId: c.from.id, name: c.from.name }, text: c.message ?? "[comment without text]", subjectRef: post.id, createdAt: c.created_time });
      }
    }
    return { events, nextCursor: String(now - 60_000) }; // one-minute overlap; duplicates are dropped by message id
  },

  async sendReply(tokens: SocialTokenSet, input: SendReplyInput): Promise<SendReplyResult> {
    if (input.conversationType === "COMMENT") {
      if (!input.inReplyToProviderMessageId) throw new SocialPublishError("permanent", "There is no comment to reply to.");
      const r = await graph<{ id?: string }>({ method: "POST", path: `/${input.inReplyToProviderMessageId}/comments`, token: tokens.accessToken, phase: "write", body: { message: input.text } });
      if (!r.json.id) throw new SocialPublishError("uncertain", "Meta answered without a comment id; the reply may have been posted.");
      return { providerMessageId: r.json.id };
    }
    if (input.conversationType === "DM") {
      if (!input.participantExternalId) throw new SocialPublishError("permanent", "The recipient is unknown.");
      if (input.text.length > MESSENGER_TEXT_LIMIT) throw new SocialPublishError("permanent", `Messenger messages are limited to ${MESSENGER_TEXT_LIMIT} characters.`);
      // RESPONSE only: a reply to a person's message inside the 24-hour window. Message tags are deliberately NOT used.
      const r = await graph<{ message_id?: string }>({ method: "POST", path: "/me/messages", token: tokens.accessToken, phase: "write", body: { recipient: { id: input.participantExternalId }, messaging_type: "RESPONSE", message: { text: input.text } } });
      if (!r.json.message_id) throw new SocialPublishError("uncertain", "Meta answered without a message id; the message may have been sent.");
      return { providerMessageId: r.json.message_id };
    }
    throw new SocialPublishError("permanent", "Replying to this kind of item is not supported yet.");
  },

  async hideComment(tokens: SocialTokenSet, { providerMessageId, hidden }) {
    await graph({ method: "POST", path: `/${providerMessageId}`, token: tokens.accessToken, phase: "write", body: { is_hidden: hidden } });
  },

  async markRead(tokens: SocialTokenSet, { providerThreadId }) {
    if (!providerThreadId.startsWith("dm:")) return; // comments have no read state
    await graph({ method: "POST", path: "/me/messages", token: tokens.accessToken, phase: "write", body: { recipient: { id: providerThreadId.slice(3) }, sender_action: "mark_seen" } });
  },
};
