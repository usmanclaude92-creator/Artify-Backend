/**
 * Mock provider for development and tests ONLY (disabled in production unless SOCIAL_MOCK_PROVIDER_ENABLED=true).
 * No network. The "authorization code" is `mock_<name>`: the account becomes `mock-<name>`. Special names let tests
 * exercise failure paths: `mock_fail` fails the callback; an access token containing `expired` fails health checks.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../../../config/env";
import type { SocialTokenSet } from "../tokenVault";
import { SocialPublishError } from "../publishing/publishErrors";
import { DEFAULT_CONSTRAINTS, type InboundEvent, type ReviewSummary, type SendReplyInput, type SendReplyResult, type ConnectResult, type HealthResult, type PublishInput, type PublishResult, type SocialConnector, type SocialProfile } from "./types";

/** Calls recorded by the mock (id -> count) so tests can prove "never published twice". Test/dev only. */
export const mockPublishLog: Array<{ idempotencyKey: string; attempt: number; text: string }> = [];
const onceSeen = new Set<string>();

/** Inbox activity recorded by the mock so tests can assert exactly what was (not) sent. Test/dev only. */
export const mockInboxLog: { replies: SendReplyInput[]; hidden: Array<{ providerMessageId: string; hidden: boolean }>; read: Array<{ providerThreadId: string }> } = { replies: [], hidden: [], read: [] };
/** Events the mock "polling" endpoint will return once (per account external id). */
export const mockPollQueue = new Map<string, InboundEvent[]>();
/** Test hooks for listening: mentions the poller will list, review summaries (or an Error to throw), and id → content for id-only webhooks. */
export const mockMentionQueue = new Map<string, InboundEvent[]>();
export const mockReviewSummaries = new Map<string, ReviewSummary | Error>();
export const mockMentionContent = new Map<string, { text: string; participant: InboundEvent["participant"]; permalink?: string }>();

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
/** Signature the mock provider expects: hex HMAC-SHA256 of the raw body with WEBHOOK_SECRET. */
export const signMockWebhook = (rawBody: Buffer | string, secret: string): string => createHmac("sha256", secret).update(rawBody).digest("hex");

const tokenFor = (name: string, kind: "at" | "rt") => `mock_${kind}_${name}_${randomBytes(8).toString("hex")}`;

