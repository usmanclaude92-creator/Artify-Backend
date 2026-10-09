/**
 * Instagram connector contract tests: webhook parsing, constraints, the publish state machine (container → poll → media_publish),
 * container errors, the UNCERTAIN path, the messaging window, replies and the connect picker. Fixtures are HAND-AUTHORED from Meta's
 * documentation (tests/fixtures/instagram/README.md) — not recordings. No real network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import webhooks from "../fixtures/instagram/webhooks.json";

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config, metaAppId: "APPID", metaAppSecret: "app-secret-0123456789abcdef", metaWebhookVerifyToken: "verify-token-xyz", metaApiVersion: "v25.0", metaInstagramLoginScopes: "", instagramDailyPublishLimit: 50 } };
});
import { config } from "../../server/config/env";
import { metaHttp } from "../../server/services/social/connectors/metaGraph";
import { instagramProvider, instagramReplyWindow, instagramScopes, parseWebhookPayload } from "../../server/services/social/connectors/instagramProvider";
import { providerSetup } from "../../server/services/social/connectors/setupInfo";
import { runGuardrails, type GuardrailInput } from "../../server/services/social/guardrails";
import { ConnectorUserError, type PublishInput, type PublishMedia } from "../../server/services/social/connectors/types";
import { SocialPublishError } from "../../server/services/social/publishing/publishErrors";

const TOKEN = "IG_PAGE_TOKEN_SECRET_VALUE";
const tokens = { accessToken: TOKEN, pageId: "PAGE1", igId: "IG1" };
const mutable = config as unknown as Record<string, unknown>;

interface Call { path: string; method: string; body: Record<string, unknown> | null; query: URLSearchParams }
const calls: Call[] = [];
let behaviour: (c: Call) => { status?: number; body: unknown } | Error;
const original = metaHttp.fetch;
beforeEach(() => {
  calls.length = 0;
  behaviour = () => ({ body: {} });
  metaHttp.fetch = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const call: Call = { path: u.pathname.replace(/^\/v25\.0/, ""), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null, query: u.searchParams };
    calls.push(call);
    const r = behaviour(call);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
});
afterEach(() => { metaHttp.fetch = original; });

const img = (id = "m1", over: Partial<PublishMedia> = {}): PublishMedia => ({ mediaId: id, mimeType: "image/jpeg", sizeBytes: 1_000_000, load: async () => Buffer.alloc(0), signedUrl: async () => `https://signed.example/${id}.jpg?sig=1`, ...over });
const makeInput = (over: Partial<PublishInput> = {}): PublishInput & { saved: Array<Record<string, unknown> | null> } => {
  const saved: Array<Record<string, unknown> | null> = [];
  const input = { accountExternalId: "IG1", text: "Hello Instagram", media: [img()], idempotencyKey: "k", attempt: 1, state: null, saveState: async (s: Record<string, unknown> | null) => { saved.push(s); }, ...over } as PublishInput;
  return Object.assign(input, { saved });
};
const errBody = (code: number, extra: Record<string, unknown> = {}) => ({ error: { message: "m", type: "OAuthException", code, fbtrace_id: "T1", ...extra } });
const rejection = async (p: Promise<unknown>) => p.then(() => { throw new Error("expected rejection"); }, (e: unknown) => e as SocialPublishError);

describe("constraints (from the documentation)", () => {
  it("requires JPEG media, caps captions and carousels, and offers no links", () => {
    expect(instagramProvider.getConstraints()).toMatchObject({ maxChars: 2200, maxHashtags: 30, maxMedia: 10, requiresMedia: true, supportsLink: false, allowedMediaTypes: ["image/jpeg"] });
    expect(instagramProvider.getConstraints().mediaLimits).toEqual({ imageMaxBytes: 8 * 1024 * 1024, imageMinWidth: 320, imageMinRatio: 0.8, imageMaxRatio: 1.91 });
    expect(instagramProvider.getConstraints().notes?.join(" ")).toMatch(/JPEG/);
    expect(instagramProvider.dailyPublishCap).toBe(50);
  });
  it("requests only the documented permissions by default; META_INSTAGRAM_LOGIN_SCOPES overrides", () => {
    expect(instagramScopes()).toEqual(["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "instagram_manage_messages", "pages_show_list", "pages_read_engagement"]);
    mutable.metaInstagramLoginScopes = "instagram_basic,pages_show_list";
    expect(instagramScopes()).toEqual(["instagram_basic", "pages_show_list"]);
    expect(new URL(instagramProvider.getAuthUrl({ state: "s", redirectUri: "https://x/cb" })).searchParams.get("scope")).toBe("instagram_basic,pages_show_list");
    mutable.metaInstagramLoginScopes = "";
  });
  it("has setup guidance without secrets", () => {
    const s = providerSetup("meta_instagram")!;
    expect(s).toMatchObject({ provider: "meta_instagram", webhookObject: "instagram", webhookFields: ["comments", "messages", "mentions"], dailyPublishLimit: 50 });
    expect(s.webhookCallbackUrl).toMatch(/\/api\/v1\/social\/webhooks\/meta_instagram$/);
    expect(s.prerequisites.join(" ")).toMatch(/Business or Creator/);
    expect(JSON.stringify(s)).not.toContain("app-secret-0123456789abcdef");
  });
});

describe("guardrails for Instagram", () => {
  const input = (over: Partial<GuardrailInput> = {}): GuardrailInput => ({
    targets: [{ socialAccountId: "a", label: "@artify", text: "A caption", constraints: instagramProvider.getConstraints() }], fallbackText: "A caption", mediaCount: 1,
    hasSourceContent: false, brandVoice: { bannedWords: [], requiredDisclaimers: [] }, recentBodies: [], ...over,
  });
  it("rejects a text-only post with a clear message", () => {
    const r = runGuardrails(input({ mediaCount: 0 }));
    expect(r.passed).toBe(false);
    expect(r.issues.find((i) => i.rule === "media_required")?.message).toMatch(/requires an image/);
  });
  it("rejects PNG, oversize, too-narrow and out-of-range ratio images; accepts a good JPEG", () => {
    expect(runGuardrails(input({ media: [{ mimeType: "image/png" }] })).issues.some((i) => i.rule === "media_type_unsupported")).toBe(true);
    expect(runGuardrails(input({ media: [{ mimeType: "image/jpeg", sizeBytes: 9 * 1048576 }] })).issues.some((i) => i.rule === "media_too_large")).toBe(true);
    expect(runGuardrails(input({ media: [{ mimeType: "image/jpeg", width: 200, height: 200 }] })).issues.some((i) => i.rule === "media_dimensions")).toBe(true);
    expect(runGuardrails(input({ media: [{ mimeType: "image/jpeg", width: 2000, height: 600 }] })).issues.some((i) => i.rule === "media_dimensions")).toBe(true); // 3.33:1
    expect(runGuardrails(input({ media: [{ mimeType: "image/jpeg", width: 600, height: 1200 }] })).issues.some((i) => i.rule === "media_dimensions")).toBe(true); // 1:2
    expect(runGuardrails(input({ media: [{ mimeType: "image/jpeg", sizeBytes: 2_000_000, width: 1080, height: 1350 }] })).passed).toBe(true); // 4:5
    expect(runGuardrails(input({ media: [{ mimeType: "image/jpeg", width: 1080, height: 566 }] })).passed).toBe(true); // 1.91:1
  });
  it("limits carousels to 10 images and warns about links", () => {
    expect(runGuardrails(input({ mediaCount: 11 })).issues.some((i) => i.rule === "too_much_media")).toBe(true);
    expect(runGuardrails(input({ linkUrl: "https://artifysols.com" })).issues.find((i) => i.rule === "invalid_link")).toMatchObject({ severity: "warn" });
  });
});

describe("webhook parsing", () => {
  it("parses a comment into a COMMENT event with stable ids", () => {
    expect(parseWebhookPayload(webhooks.commentAdd)).toEqual([{
      type: "COMMENT", accountExternalId: "IG1", providerThreadId: "c:C1", providerMessageId: "C1", participant: { externalId: "U100", handle: "ada", name: "ada" },
      text: "Love this! Where can I buy it?", subjectRef: "MEDIA1", createdAt: new Date(1760000000 * 1000).toISOString(),
    }]);
  });
  it("keeps replies in their parent comment's thread", () => {
    expect(parseWebhookPayload(webhooks.commentReply)[0]).toMatchObject({ providerThreadId: "c:C1", providerMessageId: "C2" });
  });
  it("ignores our own comments, other fields and non-instagram objects", () => {
    expect(parseWebhookPayload(webhooks.ownComment)).toEqual([]);
    expect(parseWebhookPayload(webhooks.otherFieldAndObject)).toEqual([]);
    expect(parseWebhookPayload(webhooks.notInstagram)).toEqual([]);
    expect(parseWebhookPayload({} as never)).toEqual([]);
  });
  it("parses DMs, skipping echoes and read receipts, and labels attachments", () => {
    expect(parseWebhookPayload(webhooks.messageText)).toEqual([{
      type: "DM", accountExternalId: "IG1", providerThreadId: "dm:IGSID1", providerMessageId: "mid_abc", participant: { externalId: "IGSID1" }, text: "hello, is this in stock?", createdAt: new Date(1760000400000).toISOString(),
    }]);
    const events = parseWebhookPayload(webhooks.messageEchoAndAttachment);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ providerMessageId: "mid_att", text: "[attachment]", providerThreadId: "dm:IGSID2" });
  });
  it("fails closed on bad signatures and never throws on garbage", () => {
    expect(instagramProvider.verifyWebhook!({ rawBody: Buffer.from("{}"), headers: {} })).toBe(false);
    expect(instagramProvider.verifyWebhook!({ rawBody: Buffer.from("{}"), headers: { "x-hub-signature-256": "sha256=" + "0".repeat(64) } })).toBe(false);
    expect(instagramProvider.parseWebhook!({ rawBody: Buffer.from("not json") })).toEqual([]);
    expect(instagramProvider.handleWebhookChallenge!({ query: { "hub.mode": "subscribe", "hub.verify_token": "verify-token-xyz", "hub.challenge": "42" } })).toBe("42");
    expect(instagramProvider.handleWebhookChallenge!({ query: { "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" } })).toBeNull();
  });
});

describe("messaging window", () => {
  const last = new Date("2026-10-14T10:00:00Z");
  it("is open for 24 hours after the person's last message and closed after", () => {
    expect(instagramReplyWindow(last, new Date("2026-10-15T10:00:00Z")).open).toBe(true);
    const closed = instagramReplyWindow(last, new Date("2026-10-15T10:00:01Z"));
    expect(closed.open).toBe(false);
    expect(closed.reason).toMatch(/24 hours/);
    expect(instagramReplyWindow(null, new Date()).open).toBe(false);
    expect(instagramProvider.replyWindow!({ type: "COMMENT", lastInboundAt: last, now: new Date("2027-01-01T00:00:00Z") })).toEqual({ open: true, closesAt: null });
  });
});

describe("publish: at-most-once state machine", () => {
  const createdImage = (c: Call) => c.method === "POST" && c.path === "/IG1/media";
  const publishCalls = () => calls.filter((c) => c.path === "/IG1/media_publish");

  it("image: creates the container, sees FINISHED, publishes, and clears the saved state", async () => {
    behaviour = (c) => {
      if (createdImage(c)) return { body: { id: "CONT1" } };
      if (c.path === "/IG1/content_publishing_limit") return { body: { data: [{ quota_usage: 3, config: { quota_total: 100 } }] } };
      if (c.path === "/CONT1") return { body: { status_code: "FINISHED", id: "CONT1" } };
      if (c.path === "/IG1/media_publish") return { body: { id: "MEDIA9" } };
      if (c.path === "/MEDIA9") return { body: { permalink: "https://www.instagram.com/p/ABC/" } };
      return { body: {} };
    };
    const input = makeInput({ media: [img("m1", { altText: "A mug" })] });
    const res = await instagramProvider.publish!(tokens, input);
    expect(res).toEqual({ externalPostId: "MEDIA9", externalUrl: "https://www.instagram.com/p/ABC/" });
    const create = calls.find(createdImage)!;
    expect(create.body).toMatchObject({ image_url: "https://signed.example/m1.jpg?sig=1", caption: "Hello Instagram", alt_text: "A mug", access_token: TOKEN });
    expect(create.body).not.toHaveProperty("media_type");
    expect(publishCalls()).toHaveLength(1);
    expect(publishCalls()[0]!.body).toMatchObject({ creation_id: "CONT1" });
    expect(input.saved.map((s) => s?.phase ?? null)).toEqual(["container", "publishing", null]);
  });

  it("carousel: children first (is_carousel_item, no caption), then the parent with the caption", async () => {
    let n = 0;
    behaviour = (c) => {
      if (createdImage(c)) return { body: { id: c.body?.media_type === "CAROUSEL" ? "PARENT" : `CHILD${++n}` } };
      if (c.path === "/IG1/content_publishing_limit") return { body: { data: [] } };
      if (c.path === "/PARENT") return { body: { status_code: "FINISHED" } };
      if (c.path === "/IG1/media_publish") return { body: { id: "MEDIA10" } };
      return { body: {} };
    };
    const res = await instagramProvider.publish!(tokens, makeInput({ media: [img("a"), img("b"), img("c")] }));
    expect(res.externalPostId).toBe("MEDIA10");
    expect(res.externalUrl).toBeNull(); // permalink lookup is best effort
    const creates = calls.filter(createdImage);
    expect(creates).toHaveLength(4);
    for (const child of creates.slice(0, 3)) { expect(child.body).toMatchObject({ is_carousel_item: true }); expect(child.body).not.toHaveProperty("caption"); }
    expect(creates[3]!.body).toMatchObject({ media_type: "CAROUSEL", children: "CHILD1,CHILD2,CHILD3", caption: "Hello Instagram" });
    expect(publishCalls()[0]!.body).toMatchObject({ creation_id: "PARENT" });
  });

  it("reel: sends media_type REELS with a video_url", async () => {
    behaviour = (c) => {
      if (createdImage(c)) return { body: { id: "REEL1" } };
      if (c.path === "/REEL1") return { body: { status_code: "FINISHED" } };
      if (c.path === "/IG1/media_publish") return { body: { id: "MEDIA11" } };
      return { body: { data: [] } };
    };
    await instagramProvider.publish!(tokens, makeInput({ media: [img("v", { mimeType: "video/mp4", signedUrl: async () => "https://signed.example/v.mp4" })] }));
    expect(calls.find(createdImage)!.body).toMatchObject({ media_type: "REELS", video_url: "https://signed.example/v.mp4" });
  });

  it("container still IN_PROGRESS → pending (not a failure), state saved, nothing published", async () => {
    behaviour = (c) => (createdImage(c) ? { body: { id: "CONT2" } } : c.path === "/CONT2" ? { body: { status_code: "IN_PROGRESS" } } : { body: { data: [] } });
    const input = makeInput();
    const err = await rejection(instagramProvider.publish!(tokens, input));
    expect(err).toBeInstanceOf(SocialPublishError);
    expect(err).toMatchObject({ pending: true, retryAfterMs: 60_000 });
    expect(publishCalls()).toHaveLength(0);
    expect(input.saved[0]).toMatchObject({ phase: "container", containerId: "CONT2", kind: "image" });
  });

  it("a later attempt resumes from the saved container (no second container) and publishes when FINISHED", async () => {
    behaviour = (c) => {
      if (c.path === "/CONT2") return { body: { status_code: "FINISHED" } };
      if (c.path === "/IG1/media_publish") return { body: { id: "MEDIA12" } };
      return { body: {} };
    };
    const res = await instagramProvider.publish!(tokens, makeInput({ state: { phase: "container", containerId: "CONT2", kind: "image", createdAt: Date.now() - 120_000 } }));
    expect(res.externalPostId).toBe("MEDIA12");
    expect(calls.filter(createdImage)).toHaveLength(0);
  });

  it("gives up with a clear message when processing takes too long", async () => {
    behaviour = (c) => (c.path === "/CONT2" ? { body: { status_code: "IN_PROGRESS" } } : { body: {} });
    const input = makeInput({ state: { phase: "container", containerId: "CONT2", kind: "image", createdAt: Date.now() - 11 * 60_000 } });
    const err = await rejection(instagramProvider.publish!(tokens, input));
    expect(err).toMatchObject({ kind: "permanent", pending: false });
    expect(err.message).toMatch(/too long/);
    expect(input.saved.at(-1)).toBeNull();
  });

  it("container ERROR → permanent with Instagram's reason; EXPIRED → permanent 'retry'", async () => {
    behaviour = (c) => (c.path === "/CONT3" ? { body: { status_code: "ERROR", status: "Error: Media upload has failed with error code 2207026" } } : { body: {} });
    const err = await rejection(instagramProvider.publish!(tokens, makeInput({ state: { phase: "container", containerId: "CONT3", kind: "image", createdAt: Date.now() } })));
    expect(err).toMatchObject({ kind: "permanent" });
    expect(err.message).toMatch(/2207026/);
    behaviour = (c) => (c.path === "/CONT4" ? { body: { status_code: "EXPIRED" } } : { body: {} });
    const exp = await rejection(instagramProvider.publish!(tokens, makeInput({ state: { phase: "container", containerId: "CONT4", kind: "image", createdAt: Date.now() } })));
    expect(exp).toMatchObject({ kind: "permanent" });
    expect(exp.message).toMatch(/expired/);
  });

  it("container creation rejected by Instagram (bad image URL, code 9004 style) → permanent with error_user_msg, token never leaked", async () => {
    behaviour = (c) => (createdImage(c) ? { status: 400, body: errBody(9004, { error_subcode: 2207052, error_user_msg: `The media could not be fetched from the URI ${TOKEN}` }) } : { body: { data: [] } });
    const err = await rejection(instagramProvider.publish!(tokens, makeInput()));
    expect(err).toMatchObject({ kind: "permanent" });
    expect(err.message).toMatch(/media could not be fetched/);
    expect(err.message).not.toContain(TOKEN);
  });

  it("an unanswered container creation is retried safely (transient), because nothing is visible before media_publish", async () => {
    behaviour = (c) => (createdImage(c) ? Object.assign(new Error("fetch failed"), { name: "AbortError" }) : { body: { data: [] } });
    const err = await rejection(instagramProvider.publish!(tokens, makeInput()));
    expect(err).toMatchObject({ kind: "transient" });
    expect(publishCalls()).toHaveLength(0);
  });

  it("media_publish that gets no answer → UNCERTAIN, with the intent saved so it can never be re-sent", async () => {
    behaviour = (c) => {
      if (c.path === "/CONT5") return { body: { status_code: "FINISHED" } };
      if (c.path === "/IG1/media_publish") return Object.assign(new Error("timeout"), { name: "AbortError" });
      return { body: {} };
    };
    const input = makeInput({ state: { phase: "container", containerId: "CONT5", kind: "image", createdAt: Date.now() } });
    const err = await rejection(instagramProvider.publish!(tokens, input));
    expect(err).toMatchObject({ kind: "uncertain" });
    expect(input.saved.at(-1)).toMatchObject({ phase: "publishing", containerId: "CONT5" });
    expect(publishCalls()).toHaveLength(1);

    // …and a second attempt with that saved intent refuses to call media_publish again.
    calls.length = 0;
    const again = await rejection(instagramProvider.publish!(tokens, makeInput({ state: { phase: "publishing", containerId: "CONT5", kind: "image", createdAt: Date.now() } })));
    expect(again).toMatchObject({ kind: "uncertain" });
    expect(calls).toHaveLength(0);
  });

  it("media_publish answering 500 is also UNCERTAIN (it may have been processed); a definite rejection is permanent and clears the state", async () => {
    const state = { phase: "container", containerId: "CONT6", kind: "image", createdAt: Date.now() };
    behaviour = (c) => (c.path === "/CONT6" ? { body: { status_code: "FINISHED" } } : c.path === "/IG1/media_publish" ? { status: 500, body: errBody(2) } : { body: {} });
    expect(await rejection(instagramProvider.publish!(tokens, makeInput({ state })))).toMatchObject({ kind: "uncertain" });
    behaviour = (c) => (c.path === "/CONT6" ? { body: { status_code: "FINISHED" } } : c.path === "/IG1/media_publish" ? { status: 400, body: errBody(100, { error_user_msg: "Invalid parameter" }) } : { body: {} });
    const input = makeInput({ state });
    expect(await rejection(instagramProvider.publish!(tokens, input))).toMatchObject({ kind: "permanent" });
    expect(input.saved.at(-1)).toBeNull();
  });

  it("media_publish rate limited (code 4) is a safe transient retry: the state goes back to 'container'", async () => {
    behaviour = (c) => (c.path === "/CONT7" ? { body: { status_code: "FINISHED" } } : c.path === "/IG1/media_publish" ? { status: 400, body: errBody(4) } : { body: {} });
    const input = makeInput({ state: { phase: "container", containerId: "CONT7", kind: "image", createdAt: Date.now() } });
    const err = await rejection(instagramProvider.publish!(tokens, input));
    expect(err).toMatchObject({ kind: "transient", retryAfterMs: 15 * 60_000 });
    expect(input.saved.at(-1)).toMatchObject({ phase: "container" });
  });

  it("stops before creating anything when the live publishing quota is exhausted", async () => {
    behaviour = (c) => (c.path === "/IG1/content_publishing_limit" ? { body: { data: [{ quota_usage: 50, config: { quota_total: 50 } }] } } : { body: {} });
    const err = await rejection(instagramProvider.publish!(tokens, makeInput()));
    expect(err).toMatchObject({ kind: "permanent" });
    expect(err.message).toMatch(/limit/);
    expect(calls.filter(createdImage)).toHaveLength(0);
  });

  it("rejects text-only, PNG, oversize and too-long captions before any network call", async () => {
    for (const bad of [makeInput({ media: [] }), makeInput({ media: [img("p", { mimeType: "image/png" })] }), makeInput({ media: [img("big", { sizeBytes: 9 * 1048576 })] }), makeInput({ text: "x".repeat(2201) })]) {
      expect(await rejection(instagramProvider.publish!(tokens, bad))).toMatchObject({ kind: "permanent" });
    }
    expect(calls).toHaveLength(0);
  });
});

describe("inbox actions", () => {
  it("replies to a comment via /{comment}/replies and to a DM via /{page}/messages with messaging_type RESPONSE (never a tag)", async () => {
    behaviour = (c) => (c.path.endsWith("/replies") ? { body: { id: "R1" } } : { body: { recipient_id: "IGSID1", message_id: "mid_out" } });
    expect(await instagramProvider.sendReply!(tokens, { accountExternalId: "IG1", conversationType: "COMMENT", providerThreadId: "c:C1", inReplyToProviderMessageId: "C1", text: "Thanks!", idempotencyKey: "k" })).toEqual({ providerMessageId: "R1" });
    expect(calls[0]).toMatchObject({ path: "/C1/replies", method: "POST", body: { message: "Thanks!" } });
    expect(await instagramProvider.sendReply!(tokens, { accountExternalId: "IG1", conversationType: "DM", providerThreadId: "dm:IGSID1", participantExternalId: "IGSID1", text: "Yes, in stock.", idempotencyKey: "k" })).toEqual({ providerMessageId: "mid_out" });
    expect(calls[1]).toMatchObject({ path: "/PAGE1/messages", body: { recipient: { id: "IGSID1" }, messaging_type: "RESPONSE", message: { text: "Yes, in stock." } } });
    expect(JSON.stringify(calls[1]!.body)).not.toMatch(/tag|HUMAN_AGENT/);
  });
  it("refuses DMs over 1000 bytes before calling Meta", async () => {
    const err = await rejection(instagramProvider.sendReply!(tokens, { accountExternalId: "IG1", conversationType: "DM", providerThreadId: "dm:1", participantExternalId: "1", text: "é".repeat(600), idempotencyKey: "k" }));
    expect(err).toMatchObject({ kind: "permanent" });
    expect(calls).toHaveLength(0);
  });
  it("hides a comment", async () => {
    await instagramProvider.hideComment!(tokens, { providerMessageId: "C1", hidden: true });
    expect(calls[0]).toMatchObject({ path: "/C1", method: "POST", body: { hide: true } });
  });
  it("classifies a closed messaging window from Meta as permanent with the 24-hour message", async () => {
    behaviour = () => ({ status: 400, body: errBody(10, { error_subcode: 2018278 }) });
    const err = await rejection(instagramProvider.sendReply!(tokens, { accountExternalId: "IG1", conversationType: "DM", providerThreadId: "dm:1", participantExternalId: "1", text: "hi", idempotencyKey: "k" }));
    expect(err).toMatchObject({ kind: "permanent" });
    expect(err.message).toMatch(/24 hours/);
  });
});

describe("connect", () => {
  const pagesResponse = (data: unknown[]) => (c: Call) => {
    if (c.path === "/oauth/access_token") return { body: { access_token: c.query.get("grant_type") === "fb_exchange_token" ? "LONG" : "SHORT" } };
    if (c.path === "/me/permissions") return { body: { data: ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "pages_show_list"].map((permission) => ({ permission, status: "granted" })) } };
    if (c.path === "/me/accounts") return { body: { data } };
    return { body: { id: "U1", name: "Owner" } };
  };
  it("lists only Pages that have a linked Instagram professional account and warns about missing permissions", async () => {
    behaviour = pagesResponse([
      { id: "P1", name: "Page One", access_token: "PT1", tasks: ["CREATE_CONTENT"], instagram_business_account: { id: "IG1", username: "artify", name: "Artify" } },
      { id: "P2", name: "No Instagram", access_token: "PT2" },
    ]);
    const r = await instagramProvider.handleCallback({ code: "c", redirectUri: "https://x/cb" });
    expect(r.selectable).toHaveLength(1);
    expect(r.selectable![0]).toMatchObject({ profile: { externalAccountId: "IG1", handle: "artify", accountType: "BUSINESS" }, tokens: { accessToken: "PT1", pageId: "P1", igId: "IG1" } });
    expect(r.selectable![0]!.warnings!.join(" ")).toMatch(/Direct messages are unavailable/);
  });
  it("falls back to connected_instagram_account when instagram_business_account is absent", async () => {
    behaviour = pagesResponse([{ id: "P1", name: "Page One", access_token: "PT1", connected_instagram_account: { id: "IG7", username: "viaconnected" } }]);
    const r = await instagramProvider.handleCallback({ code: "c", redirectUri: "https://x/cb" });
    expect(r.selectable![0]).toMatchObject({ profile: { externalAccountId: "IG7", handle: "viaconnected" }, tokens: { igId: "IG7" } });
  });
  it("explains what to do when no Page has an Instagram account, or no Page exists", async () => {
    behaviour = pagesResponse([{ id: "P2", name: "No Instagram", access_token: "PT2" }]);
    const none = await rejection(instagramProvider.handleCallback({ code: "c", redirectUri: "https://x/cb" }));
    expect(none).toBeInstanceOf(ConnectorUserError);
    expect(none.message).toMatch(/Business or Creator/);
    expect(none.message).toMatch(/shared 1 Page \(No Instagram\)/);
    expect(none.message).toMatch(/Edit settings/);
    behaviour = pagesResponse([]);
    expect(await rejection(instagramProvider.handleCallback({ code: "c", redirectUri: "https://x/cb" }))).toBeInstanceOf(ConnectorUserError);
  });
  it("merges the Page's webhook fields instead of replacing them", async () => {
    behaviour = (c) => (c.method === "GET" ? { body: { data: [{ id: "APPID", subscribed_fields: ["feed", "messages", "mention"] }] } } : { body: { success: true } });
    await instagramProvider.onConnected!(tokens, { externalAccountId: "IG1", displayName: "x" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0); // "messages" already subscribed → nothing to change
    behaviour = (c) => (c.method === "GET" ? { body: { data: [{ id: "APPID", subscribed_fields: ["feed", "mention"] }] } } : { body: { success: true } });
    calls.length = 0;
    await instagramProvider.onConnected!(tokens, { externalAccountId: "IG1", displayName: "x" });
    expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ subscribed_fields: "feed,mention,messages" });
  });
});
