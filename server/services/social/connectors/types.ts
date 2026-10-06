/** Provider-agnostic connector contract. Every social network implements this; the rest of the platform only talks to it. */
import type { SocialTokenSet } from "../tokenVault";

export interface SocialProfile {
  externalAccountId: string;
  displayName: string;
  handle?: string | null;
  avatarUrl?: string | null;
  accountType?: string;
}

export interface ConnectResult {
  profile: SocialProfile;
  tokens: SocialTokenSet;
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

  // Reserved for later phases (inbox, analytics) — signatures only.
  fetchInbox?(tokens: SocialTokenSet, cursor?: string): Promise<unknown>;
  fetchMetrics?(tokens: SocialTokenSet, range: { from: Date; to: Date }): Promise<unknown>;
}
