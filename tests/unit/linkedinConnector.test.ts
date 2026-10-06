/** LinkedIn contract tests: request building + response classification against hand-authored fixtures. NO real network. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtures from "../fixtures/linkedin/requests.json";

vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config, linkedinClientId: "cid", linkedinClientSecret: "csecret", linkedinApiVersion: "202504" } };
});
import { buildAuthUrl, buildImageInitBody, buildPostBody, errorFromNetwork, errorFromResponse, escapeCommentary, postUrnFromResponse, restHeaders, tokenRequestBody, validatePublishInput } from "../../server/services/social/connectors/linkedinApi";
import { linkedinHttp, linkedinProvider } from "../../server/services/social/connectors/linkedinProvider";
import { SocialPublishError } from "../../server/services/social/publishing/publishErrors";

describe("linkedin request builders (fixtures)", () => {
  it("builds the authorization URL", () => {
    const url = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "https://cc.example/social/accounts", state: "st" }));
    expect(`${url.origin}${url.pathname}`).toBe(fixtures.authUrl.base);
    expect(Object.fromEntries(url.searchParams)).toEqual(fixtures.authUrl.params);
  });
  it("builds the token exchange body", () => {
    expect(tokenRequestBody({ code: "thecode", redirectUri: "https://cc.example/social/accounts" }, { clientId: "cid", clientSecret: "csecret" })).toBe(fixtures.tokenExchange);
    expect(tokenRequestBody({ refreshToken: "rt" }, { clientId: "cid", clientSecret: "csecret" })).toContain("grant_type=refresh_token");
  });
  it("builds the REST headers", () => {
    expect(restHeaders("TOKEN", "202504")).toEqual(fixtures.headers);
  });
  it("builds a text post with escaped commentary, keeping hashtags", () => {
    expect(buildPostBody(fixtures.textPost.input)).toEqual(fixtures.textPost.body);
  });
  it("builds link and image posts", () => {
    expect(buildPostBody(fixtures.linkPost.input).content).toEqual(fixtures.linkPost.content);
    expect(buildPostBody(fixtures.imagePost.input).content).toEqual(fixtures.imagePost.content);
    // an image wins over a link (one content type per post)
    expect(buildPostBody({ ...fixtures.imagePost.input, linkUrl: "https://x.example" }).content).toEqual(fixtures.imagePost.content);
  });
  it("builds the image init body", () => {
    expect(buildImageInitBody("urn:li:person:abc123")).toEqual(fixtures.imageInit);
  });
  it("escapes every reserved character", () => {
    expect(escapeCommentary("a|b{c}d@e[f]g(h)i<j>k*l_m~n\\o #tag")).toBe("a\\|b\\{c\\}d\\@e\\[f\\]g\\(h\\)i\\<j\\>k\\*l\\_m\\~n\\\\o #tag");
  });
  it("rejects unsupported publish input before any request", () => {
    const base = { accountExternalId: "x", text: "hi", media: [], idempotencyKey: "k", attempt: 1 };
    expect(() => validatePublishInput({ ...base, text: "  " })).toThrow(SocialPublishError);
    const m = { mediaId: "1", mimeType: "image/jpeg", load: async () => Buffer.alloc(1) };
    expect(() => validatePublishInput({ ...base, media: [m, m] })).toThrow(/one image/);
    expect(() => validatePublishInput({ ...base, media: [{ ...m, mimeType: "video/mp4" }] })).toThrow(/JPEG/);
  });
});

describe("linkedin response classification", () => {
  it("maps HTTP errors", () => {
    expect(errorFromResponse(401, null).kind).toBe("auth");
    expect(errorFromResponse(403, null).kind).toBe("auth");
    expect(errorFromResponse(422, null, "duplicate").kind).toBe("permanent");
    const rl = errorFromResponse(429, "30");
    expect(rl).toMatchObject({ kind: "transient", httpStatus: 429, retryAfterMs: 30_000 });
    expect(errorFromResponse(503, null).kind).toBe("transient");
  });
  it("treats a connection that never opened as transient and a post-send abort as uncertain", () => {
    expect(errorFromNetwork({ cause: { code: "ECONNREFUSED" } }, "post").kind).toBe("transient");
    expect(errorFromNetwork({ name: "AbortError" }, "post").kind).toBe("uncertain");
    expect(errorFromNetwork({ cause: { code: "ECONNRESET" } }, "post").kind).toBe("uncertain");
    expect(errorFromNetwork({ name: "AbortError" }, "before_post").kind).toBe("transient");
  });
  it("reads the post URN from x-restli-id, and a 2xx without it is UNCERTAIN", () => {
    expect(postUrnFromResponse(201, new Headers({ "x-restli-id": "urn:li:share:123" }))).toBe("urn:li:share:123");
    expect(() => postUrnFromResponse(201, new Headers())).toThrowError(expect.objectContaining({ kind: "uncertain" }));
  });
});

describe("linkedin connector with a stubbed transport", () => {
  const original = linkedinHttp.fetch;
  let calls: Array<{ url: string; init: RequestInit }>;
  const respond = (queue: Array<Response | Error>) => {
    calls = [];
    linkedinHttp.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = queue.shift()!;
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch;
  };
  beforeEach(() => respond([]));
  afterEach(() => { linkedinHttp.fetch = original; });
  const tokens = { accessToken: "SECRET_ACCESS_TOKEN" };
  const input = { accountExternalId: "abc123", text: "Hello", media: [], idempotencyKey: "k1", attempt: 1 };

  it("publishes a text post and returns the URN + live URL", async () => {
    respond([new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:999" } })]);
    const out = await linkedinProvider.publish!(tokens, input);
    expect(out).toEqual({ externalPostId: "urn:li:share:999", externalUrl: "https://www.linkedin.com/feed/update/urn:li:share:999/" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.linkedin.com/rest/posts");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ author: "urn:li:person:abc123", commentary: "Hello" });
  });

  it("uploads one image (init → PUT) then posts it", async () => {
    respond([
      new Response(JSON.stringify({ value: { uploadUrl: "https://upload.example/u", image: "urn:li:image:IMG" } }), { status: 200 }),
      new Response("", { status: 201 }),
      new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:5" } }),
    ]);
    await linkedinProvider.publish!(tokens, { ...input, media: [{ mediaId: "m", mimeType: "image/png", altText: "alt", load: async () => Buffer.from("png") }] });
    expect(calls.map((c) => c.init.method)).toEqual(["POST", "PUT", "POST"]);
    expect(JSON.parse(String(calls[2]!.init.body)).content).toEqual({ media: { id: "urn:li:image:IMG", altText: "alt" } });
  });

  it("classifies failures and never leaks the token", async () => {
    respond([new Response("token SECRET_ACCESS_TOKEN rejected", { status: 401 })]);
    const err = await linkedinProvider.publish!(tokens, input).catch((e) => e);
    expect(err).toMatchObject({ kind: "auth", httpStatus: 401 });
    expect(String(err.message)).not.toContain("SECRET_ACCESS_TOKEN");
    respond([new Response("", { status: 429, headers: { "retry-after": "12" } })]);
    expect(await linkedinProvider.publish!(tokens, input).catch((e) => e)).toMatchObject({ kind: "transient", retryAfterMs: 12_000 });
    respond([new Response("bad", { status: 422 })]);
    expect(await linkedinProvider.publish!(tokens, input).catch((e) => e)).toMatchObject({ kind: "permanent" });
    respond([Object.assign(new Error("aborted"), { name: "AbortError" })]);
    expect(await linkedinProvider.publish!(tokens, input).catch((e) => e)).toMatchObject({ kind: "uncertain" });
  });

  it("a failed image upload step is safe to retry (nothing published yet)", async () => {
    respond([Object.assign(new Error("x"), { name: "AbortError" })]);
    const err = await linkedinProvider.publish!(tokens, { ...input, media: [{ mediaId: "m", mimeType: "image/png", load: async () => Buffer.from("x") }] }).catch((e) => e);
    expect(err.kind).toBe("transient");
  });

  it("exchanges an authorization code and reads the OIDC profile", async () => {
    respond([
      new Response(JSON.stringify({ access_token: "AT", expires_in: 5184000, scope: "openid,profile,w_member_social" }), { status: 200 }),
      new Response(JSON.stringify({ sub: "abc123", name: "Ada Lovelace", picture: "https://img.example/a.png" }), { status: 200 }),
    ]);
    const res = await linkedinProvider.handleCallback({ code: "thecode", redirectUri: "https://cc.example/social/accounts" });
    expect(res.profile).toMatchObject({ externalAccountId: "abc123", displayName: "Ada Lovelace", accountType: "PROFILE" });
    expect(res.tokens.accessToken).toBe("AT");
    expect(res.tokens.scopes).toEqual(["openid", "profile", "w_member_social"]);
    expect(calls[0]!.url).toBe("https://www.linkedin.com/oauth/v2/accessToken");
  });
});
