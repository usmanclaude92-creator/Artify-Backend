/** Placeholder connectors: stay unavailable until real connector code exists. */
import { config } from "../../../config/env";
import { ConnectorNotImplementedError, DEFAULT_CONSTRAINTS, type SocialConnector, type SocialConstraints } from "./types";

export function stub(key: string, label: string, configured: () => boolean, scopes: string[], constraints: (accountType?: string | null) => SocialConstraints): SocialConnector {
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
    // Inbox capabilities: "not supported" until the real connector implements them.
    verifyWebhook: () => unavailable("webhook verification"),
    parseWebhook: () => unavailable("webhook parsing"),
    fetchInbox: async () => unavailable("inbox polling"),
    sendReply: async () => unavailable("sending replies"),
    hideComment: async () => unavailable("hiding comments"),
    markRead: async () => unavailable("marking messages read"),
  };
}

/**
 * Instagram placeholder: NOT registered yet. When the Instagram connector is built it reuses metaGraph.ts (Graph transport, signature check,
 * error classification) exactly like facebookPageProvider.ts does; only endpoints and webhook parsing differ.
 */
export const instagramProvider = stub("meta_instagram", "Instagram (Meta)", () => !!config.metaAppId && !!config.metaAppSecret, ["instagram_basic", "instagram_content_publish"], () => ({
  ...DEFAULT_CONSTRAINTS, maxChars: 2200, maxHashtags: 30, maxMedia: 10, requiresMedia: true, supportsLink: false,
}));
