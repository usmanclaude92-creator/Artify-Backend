/**
 * Meta Graph API plumbing shared by every Meta connector (Facebook Pages today; Instagram plugs into the same client later).
 * Pure helpers (signature check, appsecret_proof, error classification, URL building) + one small transport that can be stubbed in tests.
 * No retries here: the publisher / inbox own retry policy. Tokens are sent in the query (GET) or JSON body (POST), never logged.
 *
 * Sources (developers.facebook.com). NOTE: the pages could not be fetched directly in the build environment (egress proxy);
 * these facts come from excerpts of the official pages returned by a domain-restricted search. Re-verify the [ ] items:
 *   - Manual login flow (dialog/oauth, code exchange):  /docs/facebook-login/guides/advanced/manual-flow/
 *   - Long-lived user + Page tokens:                    /docs/facebook-login/guides/access-tokens/get-long-lived/
 *   - Debug token:                                       /docs/graph-api/reference/debug_token/
 *   - Webhooks (verify token / X-Hub-Signature-256):     /documentation/business-messaging/messenger-platform/webhooks
 *   - Page webhooks + subscribed_apps:                   /docs/pages/realtime  ·  /docs/graph-api/webhooks
 *   - Rate limits (X-Page-Usage / X-App-Usage):          /docs/graph-api/overview/rate-limiting/
 *   - Graph API version in use: config.metaApiVersion (default v25.0, from the brief).
 *   [ ] appsecret_proof usage and the "Require App Secret" setting   [ ] exact error code list   [ ] JSON request bodies accepted on all POST edges
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../../../config/env";
import { redactSecrets } from "../tokenVault";
import { SocialPublishError } from "../publishing/publishErrors";

export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

export const graphBase = () => `https://graph.facebook.com/${config.metaApiVersion}`;
export const dialogUrl = () => `https://www.facebook.com/${config.metaApiVersion}/dialog/oauth`;

/** Overridable in tests (never real network in CI). */
export const metaHttp: { fetch: typeof fetch } = { fetch: (...args) => fetch(...args) };

/** `appsecret_proof` = HMAC-SHA256(access_token, app_secret), hex. Binds a token to our server. */
export const appSecretProof = (accessToken: string, appSecret: string): string => createHmac("sha256", appSecret).update(accessToken).digest("hex");

/** Constant-time check of `X-Hub-Signature-256: sha256=<hex>` computed over the RAW body with the app secret. Fails closed. */
export function verifySignature(rawBody: Buffer, header: string | string[] | undefined, appSecret: string): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (!appSecret || !value || !value.startsWith("sha256=")) return false;
  const given = value.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const provided = Buffer.from(given, "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** hub.challenge handshake: echo the challenge only for mode=subscribe with the exact verify token. Fails closed when no token is configured. */
export function webhookChallenge(query: Record<string, string | undefined>, verifyToken: string): string | null {
  const given = query["hub.verify_token"];
  if (!verifyToken || query["hub.mode"] !== "subscribe" || !given || !query["hub.challenge"]) return null;
  const a = Buffer.from(given);
  const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? query["hub.challenge"] : null;
}

export interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number; is_transient?: boolean; fbtrace_id?: string };
}

export type ErrorKind = "auth" | "transient" | "permanent";

/** Meta error codes → how the platform should react. Codes per the Graph API error reference; see the [ ] note in the header. */
export function classifyGraphError(status: number, body: GraphErrorBody | undefined): { kind: ErrorKind; code?: number; window?: boolean } {
  const e = body?.error;
  const code = e?.code;
  const sub = e?.error_subcode;
  if (sub === 2018278 || code === 2018278) return { kind: "permanent", code, window: true }; // message sent outside the allowed window
  if (code === 190 || code === 102 || status === 401) return { kind: "auth", code };
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) return { kind: "auth", code }; // permission missing / revoked
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code !== undefined && code >= 80000 && code <= 80014)) return { kind: "transient", code }; // rate limits
  if (e?.is_transient === true || code === 1 || code === 2 || status === 429 || status >= 500) return { kind: "transient", code };
  return { kind: "permanent", code }; // 100 (invalid parameter), 368 (policy block), 551 (recipient unavailable) and anything else
}

