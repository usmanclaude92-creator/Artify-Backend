/** Provider-agnostic connector contract. Every social network implements this; the rest of the platform only talks to it. */
import type { SocialTokenSet } from "../tokenVault";

export interface SocialProfile {
  externalAccountId: string;
  displayName: string;
  handle?: string | null;
  avatarUrl?: string | null;
  accountType?: string;
}

/** One connectable asset (e.g. a Facebook Page) discovered during OAuth. Its tokens are encrypted server-side and never sent to the browser. */
export interface SelectableAccount {
  profile: SocialProfile;
  tokens: SocialTokenSet;
  /** Roles/tasks the connecting user has on it (informational). */
  tasks?: string[];
  /** Human-readable reasons this asset may not work fully (e.g. missing tasks). */
  warnings?: string[];
}

export interface ConnectResult {
  profile: SocialProfile;
  tokens: SocialTokenSet;
  /** Providers where one login yields several assets: the user picks which to connect. `profile`/`tokens` are then not persisted. */
  selectable?: SelectableAccount[];
}

export interface HealthResult {
  ok: boolean;
  error?: string;
  /** Authoritative expiry if the provider reports one. */
  expiresAt?: string | null;
}

/** Per-network publishing rules the Composer and guardrails validate against. */
export interface SocialConstraints {
  maxChars: number;
  maxHashtags: number;
  maxMedia: number;
  /** The network rejects posts without media (e.g. Instagram). */
  requiresMedia: boolean;
  allowedMediaTypes: string[];
  supportsLink: boolean;
  hashtagPrefix: string;
  mentionPrefix: string;
}

export const DEFAULT_CONSTRAINTS: SocialConstraints = {
  maxChars: 280,
  maxHashtags: 10,
  maxMedia: 4,
  requiresMedia: false,
  allowedMediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  supportsLink: true,
  hashtagPrefix: "#",
  mentionPrefix: "@",
};

export interface PublishMedia {
  mediaId: string;
  mimeType: string;
  altText?: string | null;
  /** Loads the bytes lazily (storage read); only the connector that needs an upload calls it. */
  load: () => Promise<Buffer>;
  /** Short-lived signed URL for networks that fetch the image themselves (e.g. Facebook `url=`). */
  signedUrl?: () => Promise<string>;
}

export interface PublishInput {
  /** Provider-side author/account id (e.g. LinkedIn person id). */
  accountExternalId: string;
  accountType?: string | null;
  text: string;
  linkUrl?: string | null;
  media: PublishMedia[];
  /** Stable per target; sent to networks that support idempotent creates. */
  idempotencyKey: string;
  attempt: number;
}

export interface PublishResult {
  externalPostId: string;
  externalUrl: string | null;
}

export interface ReplyWindow {
  open: boolean;
  /** When the window closes (null = no window). */
  closesAt: Date | null;
  /** Shown to the user when `open` is false. */
  reason?: string;
}

export type InboundEventType = "COMMENT" | "DM" | "MENTION" | "REVIEW";

/** Provider-agnostic inbound message. `accountExternalId` identifies OUR account the event belongs to. */
export interface InboundEvent {
  type: InboundEventType;
  accountExternalId: string;
  providerThreadId: string;
  providerMessageId: string;
  participant: { externalId?: string; handle?: string; name?: string };
  text: string;
  /** What the comment/mention is about (e.g. a post id or URL). */
  subjectRef?: string;
  createdAt?: string;
}

export interface SendReplyInput {
  accountExternalId: string;
  conversationType: InboundEventType;
  providerThreadId: string;
  /** The inbound message being answered (comments reply to a specific comment). */
  inReplyToProviderMessageId?: string;
  participantExternalId?: string;
  text: string;
  idempotencyKey: string;
}

export interface SendReplyResult {
  providerMessageId: string;
}

export class ConnectorNotImplementedError extends Error {
  constructor(provider: string, capability: string) {
    super(`${provider} does not support "${capability}" yet.`);
    this.name = "ConnectorNotImplementedError";
  }
}

export interface SocialConnector {
  readonly key: string;
  readonly label: string;
  /** App credentials / flags are present in this environment. */
  isConfigured(): boolean;
  /** Real network code exists for this provider. Configured but unimplemented providers are not offered for connection. */
  readonly implemented: boolean;
  readonly defaultScopes: string[];
  /** Publishing rules for this network (optionally specialised by account type). Static: needs no credentials. */
  getConstraints(account?: { accountType?: string | null }): SocialConstraints;

  getAuthUrl(params: { state: string; redirectUri: string; scopes?: string[] }): string;
  handleCallback(params: { code: string; redirectUri: string }): Promise<ConnectResult>;
  refreshToken(tokens: SocialTokenSet): Promise<SocialTokenSet>;
  getProfile(tokens: SocialTokenSet): Promise<SocialProfile>;
  healthCheck(tokens: SocialTokenSet): Promise<HealthResult>;

  /**
   * Sends one post to the network. MUST throw `SocialPublishError` with the right `kind` (see publishErrors.ts) and MUST
   * NOT retry internally: the publisher owns retries. A timeout/abort after the request was sent is `uncertain`.
   */
  publish?(tokens: SocialTokenSet, input: PublishInput): Promise<PublishResult>;

  // ---- Inbox (Step 7). Providers that don't support a capability throw ConnectorNotImplementedError ("not supported"). ----
  /** True for providers that must be polled (no webhooks). The tick calls `fetchInbox` only for these. */
  readonly pollsInbox?: boolean;
  /** True when the signature of an inbound webhook delivery is valid for this provider. Must be constant-time and fail closed. */
  verifyWebhook?(input: { rawBody: Buffer; headers: Record<string, string | string[] | undefined> }): boolean;
  /** Normalises a verified webhook payload into provider-agnostic events. Never throws on unknown event kinds (skips them). */
  parseWebhook?(input: { rawBody: Buffer }): InboundEvent[];
  /** Polling fallback for providers without webhooks (cursor-based). */
  fetchInbox?(tokens: SocialTokenSet, input: { accountExternalId: string; cursor?: string }): Promise<{ events: InboundEvent[]; nextCursor?: string }>;
  /** GET verification handshake (e.g. Meta's hub.challenge). Returns the body to echo, or null to refuse (fail closed). */
  handleWebhookChallenge?(input: { query: Record<string, string | undefined> }): string | null;
  /** Is a reply still allowed by the network's messaging policy (e.g. Messenger's 24-hour window)? Checked before every send. */
  replyWindow?(input: { type: InboundEventType; lastInboundAt: Date | null; now: Date }): ReplyWindow;
  /** Runs once after an account is created (e.g. subscribe the app to the Page's webhooks). Failures become warnings, never block connecting. */
  onConnected?(tokens: SocialTokenSet, profile: SocialProfile): Promise<{ warnings?: string[] }>;
  /** Best-effort cleanup when an account is disconnected (e.g. remove the webhook subscription). */
  onDisconnect?(tokens: SocialTokenSet, profile: { externalAccountId: string }): Promise<void>;
  sendReply?(tokens: SocialTokenSet, input: SendReplyInput): Promise<SendReplyResult>;
  hideComment?(tokens: SocialTokenSet, input: { providerMessageId: string; hidden: boolean }): Promise<void>;
  markRead?(tokens: SocialTokenSet, input: { providerThreadId: string; providerMessageId?: string }): Promise<void>;

  fetchMetrics?(tokens: SocialTokenSet, range: { from: Date; to: Date }): Promise<unknown>;
}
