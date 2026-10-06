/**
 * Facebook Pages connector contract tests: signature + handshake, webhook parsing, request building, error classification, messaging window.
 * Fixtures are HAND-AUTHORED from Meta's documentation excerpts (tests/fixtures/meta/README.md) — not recordings. No real network.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import webhooks from "../fixtures/meta/webhooks.json";

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config, metaAppId: "APPID", metaAppSecret: "app-secret-0123456789abcdef", metaWebhookVerifyToken: "verify-token-xyz", metaApiVersion: "v25.0", socialPublishingDisabled: false } };
});
import { config } from "../../server/config/env";
import { appSecretProof, buildUrl, classifyGraphError, errorFromGraph, errorFromNetwork, metaHttp, verifySignature, webhookChallenge } from "../../server/services/social/connectors/metaGraph";
import { facebookPageProvider, messengerReplyWindow, parseWebhookPayload, postUrl } from "../../server/services/social/connectors/facebookPageProvider";
import { providerSetup } from "../../server/services/social/connectors/setupInfo";
import { SocialPublishError } from "../../server/services/social/publishing/publishErrors";

const SECRET = config.metaAppSecret;
const sign = (body: string | Buffer, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const TOKEN = "PAGE_TOKEN_SECRET_VALUE";

describe("webhook signature (X-Hub-Signature-256 over the RAW body)", () => {
  const raw = Buffer.from(JSON.stringify(webhooks.commentAdd));
  it("accepts a valid signature", () => {
    expect(verifySignature(raw, sign(raw), SECRET)).toBe(true);
    expect(facebookPageProvider.verifyWebhook!({ rawBody: raw, headers: { "x-hub-signature-256": sign(raw) } })).toBe(true);
  });
  it("rejects bad, tampered, malformed, wrong-secret and missing signatures (fail closed)", () => {
    expect(verifySignature(raw, sign(raw, "another-secret"), SECRET)).toBe(false);
    expect(verifySignature(Buffer.from(raw.toString() + " "), sign(raw), SECRET)).toBe(false); // body changed after signing (re-serialised JSON would fail the same way)
    expect(verifySignature(raw, undefined, SECRET)).toBe(false);
    expect(verifySignature(raw, "", SECRET)).toBe(false);
    expect(verifySignature(raw, "sha256=", SECRET)).toBe(false);
    expect(verifySignature(raw, "sha256=zzzz", SECRET)).toBe(false);
    expect(verifySignature(raw, sign(raw).replace("sha256=", "sha1="), SECRET)).toBe(false);
    expect(verifySignature(raw, sign(raw), "")).toBe(false); // no app secret configured → nothing verifies
    expect(facebookPageProvider.verifyWebhook!({ rawBody: raw, headers: {} })).toBe(false);
  });
  it("uses the raw bytes, so a semantically identical re-serialisation does not verify", () => {
    const pretty = Buffer.from(JSON.stringify(webhooks.commentAdd, null, 2));
    expect(verifySignature(pretty, sign(raw), SECRET)).toBe(false);
  });
});

describe("hub.challenge handshake", () => {
  const q = (over: Record<string, string | undefined> = {}) => ({ "hub.mode": "subscribe", "hub.verify_token": "verify-token-xyz", "hub.challenge": "1158201444", ...over });
  it("echoes the challenge for the right token", () => {
    expect(webhookChallenge(q(), "verify-token-xyz")).toBe("1158201444");
    expect(facebookPageProvider.handleWebhookChallenge!({ query: q() })).toBe("1158201444");
  });
  it("refuses a wrong token, wrong mode, missing parts, and any request when no token is configured", () => {
    expect(webhookChallenge(q({ "hub.verify_token": "nope" }), "verify-token-xyz")).toBeNull();
    expect(webhookChallenge(q({ "hub.mode": "unsubscribe" }), "verify-token-xyz")).toBeNull();
    expect(webhookChallenge(q({ "hub.challenge": undefined }), "verify-token-xyz")).toBeNull();
    expect(webhookChallenge(q({ "hub.verify_token": undefined }), "verify-token-xyz")).toBeNull();
    expect(webhookChallenge(q(), "")).toBeNull();
    expect(webhookChallenge(q({ "hub.verify_token": "" }), "")).toBeNull();
  });
});

describe("webhook parsing", () => {
  it("parses a top-level comment into a COMMENT event with stable ids", () => {
    expect(parseWebhookPayload(webhooks.commentAdd)).toEqual([{
      type: "COMMENT", accountExternalId: "PAGE1", providerThreadId: "c:POST1_C1", providerMessageId: "POST1_C1", participant: { externalId: "U100", name: "Ada Lovelace" },
      text: "What are your opening hours?", subjectRef: "PAGE1_POST1", createdAt: new Date(1760000000 * 1000).toISOString(),
    }]);
  });
  it("keeps replies in their parent comment's thread", () => {
    const [e] = parseWebhookPayload(webhooks.commentReply);
    expect(e).toMatchObject({ providerThreadId: "c:POST1_C1", providerMessageId: "POST1_C2" });
  });
  it("ignores edits, removals, non-comment items, the Page's own comments and non-page objects", () => {
    expect(parseWebhookPayload(webhooks.commentEditAndRemove)).toEqual([]);
    expect(parseWebhookPayload(webhooks.pageOwnComment)).toEqual([]);
    expect(parseWebhookPayload(webhooks.notAPage)).toEqual([]);
    expect(parseWebhookPayload({} as never)).toEqual([]);
  });
  it("parses Messenger text, skipping echoes and delivery receipts, and labels attachments", () => {
    expect(parseWebhookPayload(webhooks.messengerText)).toEqual([{
      type: "DM", accountExternalId: "PAGE1", providerThreadId: "dm:PSID1", providerMessageId: "m_abc123", participant: { externalId: "PSID1" }, text: "hello, world!", createdAt: new Date(1760000400000).toISOString(),
    }]);
    const events = parseWebhookPayload(webhooks.messengerEchoDeliveryAttachment);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ providerMessageId: "m_att", text: "[attachment]", providerThreadId: "dm:PSID2" });
  });
  it("parses ratings into REVIEW events", () => {
    expect(parseWebhookPayload(webhooks.rating)[0]).toMatchObject({ type: "REVIEW", providerMessageId: "OGS1", text: "Great service", participant: { externalId: "U200", name: "Alan Turing" } });
  });
  it("parseWebhook never throws on garbage", () => {
    expect(facebookPageProvider.parseWebhook!({ rawBody: Buffer.from("not json") })).toEqual([]);
    expect(facebookPageProvider.parseWebhook!({ rawBody: Buffer.from(JSON.stringify(webhooks.commentAdd)) })).toHaveLength(1);
  });
});

describe("messaging window", () => {
  const last = new Date("2026-10-14T10:00:00Z");
  it("is open for 24 hours after the last inbound message, inclusive", () => {
    expect(messengerReplyWindow(last, new Date("2026-10-14T10:00:01Z"))).toMatchObject({ open: true, closesAt: new Date("2026-10-15T10:00:00Z") });
    expect(messengerReplyWindow(last, new Date("2026-10-15T10:00:00Z")).open).toBe(true);
    const closed = messengerReplyWindow(last, new Date("2026-10-15T10:00:01Z"));
    expect(closed.open).toBe(false);
    expect(closed.reason).toMatch(/24 hours/);
  });
  it("is closed when there is nothing to reply to, and only applies to DMs", () => {
    expect(messengerReplyWindow(null, new Date()).open).toBe(false);
    expect(facebookPageProvider.replyWindow!({ type: "DM", lastInboundAt: last, now: new Date("2026-10-16T00:00:00Z") }).open).toBe(false);
    expect(facebookPageProvider.replyWindow!({ type: "COMMENT", lastInboundAt: last, now: new Date("2026-12-01T00:00:00Z") })).toEqual({ open: true, closesAt: null });
  });
});

describe("error classification", () => {
  const body = (code: number, extra: Record<string, unknown> = {}) => ({ error: { message: "m", type: "OAuthException", code, fbtrace_id: "TRACE1", ...extra } });
  it("maps Graph error codes", () => {
    expect(classifyGraphError(400, body(190)).kind).toBe("auth"); // expired / invalid token
    expect(classifyGraphError(400, body(102)).kind).toBe("auth");
    expect(classifyGraphError(401, undefined).kind).toBe("auth");
    expect(classifyGraphError(403, body(200)).kind).toBe("auth"); // permission error
    expect(classifyGraphError(400, body(10)).kind).toBe("auth");
    for (const code of [4, 17, 32, 613, 80001]) expect(classifyGraphError(400, body(code)).kind).toBe("transient"); // rate limits
    expect(classifyGraphError(500, undefined).kind).toBe("transient");
    expect(classifyGraphError(400, body(1)).kind).toBe("transient");
    expect(classifyGraphError(400, body(999, { is_transient: true })).kind).toBe("transient");
    expect(classifyGraphError(400, body(100)).kind).toBe("permanent"); // invalid parameter
    expect(classifyGraphError(400, body(368)).kind).toBe("permanent"); // policy block
    expect(classifyGraphError(400, body(551)).kind).toBe("permanent"); // recipient unavailable
    expect(classifyGraphError(400, body(10, { error_subcode: 2018278 }))).toMatchObject({ kind: "permanent", window: true });
  });
  it("produces actionable, secret-free messages and a retry hint for rate limits", () => {
    const rate = errorFromGraph(400, body(4));
    expect(rate).toMatchObject({ kind: "transient", retryAfterMs: 15 * 60_000 });
    expect(errorFromGraph(400, body(190)).message).toMatch(/Reconnect the Page/);
    expect(errorFromGraph(400, body(10, { error_subcode: 2018278 })).message).toMatch(/24 hours/);
    const leaky = errorFromGraph(400, body(100, { message: `Invalid token ${TOKEN} access_token=abcdefghijkl` }), [TOKEN]);
    expect(leaky.message).not.toContain(TOKEN);
    expect(leaky.message).toContain("TRACE1");
  });
  it("treats network failures per phase", () => {
    expect(errorFromNetwork({ name: "AbortError" }, "write").kind).toBe("uncertain");
    expect(errorFromNetwork({ cause: { code: "ECONNREFUSED" } }, "write").kind).toBe("transient");
    expect(errorFromNetwork({ name: "AbortError" }, "read").kind).toBe("transient");
  });
});

// ---------------- request building against a stubbed transport ----------------
describe("requests", () => {
  const original = metaHttp.fetch;
  let calls: Array<{ url: string; method: string; body: Record<string, unknown> | null }>;
  const reply = (queue: Array<unknown | Error>, status = 200) => {
    calls = [];
    metaHttp.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      const isResponse = next instanceof Response;
      return isResponse ? next : new Response(JSON.stringify(next ?? {}), { status });
    }) as typeof fetch;
  };
  beforeEach(() => reply([]));
  afterEach(() => { metaHttp.fetch = original; });
  const tokens = { accessToken: TOKEN, pageId: "PAGE1" };
  const base = { accountExternalId: "PAGE1", text: "Hello Facebook", media: [], idempotencyKey: "k1", attempt: 1 };

  it("builds the authorization URL (v25.0, code flow, requested permissions)", () => {
    const url = new URL(facebookPageProvider.getAuthUrl({ state: "st", redirectUri: "https://cc.example/social/accounts" }));
    expect(`${url.origin}${url.pathname}`).toBe("https://www.facebook.com/v25.0/dialog/oauth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "APPID", redirect_uri: "https://cc.example/social/accounts", state: "st", response_type: "code" });
    expect(url.searchParams.get("scope")!.split(",")).toEqual(["pages_show_list", "pages_manage_metadata", "pages_manage_posts", "pages_manage_engagement", "pages_read_engagement", "pages_read_user_engagement", "pages_messaging"]);
  });

  it("OAuth: exchanges the code, upgrades to a long-lived token, lists Pages; returns only Page tokens (never the user token)", async () => {
    reply([
      { access_token: "SHORT_USER" }, { access_token: "LONG_USER", expires_in: 5184000 },
      { id: "U1", name: "Ada" }, { data: [{ permission: "pages_manage_posts", status: "granted" }, { permission: "pages_messaging", status: "declined" }] },
      { data: [{ id: "PAGE1", name: "Artify", category: "Software", access_token: "PAGE_TOKEN_1", tasks: ["CREATE_CONTENT", "MODERATE", "MESSAGING"], picture: { data: { url: "https://img/p1.png" } } }, { id: "PAGE2", name: "Other", access_token: "PAGE_TOKEN_2", tasks: ["ANALYZE"] }, { id: "PAGE3", name: "NoToken" }] },
    ]);
    const res = await facebookPageProvider.handleCallback({ code: "thecode", redirectUri: "https://cc.example/social/accounts" });
    expect(calls[0]!.url).toContain("https://graph.facebook.com/v25.0/oauth/access_token?");
    expect(new URL(calls[0]!.url).searchParams.get("code")).toBe("thecode");
    expect(new URL(calls[1]!.url).searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(new URL(calls[1]!.url).searchParams.get("fb_exchange_token")).toBe("SHORT_USER");
    expect(calls[4]!.url).toContain("/me/accounts?");
    expect(res.selectable!.map((p) => p.profile.externalAccountId)).toEqual(["PAGE1", "PAGE2"]); // a Page without a token is not connectable
    expect(res.selectable![0]).toMatchObject({ tokens: { accessToken: "PAGE_TOKEN_1", pageId: "PAGE1", scopes: ["pages_manage_posts"] }, warnings: [] });
    expect(res.selectable![1]!.warnings).toHaveLength(3); // ANALYZE-only: can't post, moderate or message
    expect(JSON.stringify(res)).not.toContain("LONG_USER");
    expect(JSON.stringify(res)).not.toContain("SHORT_USER");
    expect(res.tokens.accessToken).toBe("");
  });

  it("OAuth: a person with no Pages gets a clear error", async () => {
    reply([{ access_token: "S" }, { access_token: "L" }, { id: "U1", name: "Ada" }, { data: [] }, { data: [] }]);
    await expect(facebookPageProvider.handleCallback({ code: "c", redirectUri: "r" })).rejects.toThrow(/does not manage any Pages/);
  });

  it("publishes text + link with POST /{page}/feed — and never schedules on Meta's side", async () => {
    reply([{ id: "PAGE1_POST7" }]);
    const out = await facebookPageProvider.publish!(tokens, { ...base, linkUrl: "https://artifysols.com/blog/x" });
    expect(out).toEqual({ externalPostId: "PAGE1_POST7", externalUrl: "https://www.facebook.com/PAGE1/posts/POST7" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/PAGE1/feed");
    expect(calls[0]!.body).toMatchObject({ message: "Hello Facebook", link: "https://artifysols.com/blog/x", access_token: TOKEN, published: true });
    expect(calls[0]!.body).not.toHaveProperty("scheduled_publish_time");
    expect(calls[0]!.url).not.toContain(TOKEN); // POST tokens travel in the body, not the URL
  });

  it("publishes a single photo by URL with the link in the caption", async () => {
    reply([{ id: "PHOTO1", post_id: "PAGE1_POST8" }]);
    const media = [{ mediaId: "m", mimeType: "image/png", load: async () => Buffer.alloc(1), signedUrl: async () => "https://signed.example/img.png?sig=1" }];
    const out = await facebookPageProvider.publish!(tokens, { ...base, text: "Look", linkUrl: "https://x.example/a", media });
    expect(out.externalPostId).toBe("PAGE1_POST8");
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/PAGE1/photos");
    expect(calls[0]!.body).toMatchObject({ url: "https://signed.example/img.png?sig=1", caption: "Look\n\nhttps://x.example/a", published: true });
    expect(calls[0]!.body).not.toHaveProperty("scheduled_publish_time");
  });

  it("rejects unsupported publish input before any request", async () => {
    const m = (mimeType: string) => ({ mediaId: "m", mimeType, load: async () => Buffer.alloc(1), signedUrl: async () => "u" });
    await expect(facebookPageProvider.publish!(tokens, { ...base, text: " " })).rejects.toMatchObject({ kind: "permanent" });
    await expect(facebookPageProvider.publish!(tokens, { ...base, media: [m("image/png"), m("image/png")] })).rejects.toThrow(/one photo/);
    await expect(facebookPageProvider.publish!(tokens, { ...base, media: [m("video/mp4")] })).rejects.toThrow(/JPEG, PNG or GIF/);
    expect(calls).toHaveLength(0);
  });

  it("classifies publish failures and treats a post-send abort or a missing id as UNCERTAIN", async () => {
    const errBody = (code: number) => ({ error: { message: "x", code, type: "OAuthException" } });
    reply([errBody(190)], 400);
    expect(await facebookPageProvider.publish!(tokens, base).catch((e) => e)).toMatchObject({ kind: "auth" });
    reply([errBody(4)], 400);
    expect(await facebookPageProvider.publish!(tokens, base).catch((e) => e)).toMatchObject({ kind: "transient" });
    reply([errBody(100)], 400);
    expect(await facebookPageProvider.publish!(tokens, base).catch((e) => e)).toMatchObject({ kind: "permanent" });
    reply([Object.assign(new Error("aborted"), { name: "AbortError" })]);
    expect(await facebookPageProvider.publish!(tokens, base).catch((e) => e)).toMatchObject({ kind: "uncertain" });
    reply([{}]);
    expect(await facebookPageProvider.publish!(tokens, base).catch((e) => e)).toMatchObject({ kind: "uncertain" });
  });

  it("never leaks the Page token in thrown errors", async () => {
    reply([{ error: { message: `bad token ${TOKEN}`, code: 100, type: "GraphMethodException" } }], 400);
    const err = (await facebookPageProvider.publish!(tokens, base).catch((e) => e)) as SocialPublishError;
    expect(err.message).not.toContain(TOKEN);
  });

  it("replies to a comment with POST /{comment}/comments", async () => {
    reply([{ id: "POST1_C9" }]);
    const out = await facebookPageProvider.sendReply!(tokens, { accountExternalId: "PAGE1", conversationType: "COMMENT", providerThreadId: "c:POST1_C1", inReplyToProviderMessageId: "POST1_C2", text: "Thanks!", idempotencyKey: "k" });
    expect(out.providerMessageId).toBe("POST1_C9");
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/POST1_C2/comments");
    expect(calls[0]!.body).toMatchObject({ message: "Thanks!", access_token: TOKEN });
  });

  it("sends Messenger replies as RESPONSE only — no message tag — and enforces limits", async () => {
    reply([{ recipient_id: "PSID1", message_id: "m_out1" }]);
    const out = await facebookPageProvider.sendReply!(tokens, { accountExternalId: "PAGE1", conversationType: "DM", providerThreadId: "dm:PSID1", participantExternalId: "PSID1", text: "Hi there", idempotencyKey: "k" });
    expect(out.providerMessageId).toBe("m_out1");
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/me/messages");
    expect(calls[0]!.body).toMatchObject({ recipient: { id: "PSID1" }, messaging_type: "RESPONSE", message: { text: "Hi there" } });
    expect(calls[0]!.body).not.toHaveProperty("tag");
    await expect(facebookPageProvider.sendReply!(tokens, { accountExternalId: "PAGE1", conversationType: "DM", providerThreadId: "dm:PSID1", participantExternalId: "PSID1", text: "x".repeat(2001), idempotencyKey: "k" })).rejects.toThrow(/2000/);
    await expect(facebookPageProvider.sendReply!(tokens, { accountExternalId: "PAGE1", conversationType: "REVIEW", providerThreadId: "r:1", text: "x", idempotencyKey: "k" })).rejects.toThrow(/not supported/);
  });

  it("maps Meta's outside-the-window error to a clear permanent error", async () => {
    reply([{ error: { message: "outside window", code: 10, error_subcode: 2018278, type: "OAuthException" } }], 400);
    const err = await facebookPageProvider.sendReply!(tokens, { accountExternalId: "PAGE1", conversationType: "DM", providerThreadId: "dm:P", participantExternalId: "P", text: "late", idempotencyKey: "k" }).catch((e) => e);
    expect(err).toMatchObject({ kind: "permanent" });
    expect(err.message).toMatch(/24 hours/);
  });

  it("hides / unhides comments and marks Messenger threads seen (comments have no read state)", async () => {
    reply([{ success: true }, { success: true }, { success: true }]);
    await facebookPageProvider.hideComment!(tokens, { providerMessageId: "POST1_C1", hidden: true });
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/POST1_C1");
    expect(calls[0]!.body).toMatchObject({ is_hidden: true });
    await facebookPageProvider.markRead!(tokens, { providerThreadId: "dm:PSID1" });
    expect(calls[1]!.body).toMatchObject({ recipient: { id: "PSID1" }, sender_action: "mark_seen" });
    await facebookPageProvider.markRead!(tokens, { providerThreadId: "c:POST1_C1" });
    expect(calls).toHaveLength(2);
  });

  it("subscribes the Page to webhook fields (falling back to feed+messages), and removes the subscription on disconnect", async () => {
    reply([{ success: true }]);
    expect(await facebookPageProvider.onConnected!(tokens, { externalAccountId: "PAGE1", displayName: "A" })).toEqual({});
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v25.0/PAGE1/subscribed_apps");
    expect(calls[0]!.body).toMatchObject({ subscribed_fields: "feed,messages,mention,ratings" });
    reply([{ error: { message: "bad field", code: 100 } }, { success: true }], 400);
    metaHttp.fetch = (async (url: string, init: RequestInit) => { calls.push({ url, method: init.method!, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify(calls.length === 1 ? { error: { message: "bad field", code: 100 } } : { success: true }), { status: calls.length === 1 ? 400 : 200 }); }) as typeof fetch;
    calls = [];
    expect(await facebookPageProvider.onConnected!(tokens, { externalAccountId: "PAGE1", displayName: "A" })).toEqual({});
    expect(calls.map((c) => c.body!.subscribed_fields)).toEqual(["feed,messages,mention,ratings", "feed,messages"]);
    reply([{ error: { message: "nope", code: 100 } }, { error: { message: "nope", code: 100 } }], 400);
    metaHttp.fetch = (async () => new Response(JSON.stringify({ error: { message: "nope", code: 100 } }), { status: 400 })) as typeof fetch;
    expect((await facebookPageProvider.onConnected!(tokens, { externalAccountId: "PAGE1", displayName: "A" })).warnings![0]).toMatch(/webhooks/);
    reply([{ success: true }]);
    await facebookPageProvider.onDisconnect!(tokens, { externalAccountId: "PAGE1" });
    expect(calls[0]).toMatchObject({ method: "DELETE" });
  });

  it("health: validates the token through /debug_token with the app token and checks permissions", async () => {
    const dbg = (data: Record<string, unknown>) => ({ data });
    reply([dbg({ is_valid: true, expires_at: 0, data_access_expires_at: 1900000000, scopes: ["pages_manage_posts", "pages_manage_engagement", "pages_read_engagement", "pages_messaging"] })]);
    const ok = await facebookPageProvider.healthCheck(tokens);
    expect(ok).toEqual({ ok: true, expiresAt: new Date(1900000000 * 1000).toISOString() });
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe("/v25.0/debug_token");
    expect(u.searchParams.get("input_token")).toBe(TOKEN);
    expect(u.searchParams.get("access_token")).toBe("APPID|app-secret-0123456789abcdef");
    reply([dbg({ is_valid: true, expires_at: 0, data_access_expires_at: 0, scopes: ["pages_manage_posts", "pages_manage_engagement", "pages_read_engagement"] })]);
    expect(await facebookPageProvider.healthCheck(tokens)).toEqual({ ok: true, expiresAt: null }); // "never expires"
    reply([dbg({ is_valid: false, error: { message: `Session invalidated ${TOKEN}` } })]);
    const bad = await facebookPageProvider.healthCheck(tokens);
    expect(bad.ok).toBe(false);
    expect(bad.error).not.toContain(TOKEN);
    reply([dbg({ is_valid: true, scopes: ["pages_manage_posts"] })]);
    expect(await facebookPageProvider.healthCheck(tokens)).toMatchObject({ ok: false, error: expect.stringContaining("pages_manage_engagement") });
  });

  it("Page tokens cannot be refreshed — reconnect", async () => {
    await expect(facebookPageProvider.refreshToken(tokens)).rejects.toThrow(/reconnect/i);
  });

  it("polling backfill returns only new, non-Page items with stable ids and thread ids", async () => {
    reply([
      { data: [{ updated_time: "2026-10-14T10:00:00+0000", messages: { data: [{ id: "m_new", message: "hi", from: { id: "PSID1", name: "Ada" }, created_time: "2026-10-14T10:00:00+0000" }, { id: "m_page", message: "ours", from: { id: "PAGE1" }, created_time: "2026-10-14T10:00:01+0000" }, { id: "m_old", message: "old", from: { id: "PSID1" }, created_time: "2026-10-13T00:00:00+0000" }] } }] },
      { data: [{ id: "PAGE1_POST1", comments: { data: [{ id: "C1", message: "nice", from: { id: "U1", name: "G" }, created_time: "2026-10-14T10:05:00+0000" }, { id: "C2", message: "reply", from: { id: "U2" }, created_time: "2026-10-14T10:06:00+0000", parent: { id: "C1" } }] } }] },
    ]);
    const since = Date.parse("2026-10-14T00:00:00Z");
    const out = await facebookPageProvider.fetchInbox!(tokens, { accountExternalId: "PAGE1", cursor: String(since) });
    expect(out.events.map((e) => [e.providerMessageId, e.providerThreadId])).toEqual([["m_new", "dm:PSID1"], ["C1", "c:C1"], ["C2", "c:C1"]]);
    expect(calls[0]!.url).toContain("/PAGE1/conversations?");
    expect(Number(out.nextCursor)).toBeGreaterThan(0);
    expect(Number(out.nextCursor)).toBeLessThanOrEqual(Date.now());
    expect(since).toBeGreaterThan(0);
  });

  it("GET calls carry token + appsecret_proof in the query; the proof is a correct HMAC", () => {
    const url = new URL(buildUrl({ method: "GET", path: "/PAGE1", token: TOKEN, phase: "read", query: { fields: "id,name" } }));
    expect(url.searchParams.get("access_token")).toBe(TOKEN);
    expect(url.searchParams.get("appsecret_proof")).toBe(createHmac("sha256", SECRET).update(TOKEN).digest("hex"));
    expect(appSecretProof(TOKEN, SECRET)).toBe(url.searchParams.get("appsecret_proof"));
  });
});

describe("misc", () => {
  it("builds post permalinks", () => {
    expect(postUrl("PAGE1_POST7")).toBe("https://www.facebook.com/PAGE1/posts/POST7");
    expect(postUrl("123")).toBe("https://www.facebook.com/123");
  });
  it("constraints: single photo, link allowed", () => {
    expect(facebookPageProvider.getConstraints()).toMatchObject({ maxChars: 63206, maxMedia: 1, supportsLink: true });
  });
  it("setup guidance never contains secret values", () => {
    const setup = providerSetup("meta_facebook")!;
    const blob = JSON.stringify(setup);
    expect(blob).not.toContain("verify-token-xyz");
    expect(blob).not.toContain("app-secret-0123456789abcdef");
    expect(setup).toMatchObject({ configured: true, verifyTokenConfigured: true, apiVersion: "v25.0" });
    expect(setup.webhookCallbackUrl).toMatch(/\/api\/v1\/social\/webhooks\/meta_facebook$/);
    expect(providerSetup("linkedin")).toBeNull();
  });
});