export function errorFromGraph(status: number, body: GraphErrorBody | undefined, secrets: Array<string | undefined> = []): SocialPublishError {
  const { kind, code, window } = classifyGraphError(status, body);
  const raw = body?.error?.message ?? "";
  const trace = body?.error?.fbtrace_id ? ` [trace ${body.error.fbtrace_id}]` : "";
  const msg = window
    ? "Meta only allows replying within 24 hours of the person's last message (messaging window closed)."
    : kind === "auth"
      ? "Meta rejected the Page credentials or permissions. Reconnect the Page and grant the requested permissions."
      : kind === "transient"
        ? "Meta is temporarily unavailable or rate limiting this Page."
        : `Meta rejected the request${code !== undefined ? ` (code ${code})` : ""}.`;
  const detail = kind === "permanent" || window ? ` ${redactSecrets(raw, secrets).replace(/\s+/g, " ").slice(0, 160)}` : "";
  return new SocialPublishError(kind, `${msg}${detail}${trace}`.trim(), { httpStatus: status, retryAfterMs: kind === "transient" && code !== undefined && [4, 17, 32, 613].includes(code) ? 15 * 60_000 : undefined });
}

/** No response was received. Before the request was sent → transient; after → the call may have been processed → uncertain. */
export function errorFromNetwork(err: unknown, phase: "read" | "write"): SocialPublishError {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code;
  const name = (err as { name?: string })?.name;
  if (phase === "read") return new SocialPublishError("transient", `Network error talking to Meta (${code ?? name ?? "unknown"}).`);
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") return new SocialPublishError("transient", `Could not reach Meta (${code}).`);
  return new SocialPublishError("uncertain", `No response from Meta after sending (${code ?? name ?? "timeout"}); the action may have been completed.`);
}

export interface GraphRequest {
  method: "GET" | "POST" | "DELETE";
  /** Path below the versioned base, e.g. `/me/accounts` or `/${pageId}/feed`. */
  path: string;
  token?: string;
  query?: Record<string, string | undefined>;
  /** JSON body for POST (token + appsecret_proof are added here, not in the URL). */
  body?: Record<string, unknown>;
  /** "write" calls that time out are UNCERTAIN; "read" calls are safe to retry. */
  phase: "read" | "write";
}

export interface GraphResponse<T = Record<string, unknown>> { status: number; json: T; headers: Headers }

export function buildUrl(req: GraphRequest): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) q.set(k, v);
  if (req.method !== "POST" && req.token) {
    q.set("access_token", req.token);
    if (config.metaAppSecret) q.set("appsecret_proof", appSecretProof(req.token, config.metaAppSecret));
  }
  const qs = q.toString();
  return `${graphBase()}${req.path}${qs ? `?${qs}` : ""}`;
}

/** One Graph call. Throws a classified SocialPublishError for transport failures and Graph error responses. */
export async function graph<T = Record<string, unknown>>(req: GraphRequest): Promise<GraphResponse<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    const withToken = req.method === "POST" && req.token ? { ...req.body, access_token: req.token, ...(config.metaAppSecret ? { appsecret_proof: appSecretProof(req.token, config.metaAppSecret) } : {}) } : req.body;
    res = await metaHttp.fetch(buildUrl(req), {
      method: req.method, signal: ctrl.signal,
      ...(req.method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(withToken ?? {}) } : {}),
    });
  } catch (err) {
    throw errorFromNetwork(err, req.phase);
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!res.ok || (json as GraphErrorBody).error) throw errorFromGraph(res.status, json as GraphErrorBody, [req.token, config.metaAppSecret]);
  return { status: res.status, json, headers: res.headers };
}
