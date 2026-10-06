/**
 * LinkedIn connector (personal profiles; company pages need extra scopes/approval and are out of scope).
 * OAuth 2.0 authorization-code flow + OpenID Connect profile + Posts API publishing (text / link / one image).
 * All request shaping lives in linkedinApi.ts (pure, fixture-tested). This file only performs the I/O.
 * No retries here: the publisher owns retry policy. No token is ever logged or included in an error message.
 */
import { config } from "../../../config/env";
import { redactSecrets, type SocialTokenSet } from "../tokenVault";
import { SocialPublishError } from "../publishing/publishErrors";
import {
  LINKEDIN, buildAuthUrl, buildImageInitBody, buildPostBody, errorFromNetwork, errorFromResponse, personUrn, postUrnFromResponse, restHeaders, tokenRequestBody, validatePublishInput,
} from "./linkedinApi";
import { ConnectorNotImplementedError, DEFAULT_CONSTRAINTS, type ConnectResult, type HealthResult, type PublishInput, type PublishResult, type SocialConnector, type SocialProfile } from "./types";

const TIMEOUT_MS = 20_000;

/** Overridable in tests (never real network in CI). */
export const linkedinHttp: { fetch: typeof fetch } = { fetch: (...args) => fetch(...args) };

async function call(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await linkedinHttp.fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const creds = () => ({ clientId: config.linkedinClientId, clientSecret: config.linkedinClientSecret });

async function exchange(body: string): Promise<SocialTokenSet> {
  let res: Response;
  try {
    res = await call(LINKEDIN.tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  } catch (err) {
    throw new Error(`LinkedIn token request failed (${(err as Error).name}).`);
  }
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`LinkedIn rejected the token request (HTTP ${res.status}${json.error ? `, ${json.error}` : ""}).`);
  return {
    accessToken: json.access_token,
    ...(json.refresh_token ? { refreshToken: json.refresh_token } : {}),
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null,
    scopes: json.scope ? json.scope.split(/[ ,]+/).filter(Boolean) : [...LINKEDIN.scopes],
  };
}

async function userInfo(accessToken: string): Promise<{ sub: string; name?: string; picture?: string }> {
  const res = await call(LINKEDIN.userInfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`LinkedIn profile request failed (HTTP ${res.status}).`);
  const json = (await res.json()) as { sub?: string; name?: string; picture?: string };
  if (!json.sub) throw new Error("LinkedIn did not return a member id.");
  return { sub: json.sub, name: json.name, picture: json.picture };
}

const toProfile = (u: { sub: string; name?: string; picture?: string }): SocialProfile => ({ externalAccountId: u.sub, displayName: u.name ?? "LinkedIn member", handle: null, avatarUrl: u.picture ?? null, accountType: "PROFILE" });

async function uploadImage(tokens: SocialTokenSet, owner: string, media: PublishInput["media"][number]): Promise<string> {
  const headers = restHeaders(tokens.accessToken, config.linkedinApiVersion);
  let init: Response;
  try {
    init = await call(LINKEDIN.imagesInitUrl, { method: "POST", headers, body: JSON.stringify(buildImageInitBody(owner)) });
  } catch (err) {
    throw errorFromNetwork(err, "before_post"); // nothing is published yet, so a failure here is always safe to retry
  }
  if (!init.ok) throw errorFromResponse(init.status, init.headers.get("retry-after"));
  const value = ((await init.json().catch(() => ({}))) as { value?: { uploadUrl?: string; image?: string } }).value;
  if (!value?.uploadUrl || !value.image) throw new SocialPublishError("permanent", "LinkedIn did not return an image upload URL.");
  const bytes = await media.load();
  let put: Response;
  try {
    put = await call(value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": media.mimeType }, body: new Uint8Array(bytes) });
  } catch (err) {
    throw errorFromNetwork(err, "before_post");
  }
  if (!put.ok) throw errorFromResponse(put.status, put.headers.get("retry-after"));
  return value.image;
}

export const linkedinProvider: SocialConnector = {
  key: "linkedin",
  label: "LinkedIn",
  implemented: true,
  defaultScopes: [...LINKEDIN.scopes],
  isConfigured: () => !!config.linkedinClientId && !!config.linkedinClientSecret,
  getConstraints: () => ({ ...DEFAULT_CONSTRAINTS, maxChars: 3000, maxHashtags: 5, maxMedia: 1, allowedMediaTypes: ["image/jpeg", "image/png", "image/gif"], supportsLink: true }),

  getAuthUrl: ({ state, redirectUri, scopes }) => buildAuthUrl({ clientId: config.linkedinClientId, redirectUri, state, scopes }),

  async handleCallback({ code, redirectUri }): Promise<ConnectResult> {
    const tokens = await exchange(tokenRequestBody({ code, redirectUri }, creds()));
    return { profile: toProfile(await userInfo(tokens.accessToken)), tokens };
  },

  async refreshToken(tokens: SocialTokenSet): Promise<SocialTokenSet> {
    if (!tokens.refreshToken) throw new Error("LinkedIn did not issue a refresh token for this connection; please reconnect.");
    const next = await exchange(tokenRequestBody({ refreshToken: tokens.refreshToken }, creds()));
    return { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken };
  },

  async getProfile(tokens: SocialTokenSet): Promise<SocialProfile> {
    return toProfile(await userInfo(tokens.accessToken));
  },

  async healthCheck(tokens: SocialTokenSet): Promise<HealthResult> {
    try {
      await userInfo(tokens.accessToken);
      return { ok: true, expiresAt: (tokens.expiresAt as string | null | undefined) ?? null };
    } catch (err) {
      return { ok: false, error: redactSecrets(err, [tokens.accessToken]).slice(0, 200) };
    }
  },

  // The LinkedIn inbox APIs are restricted to approved partners: not supported by this connector.
  verifyWebhook: () => { throw new ConnectorNotImplementedError("LinkedIn", "webhook verification"); },
  parseWebhook: () => { throw new ConnectorNotImplementedError("LinkedIn", "webhook parsing"); },
  fetchInbox: async () => { throw new ConnectorNotImplementedError("LinkedIn", "inbox polling"); },
  sendReply: async () => { throw new ConnectorNotImplementedError("LinkedIn", "sending replies"); },
  hideComment: async () => { throw new ConnectorNotImplementedError("LinkedIn", "hiding comments"); },
  markRead: async () => { throw new ConnectorNotImplementedError("LinkedIn", "marking messages read"); },

  async publish(tokens: SocialTokenSet, input: PublishInput): Promise<PublishResult> {
    validatePublishInput(input);
    const author = personUrn(input.accountExternalId);
    const imageUrn = input.media[0] ? await uploadImage(tokens, author, input.media[0]) : null;
    const body = buildPostBody({ authorUrn: author, text: input.text, linkUrl: input.linkUrl, imageUrn, altText: input.media[0]?.altText });

    let res: Response;
    try {
      res = await call(LINKEDIN.postsUrl, { method: "POST", headers: restHeaders(tokens.accessToken, config.linkedinApiVersion), body: JSON.stringify(body) });
    } catch (err) {
      throw errorFromNetwork(err, "post");
    }
    if (!res.ok) {
      const hint = await res.text().then((t) => redactSecrets(t, [tokens.accessToken]).slice(0, 200)).catch(() => "");
      throw errorFromResponse(res.status, res.headers.get("retry-after"), hint);
    }
    const urn = postUrnFromResponse(res.status, res.headers);
    return { externalPostId: urn, externalUrl: LINKEDIN.postUrl(urn) };
  },
};
