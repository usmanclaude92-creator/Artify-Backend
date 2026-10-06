/** Meta and LinkedIn are registered so the UI can list them, but they stay "not configured" until app credentials exist AND real connector code is written. */
import { config } from "../../../config/env";
import { ConnectorNotImplementedError, DEFAULT_CONSTRAINTS, type SocialConnector, type SocialConstraints } from "./types";

function stub(key: string, label: string, configured: () => boolean, scopes: string[], constraints: (accountType?: string | null) => SocialConstraints): SocialConnector {
  const unavailable = (capability: string): never => {
    throw new ConnectorNotImplementedError(label, capability);
  };
  return {
    key,
    label,
    implemented: false,
    defaultScopes: scopes,
    isConfigured: configured,
    getConstraints: (account) => constraints(account?.accountType),
    getAuthUrl: () => unavailable("connect"),
    handleCallback: async () => unavailable("connect"),
    refreshToken: async () => unavailable("token refresh"),
    getProfile: async () => unavailable("profile"),
    healthCheck: async () => unavailable("health check"),
  };
}

// Sensible published defaults; verify against each network's current API docs when the real connector is written.
export const metaProvider = stub("meta", "Facebook & Instagram (Meta)", () => !!config.metaAppId && !!config.metaAppSecret, ["pages_show_list", "instagram_basic"], (accountType) =>
  accountType === "INSTAGRAM"
    ? { ...DEFAULT_CONSTRAINTS, maxChars: 2200, maxHashtags: 30, maxMedia: 10, requiresMedia: true, supportsLink: false }
    : { ...DEFAULT_CONSTRAINTS, maxChars: 63206, maxHashtags: 30, maxMedia: 10 }
);
export const linkedinProvider = stub("linkedin", "LinkedIn", () => !!config.linkedinClientId && !!config.linkedinClientSecret, ["r_liteprofile", "w_member_social"], () => ({
  ...DEFAULT_CONSTRAINTS,
  maxChars: 3000,
  maxHashtags: 5,
  maxMedia: 9,
}));
