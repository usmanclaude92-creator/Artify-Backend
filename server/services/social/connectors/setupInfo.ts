/** Setup guidance for connectors that need configuration in an external dashboard. Never contains secret values (only whether they are set). */
import { config } from "../../../config/env";
import { REQUIRED_SCOPES, SUBSCRIBED_FIELDS_FULL, facebookScopes } from "./facebookPageProvider";
import { REQUIRED_SCOPES as IG_REQUIRED_SCOPES, WEBHOOK_FIELDS as IG_WEBHOOK_FIELDS, WEBHOOK_OBJECT as IG_WEBHOOK_OBJECT, instagramScopes } from "./instagramProvider";

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
  /** Which object to pick in the Meta Webhooks product ("page" / "instagram"). */
  webhookObject: string;
  webhookFields: string[];
  /** Things the connecting person must have in place before connecting (shown as a checklist). */
  prerequisites: string[];
  /** Daily publishing limit enforced by the platform, when the network has one. */
  dailyPublishLimit?: number;
  envVars: { name: string; set: boolean }[];
  notes: string[];
}

export function providerSetup(provider: string): ProviderSetup | null {
  if (provider === "meta_instagram") return instagramSetup();
  if (provider !== "meta_facebook") return null;
  const base = config.controlCenterBaseUrl.replace(/\/+$/, "");
  return {
    provider, label: "Facebook Pages", configured: !!config.metaAppId && !!config.metaAppSecret, appMode: config.metaAppMode, apiVersion: config.metaApiVersion,
    redirectUri: `${base}/social/accounts`,
    webhookCallbackUrl: `${base}/api/v1/social/webhooks/meta_facebook`,
    verifyTokenConfigured: !!config.metaWebhookVerifyToken, verifyTokenEnvVar: "META_WEBHOOK_VERIFY_TOKEN",
    permissions: facebookScopes().map((name) => ({ name, required: (REQUIRED_SCOPES as readonly string[]).includes(name) })),
    webhookObject: "page", prerequisites: [],
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

function instagramSetup(): ProviderSetup {
  const base = config.controlCenterBaseUrl.replace(/\/+$/, "");
  return {
    provider: "meta_instagram", label: "Instagram", configured: !!config.metaAppId && !!config.metaAppSecret, appMode: config.metaAppMode, apiVersion: config.metaApiVersion,
    redirectUri: `${base}/social/accounts`,
    webhookCallbackUrl: `${base}/api/v1/social/webhooks/meta_instagram`,
    verifyTokenConfigured: !!config.metaWebhookVerifyToken, verifyTokenEnvVar: "META_WEBHOOK_VERIFY_TOKEN",
    permissions: instagramScopes().map((name) => ({ name, required: (IG_REQUIRED_SCOPES as readonly string[]).includes(name) })),
    webhookObject: IG_WEBHOOK_OBJECT, webhookFields: [...IG_WEBHOOK_FIELDS],
    dailyPublishLimit: config.instagramDailyPublishLimit,
    prerequisites: [
      "The Instagram account is a Business or Creator (professional) account, not a personal one.",
      "It is linked to a Facebook Page, and you manage that Page (Facebook role with the Create content, Moderate and Messages tasks).",
      "In Instagram, Settings → Messages and story replies → Message controls, turn on “Allow access to messages” so DMs can reach the Inbox.",
      "While the Meta app is in Development mode, your Facebook user must have a role on the app (administrator, developer or tester).",
    ],
    envVars: [
      { name: "META_APP_ID", set: !!config.metaAppId }, { name: "META_APP_SECRET", set: !!config.metaAppSecret },
      { name: "META_WEBHOOK_VERIFY_TOKEN", set: !!config.metaWebhookVerifyToken }, { name: "META_INSTAGRAM_LOGIN_SCOPES (optional override)", set: !!config.metaInstagramLoginScopes },
      { name: "INSTAGRAM_DAILY_PUBLISH_LIMIT (optional, default 50)", set: true },
    ],
    notes: [
      "Instagram reuses the Facebook Login redirect URI above (Facebook Login → Valid OAuth Redirect URIs) and the same app secret.",
      "In the Meta app dashboard add the Instagram use case with instagram_basic, instagram_content_publish, instagram_manage_comments and instagram_manage_messages. Facebook rejects the whole login if one is not enabled; list only the enabled ones in META_INSTAGRAM_LOGIN_SCOPES.",
      "Add the Webhooks product, choose the Instagram object, set the callback URL above and the verify token, then subscribe to comments, messages and mentions (mentions feed Social Media → Listening).",
      "Publishing needs a JPEG image (up to 8 MB; ratio 4:5 to 1.91:1). Text-only posts and links in captions are not supported. Reels need a video library and are not available yet.",
      "Replies to direct messages are only possible within 24 hours of the person's last message. No message tags are used and auto-reply stays off.",
      "Going Live for other people requires App Review for the permissions above. This panel cannot detect the app mode; set META_APP_MODE to show it here.",
    ],
  };
}
