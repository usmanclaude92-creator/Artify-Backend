/** Setup guidance for connectors that need configuration in an external dashboard. Never contains secret values (only whether they are set). */
import { config } from "../../../config/env";
import { REQUIRED_SCOPES, SUBSCRIBED_FIELDS_FULL, facebookScopes } from "./facebookPageProvider";

export interface ProviderSetup {
  provider: string;
  label: string;
  configured: boolean;
  appMode: "development" | "live" | "unknown";
  apiVersion: string;
  redirectUri: string;
  webhookCallbackUrl: string;
  verifyTokenConfigured: boolean;
  verifyTokenEnvVar: string;
  permissions: { name: string; required: boolean }[];
  webhookFields: string[];
  envVars: { name: string; set: boolean }[];
  notes: string[];
}

export function providerSetup(provider: string): ProviderSetup | null {
  if (provider !== "meta_facebook") return null;
  const base = config.controlCenterBaseUrl.replace(/\/+$/, "");
  return {
    provider, label: "Facebook Pages", configured: !!config.metaAppId && !!config.metaAppSecret, appMode: config.metaAppMode, apiVersion: config.metaApiVersion,
    redirectUri: `${base}/social/accounts`,
    webhookCallbackUrl: `${base}/api/v1/social/webhooks/meta_facebook`,
    verifyTokenConfigured: !!config.metaWebhookVerifyToken, verifyTokenEnvVar: "META_WEBHOOK_VERIFY_TOKEN",
    permissions: facebookScopes().map((name) => ({ name, required: (REQUIRED_SCOPES as readonly string[]).includes(name) })),
    webhookFields: SUBSCRIBED_FIELDS_FULL.split(","),
    envVars: [
      { name: "META_APP_ID", set: !!config.metaAppId }, { name: "META_APP_SECRET", set: !!config.metaAppSecret },
      { name: "META_WEBHOOK_VERIFY_TOKEN", set: !!config.metaWebhookVerifyToken }, { name: "META_API_VERSION", set: true }, { name: "META_LOGIN_SCOPES (optional override)", set: !!config.metaLoginScopes },
    ],
    notes: [
      "In the Meta app dashboard add the Facebook Login product and put the redirect URI above under Valid OAuth Redirect URIs.",
      "Add the Webhooks product, choose the Page object, set the callback URL above and the verify token (the value of META_WEBHOOK_VERIFY_TOKEN), then subscribe to the listed fields.",
      "While the app is in Development mode only people with a role on the app (administrator, developer, tester) can connect Pages and receive events.",
      "Login asks only for the permissions listed above. Facebook rejects the whole login if one is not enabled for the app; add a permission under Use cases first, then list it in META_LOGIN_SCOPES (e.g. add pages_read_user_content to read other people's comments).",
      "Going Live for other people requires App Review for the permissions above. This panel cannot detect the app mode; set META_APP_MODE to show it here.",
    ],
  };
}
