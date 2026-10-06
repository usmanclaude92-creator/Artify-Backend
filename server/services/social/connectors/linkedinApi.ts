/**
 * LinkedIn request building + response classification, kept PURE (no I/O) so it can be contract-tested against fixtures
 * without a network. Endpoint shapes follow LinkedIn's Posts API (/rest/posts), Images API (/rest/images) and Sign In with
 * LinkedIn using OpenID Connect (/v2/userinfo).
 *
 * VERIFY BEFORE FIRST LIVE USE (written from knowledge; the official docs could not be fetched in the build environment):
 *   [ ] Linkedin-Version header value is still supported (LINKEDIN_API_VERSION)
 *   [ ] POST /rest/posts body fields + 201 with `x-restli-id` response header
 *   [ ] POST /rest/images?action=initializeUpload response `value.uploadUrl` / `value.image`
 *   [ ] "little text" reserved-character list for `commentary`
 *   [ ] OAuth scopes: openid profile w_member_social ("Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect" products)
 *   [ ] Token lifetime / whether refresh tokens are issued for this app
 */
import { SocialPublishError, classifyHttpStatus } from "../publishing/publishErrors";
import type { PublishInput } from "./types";

export const LINKEDIN = {
  authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
  tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
  userInfoUrl: "https://api.linkedin.com/v2/userinfo",
  postsUrl: "https://api.linkedin.com/rest/posts",
  imagesInitUrl: "https://api.linkedin.com/rest/images?action=initializeUpload",
  scopes: ["openid", "profile", "w_member_social"],
  postUrl: (urn: string) => `https://www.linkedin.com/feed/update/${urn}/`,
} as const;

/** Characters with special meaning in LinkedIn's `commentary` ("little text") format. `#` is intentionally kept so hashtags work. */
const RESERVED = /[\\|{}@[\]()<>*_~]/g;
export const escapeCommentary = (text: string): string => text.replace(RESERVED, (c) => `\\${c}`);

export function restHeaders(accessToken: string, apiVersion: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, "Linkedin-Version": apiVersion, "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json" };
}

export const personUrn = (sub: string) => `urn:li:person:${sub}`;

export function buildAuthUrl(p: { clientId: string; redirectUri: string; state: string; scopes?: string[] }): string {
  const q = new URLSearchParams({ response_type: "code", client_id: p.clientId, redirect_uri: p.redirectUri, state: p.state, scope: (p.scopes?.length ? p.scopes : [...LINKEDIN.scopes]).join(" ") });
  return `${LINKEDIN.authorizeUrl}?${q.toString()}`;
}

export const tokenRequestBody = (grant: { code: string; redirectUri: string } | { refreshToken: string }, creds: { clientId: string; clientSecret: string }): string =>
  new URLSearchParams(
    "code" in grant
      ? { grant_type: "authorization_code", code: grant.code, redirect_uri: grant.redirectUri, client_id: creds.clientId, client_secret: creds.clientSecret }
      : { grant_type: "refresh_token", refresh_token: grant.refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret }
  ).toString();

export function buildImageInitBody(ownerUrn: string) {
  return { initializeUploadRequest: { owner: ownerUrn } };
}

export interface PostBodyInput {
  authorUrn: string;
  text: string;
  linkUrl?: string | null;
  /** Image URN from the Images API (at most one is supported for now). */
  imageUrn?: string | null;
  altText?: string | null;
}

/** Builds the POST /rest/posts body for a text, link (article) or single-image post. Image wins over link (LinkedIn allows one content type). */
export function buildPostBody(i: PostBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    author: i.authorUrn,
    commentary: escapeCommentary(i.text),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (i.imageUrn) body.content = { media: { id: i.imageUrn, ...(i.altText ? { altText: i.altText.slice(0, 4086) } : {}) } };
  else if (i.linkUrl) {
    let title = i.linkUrl;
    try { title = new URL(i.linkUrl).hostname; } catch { /* keep raw */ }
    body.content = { article: { source: i.linkUrl, title } };
  }
  return body;
}

export function validatePublishInput(input: PublishInput): void {
  if (!input.text.trim()) throw new SocialPublishError("permanent", "The post text is empty.");
  if (input.media.length > 1) throw new SocialPublishError("permanent", "LinkedIn publishing currently supports one image per post.");
  if (input.media[0] && !["image/jpeg", "image/png", "image/gif"].includes(input.media[0].mimeType)) throw new SocialPublishError("permanent", "LinkedIn supports JPEG, PNG or GIF images.");
}

const retryAfter = (h: string | null | undefined): number | undefined => {
  const n = Number(h);
  return Number.isFinite(n) && n > 0 ? Math.min(n * 1000, 3600_000) : undefined;
};

/** Turns an HTTP error response (the request definitely reached LinkedIn) into a classified error. Bodies are never echoed back verbatim. */
export function errorFromResponse(status: number, retryAfterHeader: string | null | undefined, bodyHint?: string): SocialPublishError {
  const kind = classifyHttpStatus(status);
  const base = kind === "auth" ? "LinkedIn rejected the credentials" : kind === "transient" ? "LinkedIn is temporarily unavailable or rate limiting" : "LinkedIn rejected the post";
  const hint = bodyHint ? `: ${bodyHint.replace(/\s+/g, " ").slice(0, 160)}` : "";
  return new SocialPublishError(kind, `${base} (HTTP ${status})${hint}`, { httpStatus: status, retryAfterMs: retryAfter(retryAfterHeader) });
}

/**
 * Classifies a failure where NO response was received. A refused/unresolvable connection means nothing was sent (transient);
 * an abort/timeout/reset after connecting means the request may have been processed (uncertain).
 */
export function errorFromNetwork(err: unknown, phase: "before_post" | "post"): SocialPublishError {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code;
  const name = (err as { name?: string })?.name;
  if (phase === "before_post") return new SocialPublishError("transient", `Network error before publishing (${code ?? name ?? "unknown"}).`);
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") return new SocialPublishError("transient", `Could not reach LinkedIn (${code}).`);
  return new SocialPublishError("uncertain", `No response from LinkedIn after sending (${code ?? name ?? "timeout"}); the post may have been published.`);
}

/** Extracts the post URN from a successful create response. Missing id on a 2xx is itself UNCERTAIN (it was probably created). */
export function postUrnFromResponse(status: number, headers: { get(name: string): string | null }): string {
  const id = headers.get("x-restli-id") ?? headers.get("x-linkedin-id");
  if (status >= 200 && status < 300 && id) return decodeURIComponent(id);
  throw new SocialPublishError("uncertain", `LinkedIn answered HTTP ${status} without a post id; the post may have been published.`, { httpStatus: status });
}
