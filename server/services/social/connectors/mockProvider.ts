/**
 * Mock provider for development and tests ONLY (disabled in production unless SOCIAL_MOCK_PROVIDER_ENABLED=true).
 * No network. The "authorization code" is `mock_<name>`: the account becomes `mock-<name>`. Special names let tests
 * exercise failure paths: `mock_fail` fails the callback; an access token containing `expired` fails health checks.
 */
import { randomBytes } from "node:crypto";
import { config } from "../../../config/env";
import type { SocialTokenSet } from "../tokenVault";
import type { ConnectResult, HealthResult, SocialConnector, SocialProfile } from "./types";

const tokenFor = (name: string, kind: "at" | "rt") => `mock_${kind}_${name}_${randomBytes(8).toString("hex")}`;

export const mockProvider: SocialConnector = {
  key: "mock",
  label: "Mock Network (dev/test)",
  implemented: true,
  defaultScopes: ["profile.read", "posts.write"],
  isConfigured: () => config.socialMockProviderEnabled,

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
};