export const mockProvider: SocialConnector = {
  key: "mock",
  label: "Mock Network (dev/test)",
  implemented: true,
  pollsInbox: true,
  defaultScopes: ["profile.read", "posts.write"],
  isConfigured: () => config.socialMockProviderEnabled,
  getConstraints: () => ({ ...DEFAULT_CONSTRAINTS, maxChars: 500, maxHashtags: 5, maxMedia: 4 }),

  getAuthUrl({ state, redirectUri }) {
    // A real provider would send the user to its consent screen; the mock consents immediately.
    return `${redirectUri}?code=mock_demo&state=${encodeURIComponent(state)}&provider=mock`;
  },

  async handleCallback({ code }): Promise<ConnectResult> {
    if (!code.startsWith("mock_")) throw new Error("Invalid authorization code.");
    const name = code.slice("mock_".length);
    if (name === "fail") throw new Error("The provider rejected the authorization.");
    return {
      profile: { externalAccountId: `mock-${name}`, displayName: `Mock ${name}`, handle: `@mock_${name}`, avatarUrl: null, accountType: "PAGE" },
      tokens: { accessToken: tokenFor(name, "at"), refreshToken: tokenFor(name, "rt"), expiresAt: new Date(Date.now() + 60 * 86400_000).toISOString(), scopes: ["profile.read", "posts.write"], mockName: name },
    };
  },

  async refreshToken(tokens: SocialTokenSet): Promise<SocialTokenSet> {
    const name = String(tokens.mockName ?? "demo");
    if (!tokens.refreshToken || name === "norefresh") throw new Error("This account cannot be refreshed; please reconnect.");
    return { ...tokens, accessToken: tokenFor(name, "at"), expiresAt: new Date(Date.now() + 60 * 86400_000).toISOString() };
  },

  async getProfile(tokens: SocialTokenSet): Promise<SocialProfile> {
    const name = String(tokens.mockName ?? "demo");
    return { externalAccountId: `mock-${name}`, displayName: `Mock ${name}`, handle: `@mock_${name}`, accountType: "PAGE" };
  },

  async healthCheck(tokens: SocialTokenSet): Promise<HealthResult> {
    if (tokens.accessToken.includes("expired") || String(tokens.mockName) === "expired") return { ok: false, error: "The access token was rejected by the provider." };
    return { ok: true, expiresAt: (tokens.expiresAt as string | null | undefined) ?? null };
  },

  /**
   * Behaviour is driven by markers in the text (dev/test only): [[fail-transient]], [[transient-once]] (fails the first attempt),
   * [[fail-permanent]], [[fail-auth]], [[timeout]] (outcome unknown). No marker = success.
   */
  async publish(_tokens: SocialTokenSet, input: PublishInput): Promise<PublishResult> {
    const t = input.text;
    mockPublishLog.push({ idempotencyKey: input.idempotencyKey, attempt: input.attempt, text: t });
    if (t.includes("[[fail-transient]]")) throw new SocialPublishError("transient", "Mock: service unavailable.", { httpStatus: 503 });
    if (t.includes("[[transient-once]]") && !onceSeen.has(input.idempotencyKey)) {
      onceSeen.add(input.idempotencyKey);
      throw new SocialPublishError("transient", "Mock: rate limited.", { httpStatus: 429, retryAfterMs: 1000 });
    }
    if (t.includes("[[fail-permanent]]")) throw new SocialPublishError("permanent", "Mock: content rejected by the network.", { httpStatus: 422 });
    if (t.includes("[[fail-auth]]")) throw new SocialPublishError("auth", "Mock: access token revoked.", { httpStatus: 401 });
    if (t.includes("[[timeout]]")) throw new SocialPublishError("uncertain", "Mock: request timed out after being sent.");
    const id = `mockpost_${input.idempotencyKey.slice(0, 12)}`;
    return { externalPostId: id, externalUrl: `https://mock.example/posts/${id}` };
  },

  // ---- Inbox ----
  /** Mirrors Messenger's rule so the core enforcement is testable without a network: DMs can be answered for 24 hours after the last inbound message. */
  replyWindow({ type, lastInboundAt, now }) {
    if (type !== "DM") return { open: true, closesAt: null };
    if (!lastInboundAt) return { open: false, closesAt: null, reason: "There is no message from this person to reply to." };
    const closesAt = new Date(lastInboundAt.getTime() + 24 * 3600_000);
    return now <= closesAt ? { open: true, closesAt } : { open: false, closesAt, reason: "The 24-hour messaging window for this conversation has closed." };
  },

  verifyWebhook({ rawBody, headers }) {
    const given = headers[MOCK_SIGNATURE_HEADER];
    const sig = Array.isArray(given) ? given[0] : given;
    if (!sig || !config.webhookSecret) return false;
    const expected = Buffer.from(signMockWebhook(rawBody, config.webhookSecret));
    const provided = Buffer.from(sig);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  },

  parseWebhook({ rawBody }): InboundEvent[] {
    let json: { events?: Array<Partial<InboundEvent> & { type?: string; participant?: InboundEvent["participant"] }> };
    try { json = JSON.parse(rawBody.toString("utf8")); } catch { return []; }
    const types = ["COMMENT", "DM", "MENTION", "REVIEW"];
    return (json.events ?? []).flatMap((e) => {
      const type = String(e.type ?? "").toUpperCase();
      if (!types.includes(type) || !e.accountExternalId || !e.providerThreadId || !e.providerMessageId || typeof e.text !== "string") return [];
      return [{ type: type as InboundEvent["type"], accountExternalId: e.accountExternalId, providerThreadId: e.providerThreadId, providerMessageId: e.providerMessageId, participant: e.participant ?? {}, text: e.text, subjectRef: e.subjectRef, createdAt: e.createdAt, permalink: e.permalink }];
    });
  },

  replyCapability: ({ providerThreadId }) => (providerThreadId.startsWith("platform:") ? { mode: "platform", reason: "Mock: the network does not let apps reply here. Reply on the platform." } : { mode: "api" }),

  async resolveMention(_tokens, { lookup }) {
    const c = mockMentionContent.get(lookup.id);
    return c ? { text: c.text, participant: c.participant, permalink: c.permalink } : null;
  },

  async fetchMentions(_tokens, { accountExternalId }) {
    const events = mockMentionQueue.get(accountExternalId) ?? [];
    mockMentionQueue.delete(accountExternalId);
    return { events, nextCursor: undefined };
  },

  async fetchReviewSummary(_tokens, { accountExternalId }) {
    const r = mockReviewSummaries.get(accountExternalId);
    if (r instanceof Error) throw r;
    return r ?? { averageRating: null, reviewCount: null, note: "Mock: no rating." };
  },

  async fetchInbox(_tokens, { accountExternalId }) {
    const events = mockPollQueue.get(accountExternalId) ?? [];
    mockPollQueue.delete(accountExternalId);
    return { events, nextCursor: undefined };
  },

  async sendReply(_tokens: SocialTokenSet, input: SendReplyInput): Promise<SendReplyResult> {
    mockInboxLog.replies.push(input);
    const t = input.text;
    if (t.includes("[[fail-transient]]")) throw new SocialPublishError("transient", "Mock: service unavailable.", { httpStatus: 503 });
    if (t.includes("[[fail-permanent]]")) throw new SocialPublishError("permanent", "Mock: reply rejected by the network.", { httpStatus: 422 });
    if (t.includes("[[fail-auth]]")) throw new SocialPublishError("auth", "Mock: access token revoked.", { httpStatus: 401 });
    if (t.includes("[[timeout]]")) throw new SocialPublishError("uncertain", "Mock: request timed out after being sent.");
    return { providerMessageId: `mockreply_${input.idempotencyKey.slice(0, 12)}` };
  },

  async hideComment(_tokens, input) {
    mockInboxLog.hidden.push(input);
  },

  async markRead(_tokens, input) {
    mockInboxLog.read.push({ providerThreadId: input.providerThreadId });
  },
};
