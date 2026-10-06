/** Meta and LinkedIn are registered so the UI can list them, but they stay "not configured" until app credentials exist AND real connector code is written. */
import { config } from "../../../config/env";
import { ConnectorNotImplementedError, type SocialConnector } from "./types";

function stub(key: string, label: string, configured: () => boolean, scopes: string[]): SocialConnector {
  const unavailable = (capability: string): never => {
    throw new ConnectorNotImplementedError(label, capability);
  };
  return {
    key,
    label,
    implemented: false,
    defaultScopes: scopes,
    isConfigured: configured,
    getAuthUrl: () => unavailable("connect"),
    handleCallback: async () => unavailable("connect"),
    refreshToken: async () => unavailable("token refresh"),
    getProfile: async () => unavailable("profile"),
    healthCheck: async () => unavailable("health check"),
  };
}

export const metaProvider = stub("meta", "Facebook & Instagram (Meta)", () => !!config.metaAppId && !!config.metaAppSecret, ["pages_show_list", "instagram_basic"]);
export const linkedinProvider = stub("linkedin", "LinkedIn", () => !!config.linkedinClientId && !!config.linkedinClientSecret, ["r_liteprofile", "w_member_social"]);
