/**
 * Listening connector contract tests (Step 10): Instagram `mentions` webhooks, id → content resolution, tag polling, mention replies;
 * Facebook visitor posts / `mention` / tagged / feed edges, rating summary, reply capability. Fixtures are HAND-AUTHORED from Meta's documentation
 * (tests/fixtures/listening/README.md), not recordings. No real network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ig from "../fixtures/listening/instagram.json";
import fb from "../fixtures/listening/facebook.json";

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config, metaAppId: "APPID", metaAppSecret: "app-secret-0123456789abcdef", metaWebhookVerifyToken: "verify-token-xyz", metaApiVersion: "v25.0" } };
});
import { metaHttp } from "../../server/services/social/connectors/metaGraph";
import { instagramProvider, parseWebhookPayload as parseIg } from "../../server/services/social/connectors/instagramProvider";
import { facebookPageProvider, parseWebhookPayload as parseFb, SUBSCRIBED_FIELDS_FULL } from "../../server/services/social/connectors/facebookPageProvider";
import { googleBusinessProvider } from "../../server/services/social/connectors/googleBusinessProvider";
import { connectorRegistry } from "../../server/services/social/connectors/registry";
import { SocialPublishError } from "../../server/services/social/publishing/publishErrors";

const igTokens = { accessToken: "IG_PAGE_TOKEN_SECRET", pageId: "PAGE1", igId: "IG1" };
const fbTokens = { accessToken: "FB_PAGE_TOKEN_SECRET", pageId: "PAGE1" };

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
const rejection = async (p: Promise<unknown>) => p.then(() => { throw new Error("expected rejection"); }, (e: unknown) => e as SocialPublishError);

describe("Instagram mentions", () => {
  it("parses the `mentions` webhook into id-only MENTION events (comment vs caption)", () => {
    const [c] = parseIg(ig.commentMention);
    expect(c).toMatchObject({ type: "MENTION", accountExternalId: "IG1", providerThreadId: "mc:17800000000000001", providerMessageId: "17800000000000001", subjectRef: "17900000000000001", text: "", lookup: { kind: "ig_comment", id: "17800000000000001" } });
    const [m] = parseIg(ig.captionMention);
    expect(m).toMatchObject({ type: "MENTION", providerThreadId: "mm:17900000000000002", providerMessageId: "17900000000000002", lookup: { kind: "ig_media", id: "17900000000000002" } });
    expect(parseIg(ig.emptyMention)).toEqual([]); // no ids: nothing to look up
  });

  it("resolves a comment mention through mentioned_comment and a caption mention through mentioned_media", async () => {
    behaviour = (c) => ({ body: c.query.get("fields")!.startsWith("mentioned_comment") ? ig.mentionedComment : ig.mentionedMedia });
    const c = await instagramProvider.resolveMention!(igTokens, { accountExternalId: "IG1", lookup: { kind: "ig_comment", id: "17800000000000001" } });
    expect(c).toMatchObject({ text: "Loving the new look @artifysols!", participant: { handle: "qa_fan" }, createdAt: "2026-10-08T10:00:00+0000" });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/IG1" });
    expect(calls[0]!.query.get("fields")).toBe("mentioned_comment.comment_id(17800000000000001){id,text,timestamp,username}");
    const m = await instagramProvider.resolveMention!(igTokens, { accountExternalId: "IG1", lookup: { kind: "ig_media", id: "17900000000000002" } });
    expect(m).toMatchObject({ text: "Thanks for the help @artifysols", permalink: "https://www.instagram.com/p/QA_TEST_1/" });
  });

  it("falls back to a smaller field list when Meta refuses a field, and says so with a placeholder text for caption-less media", async () => {
    behaviour = (c) => (c.query.get("fields")!.includes("permalink") ? { status: 400, body: { error: { message: "(#100) Tried accessing nonexisting field (permalink)", type: "OAuthException", code: 100, fbtrace_id: "T" } } } : { body: ig.mentionedMediaNoCaption });
    const m = await instagramProvider.resolveMention!(igTokens, { accountExternalId: "IG1", lookup: { kind: "ig_media", id: "17900000000000003" } });
    expect(calls).toHaveLength(2);
    expect(m).toMatchObject({ text: "[video that mentions you]", permalink: undefined });
  });

  it("returns null when Meta returns nothing, and never builds a field expression from a non-numeric id", async () => {
    behaviour = () => ({ body: { id: "IG1" } });
    expect(await instagramProvider.resolveMention!(igTokens, { accountExternalId: "IG1", lookup: { kind: "ig_comment", id: "17800000000000001" } })).toBeNull();
    calls.length = 0;
    expect(await instagramProvider.resolveMention!(igTokens, { accountExternalId: "IG1", lookup: { kind: "ig_comment", id: "1){id}&access_token=x" } })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("polling lists photo tags only (the documented list edge), newer than the cursor", async () => {
    behaviour = () => ({ body: ig.tags });
    const r = await instagramProvider.fetchMentions!(igTokens, { accountExternalId: "IG1", cursor: String(Date.parse("2026-10-05T00:00:00Z")) });
    expect(calls[0]).toMatchObject({ method: "GET", path: "/IG1/tags" });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ type: "MENTION", providerThreadId: "tag:17950000000000001", text: "Out with @artifysols", permalink: "https://www.instagram.com/p/QA_TEST_2/" });
  });

  it("replies to a mention through POST /{ig}/mentions; a photo tag cannot be answered and the UI is told to reply on Instagram", async () => {
    behaviour = () => ({ body: { id: "R1" } });
    const sent = await instagramProvider.sendReply!(igTokens, { accountExternalId: "IG1", conversationType: "MENTION", providerThreadId: "mc:17800000000000001", inReplyToProviderMessageId: "17800000000000001", subjectRef: "17900000000000001", text: "Thank you!", idempotencyKey: "k" });
    expect(sent).toEqual({ providerMessageId: "R1" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/IG1/mentions", body: { message: "Thank you!", media_id: "17900000000000001", comment_id: "17800000000000001" } });
    calls.length = 0;
    await instagramProvider.sendReply!(igTokens, { accountExternalId: "IG1", conversationType: "MENTION", providerThreadId: "mm:17900000000000002", inReplyToProviderMessageId: "17900000000000002", subjectRef: "17900000000000002", text: "Thanks", idempotencyKey: "k2" });
    expect(calls[0]!.body).toMatchObject({ message: "Thanks", media_id: "17900000000000002" });
    expect(calls[0]!.body).not.toHaveProperty("comment_id"); // caption mention: no comment_id
    const err = await rejection(instagramProvider.sendReply!(igTokens, { accountExternalId: "IG1", conversationType: "MENTION", providerThreadId: "tag:1", subjectRef: "1", text: "x", idempotencyKey: "k3" }));
    expect(err).toBeInstanceOf(SocialPublishError);
    expect(err.kind).toBe("permanent");
    expect(instagramProvider.replyCapability!({ type: "MENTION", providerThreadId: "mc:1" })).toEqual({ mode: "api" });
    expect(instagramProvider.replyCapability!({ type: "MENTION", providerThreadId: "tag:1" })).toMatchObject({ mode: "platform" });
  });
});

describe("Facebook visitor posts, mentions and tags", () => {
  it("turns a visitor post on the Page's timeline into a MENTION; the Page's own post, edits and unknown shapes are ignored", () => {
    expect(parseFb(fb.visitorPost)).toEqual([expect.objectContaining({ type: "MENTION", providerThreadId: "p:PAGE1_5001", providerMessageId: "PAGE1_5001", text: "Your support never answered me", participant: { externalId: "U300", name: "Grace Hopper" }, permalink: "https://www.facebook.com/PAGE1/posts/5001" })]);
    expect(parseFb(fb.ownPost)).toEqual([]);
    expect(parseFb(fb.editedPost)).toEqual([]);
    expect(parseFb(fb.photoNoText)[0]).toMatchObject({ type: "MENTION", text: "[photo on your Page without text]" });
  });

  it("accepts a feed-like `mention` payload defensively and skips one without ids", () => {
    expect(parseFb(fb.mention)).toEqual([expect.objectContaining({ type: "MENTION", providerThreadId: "m:U400_6001", text: "Try @Artify Solutions for this", permalink: "https://www.facebook.com/U400/posts/6001" })]);
    expect(parseFb(fb.mentionNoIds)).toEqual([]);
  });

  it("no longer subscribes to `ratings` (Meta stopped sending them in v22.0) but keeps `mention`", () => {
    expect(SUBSCRIBED_FIELDS_FULL.split(",")).toEqual(["feed", "messages", "mention"]);
  });

  it("polls /tagged and /feed, keeping posts by others that are newer than the cursor", async () => {
    behaviour = (c) => ({ body: c.path === "/PAGE1/tagged" ? fb.tagged : fb.feed });
    const r = await facebookPageProvider.fetchMentions!(fbTokens, { accountExternalId: "PAGE1", cursor: String(Date.parse("2026-10-01T00:00:00Z")) });
    expect(calls.map((c) => c.path)).toEqual(["/PAGE1/tagged", "/PAGE1/feed"]);
    expect(r.events.map((e) => e.providerThreadId)).toEqual(["t:U400_6001", "p:PAGE1_7002"]);
    expect(r.events[1]).toMatchObject({ permalink: "https://www.facebook.com/PAGE1/posts/7002", participant: { externalId: "U500" } });
  });

  it("treats a refused /tagged edge (permission or new-Pages limits) as empty, not as an error", async () => {
    behaviour = (c) => (c.path === "/PAGE1/tagged" ? { status: 400, body: fb.errorNonexistingField } : { body: fb.feed });
    const r = await facebookPageProvider.fetchMentions!(fbTokens, { accountExternalId: "PAGE1", cursor: String(Date.parse("2026-10-01T00:00:00Z")) });
    expect(r.events.map((e) => e.providerThreadId)).toEqual(["p:PAGE1_7002"]);
  });

  it("answers only visitor posts on the Page's own timeline (a comment on that post); tags and mentions elsewhere say 'reply on Facebook'", async () => {
    behaviour = () => ({ body: { id: "C1" } });
    expect(await facebookPageProvider.sendReply!(fbTokens, { accountExternalId: "PAGE1", conversationType: "MENTION", providerThreadId: "p:PAGE1_5001", inReplyToProviderMessageId: "PAGE1_5001", text: "Sorry about that", idempotencyKey: "k" })).toEqual({ providerMessageId: "C1" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/PAGE1_5001/comments", body: { message: "Sorry about that" } });
    const err = await rejection(facebookPageProvider.sendReply!(fbTokens, { accountExternalId: "PAGE1", conversationType: "MENTION", providerThreadId: "t:U400_6001", inReplyToProviderMessageId: "U400_6001", text: "x", idempotencyKey: "k2" }));
    expect(err.kind).toBe("permanent");
    expect(facebookPageProvider.replyCapability!({ type: "MENTION", providerThreadId: "p:1" })).toEqual({ mode: "api" });
    expect(facebookPageProvider.replyCapability!({ type: "MENTION", providerThreadId: "t:1" })).toMatchObject({ mode: "platform" });
    expect(facebookPageProvider.replyCapability!({ type: "REVIEW", providerThreadId: "r:1" })).toMatchObject({ mode: "platform", reason: expect.stringMatching(/v22\.0/) });
  });
});

describe("Facebook rating summary (null, never 0)", () => {
  it("returns the numbers when Facebook gives them", async () => {
    behaviour = () => ({ body: fb.rating });
    expect(await facebookPageProvider.fetchReviewSummary!(fbTokens, { accountExternalId: "PAGE1" })).toEqual({ averageRating: 4.6, reviewCount: 18 });
    expect(calls[0]!.query.get("fields")).toBe("overall_star_rating,rating_count");
  });
  it("returns null with the reason when the fields are absent or zero", async () => {
    behaviour = () => ({ body: fb.ratingNone });
    expect(await facebookPageProvider.fetchReviewSummary!(fbTokens, { accountExternalId: "PAGE1" })).toMatchObject({ averageRating: null, reviewCount: null, note: expect.stringMatching(/v22\.0/) });
    behaviour = () => ({ body: fb.ratingZero });
    expect(await facebookPageProvider.fetchReviewSummary!(fbTokens, { accountExternalId: "PAGE1" })).toMatchObject({ averageRating: null, reviewCount: null });
  });
  it("returns null with the reason when Facebook refuses the fields", async () => {
    behaviour = () => ({ status: 400, body: fb.errorNonexistingField });
    expect(await facebookPageProvider.fetchReviewSummary!(fbTokens, { accountExternalId: "PAGE1" })).toMatchObject({ averageRating: null, reviewCount: null, note: expect.stringMatching(/removed from the API in v22\.0/) });
  });
  it("lets transient errors surface (an outage is not a rating)", async () => {
    behaviour = () => ({ status: 503, body: { error: { message: "unavailable", code: 2, type: "OAuthException", is_transient: true } } });
    const err = await rejection(facebookPageProvider.fetchReviewSummary!(fbTokens, { accountExternalId: "PAGE1" }));
    expect(err.kind).not.toBe("permanent");
  });
});

describe("Google Business Profile fails closed", () => {
  it("is never configured or available, and every capability throws", async () => {
    expect(googleBusinessProvider.isConfigured()).toBe(false);
    expect(googleBusinessProvider.implemented).toBe(false);
    expect(connectorRegistry.getAvailable("google_business")).toBeUndefined();
    expect(connectorRegistry.list().find((p) => p.key === "google_business")).toMatchObject({ configured: false, available: false });
    await expect(googleBusinessProvider.fetchReviewSummary()).rejects.toThrow(/not supported|not implemented|approved/i);
    await expect(googleBusinessProvider.handleCallback({ code: "x", redirectUri: "y" } as never)).rejects.toThrow();
    expect(googleBusinessProvider.replyCapability()).toMatchObject({ mode: "platform" });
  });
});
