/** Placeholder connectors: stay unavailable until real connector code exists. */
import { ConnectorNotImplementedError, type SocialConnector, type SocialConstraints } from "./types";

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
