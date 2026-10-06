/**
 * Mock provider for development and tests ONLY (disabled in production unless SOCIAL_MOCK_PROVIDER_ENABLED=true).
 * No network. The "authorization code" is `mock_<name>`: the account becomes `mock-<name>`. Special names let tests
 * exercise failure paths: `mock_fail` fails the callback; an access token containing `expired` fails health checks.
 */
import { randomBytes } from "node:crypto";
import { config } from "../../../config/env";
import type { SocialTokenSet } from "../tokenVault";
import { SocialPublishError } from "../publishing/publishErrors";
import { DEFAULT_CONSTRAINTS, type ConnectResult, type HealthResult, type PublishInput, type PublishResult, type SocialConnector, type SocialProfile } from "./types";

/** Calls recorded by the mock (id -> count) so tests can prove "never published twice". Test/dev only. */
export const mockPublishLog: Array<{ idempotencyKey: string; attempt: number; text: string }> = [];
const onceSeen = new Set<string>();

const tokenFor = (name: string, kind: "at" | "rt") => `mock_${kind}_${name}_${randomBytes(8).toString("hex")}`;

export const mockProvider: SocialConnector = {
  key: "mock",
  label: "Mock Network (dev/test)",
  implemented: true,
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
};
