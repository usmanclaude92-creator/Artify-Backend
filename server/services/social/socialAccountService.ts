/**
 * Social connected accounts: OAuth connect/callback (state-protected), disconnect, re-auth and health checks.
 * Tokens only ever exist in memory here and in the encrypted credentials table — they are never returned, logged,
 * or placed in audit metadata. Everything is scoped to the caller's ACTIVE workspace (organizationId).
 */
import { randomBytes } from "node:crypto";
import type { SocialAccount } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { config } from "../../config/env";
import { logger } from "../../core/logger";
import { AuthenticationError, NotFoundError, ValidationError } from "../../core/errors";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { notificationService } from "../notificationService";
import { hashToken } from "../../utils/crypto";
import { connectorRegistry } from "./connectors/registry";
import type { SocialConnector } from "./connectors/types";
import { redactSecrets, tokenVault, type SocialTokenSet } from "./tokenVault";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";

const STATE_TTL_MS = 10 * 60 * 1000;
export const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
const ACCOUNT_SELECT = {
  id: true, organizationId: true, provider: true, externalAccountId: true, displayName: true, handle: true, avatarUrl: true,
  accountType: true, status: true, scopes: true, tokenExpiresAt: true, lastSyncAt: true, lastError: true, connectedByUserId: true,
  createdAt: true, updatedAt: true,
} as const;

/** Explicit allow-list projection — the credentials relation is never selected, so token material cannot leak by accident. */
export type SocialAccountView = Pick<SocialAccount, keyof typeof ACCOUNT_SELECT>;

const safeError = (err: unknown, secrets: Array<string | undefined> = []) => redactSecrets(err, secrets).slice(0, 300);
const redirectUri = () => `${config.controlCenterBaseUrl}/social/accounts`;

function connectorOrThrow(provider: string): SocialConnector {
  const known = connectorRegistry.get(provider);
  if (!known) throw new ValidationError("Unknown social provider.");
  const connector = connectorRegistry.getAvailable(provider);
  if (!connector) throw new ValidationError(`${known.label} is not configured yet.`);
  return connector;
}

async function loadInOrgOrThrow(organizationId: string, id: string): Promise<SocialAccountView> {
  const account = await prisma.socialAccount.findFirst({ where: { id, organizationId }, select: ACCOUNT_SELECT });
  if (!account) throw new NotFoundError("Social account not found.");
  return account;
}

async function saveTokens(accountId: string, tokens: SocialTokenSet): Promise<void> {
  const { ciphertext, keyVersion } = tokenVault.encrypt(tokens, accountId);
  await prisma.socialAccountCredential.upsert({
    where: { socialAccountId: accountId },
    create: { socialAccountId: accountId, ciphertext, keyVersion },
    update: { ciphertext, keyVersion },
  });
}

async function loadTokens(accountId: string): Promise<SocialTokenSet | null> {
  const row = await prisma.socialAccountCredential.findUnique({ where: { socialAccountId: accountId } });
  return row ? tokenVault.decrypt(row.ciphertext, row.keyVersion, accountId) : null;
}

/** Users in a workspace who may manage connected accounts (real permission lookup, not a role-name guess). */
async function managersOf(organizationId: string): Promise<string[]> {
  const rows = await prisma.organizationMembership.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      user: { status: "ACTIVE", deletedAt: null },
      role: { rolePermissions: { some: { permission: { key: "social.accounts.manage" } } } },
    },
    select: { userId: true },
    take: 50,
  });
  return rows.map((r) => r.userId);
}

async function notifyManagers(account: SocialAccountView, title: string, message: string): Promise<void> {
  const userIds = await managersOf(account.organizationId);
  await Promise.all(
    userIds.map((userId) =>
      notificationService.notify({ organizationId: account.organizationId, userId, type: "social_account_attention", title, message, entityType: "social_account", entityId: account.id })
    )
  );
}

export const socialAccountService = {
  async list(organizationId: string) {
    const accounts = await prisma.socialAccount.findMany({ where: { organizationId }, orderBy: [{ status: "asc" }, { displayName: "asc" }], select: ACCOUNT_SELECT });
    return { accounts, providers: connectorRegistry.list() };
  },

  get: (organizationId: string, id: string) => loadInOrgOrThrow(organizationId, id),

  /** Begins OAuth: returns the provider URL. The single-use `state` is stored hashed and bound to this user + workspace + provider. */
  async startConnect(user: SanitizedUser, provider: string, reconnectAccountId?: string): Promise<{ authUrl: string }> {
    const connector = connectorOrThrow(provider);
    if (reconnectAccountId) {
      const existing = await loadInOrgOrThrow(user.organizationId, reconnectAccountId);
      if (existing.provider !== provider) throw new ValidationError("That account belongs to a different provider.");
    }
    const state = `art_oauth_${randomBytes(32).toString("base64url")}`;
    await prisma.socialOAuthState.create({
      data: { stateHash: hashToken(state), organizationId: user.organizationId, userId: user.id, provider, reconnectAccountId: reconnectAccountId ?? null, expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });
    return { authUrl: connector.getAuthUrl({ state, redirectUri: redirectUri(), scopes: connector.defaultScopes }) };
  },

  async handleCallback(user: SanitizedUser, input: { state: string; code?: string; error?: string }, meta: RequestMeta = {}): Promise<SocialAccountView> {
    const invalid = () => new AuthenticationError("This connection request is invalid or has expired. Please start again.");
    const stateHash = hashToken(input.state);
    const row = await prisma.socialOAuthState.findUnique({ where: { stateHash } });
    // CSRF guard: the state must exist, be unused and unexpired, and belong to THIS user in THIS workspace.
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now() || row.userId !== user.id || row.organizationId !== user.organizationId) throw invalid();
    const claimed = await prisma.socialOAuthState.updateMany({ where: { stateHash, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw invalid();

    const connector = connectorOrThrow(row.provider);
    if (input.error || !input.code) throw new ValidationError("The provider did not grant access.");

    let result;
    try {
      result = await connector.handleCallback({ code: input.code, redirectUri: redirectUri() });
    } catch (err) {
      await auditLogRepository.record({
        organizationId: user.organizationId, actorUserId: user.id, actorType: "USER", action: "SOCIAL_ACCOUNT_CONNECT_FAILED",
        resourceType: "social_account", result: "FAILURE", metadata: { provider: row.provider, reason: safeError(err, [input.code]) }, ipAddress: meta.ip, userAgent: meta.userAgent,
      });
      throw new ValidationError("Could not connect the account. Please try again.");
    }

    const { profile, tokens } = result;
    if (row.reconnectAccountId) {
      const target = await loadInOrgOrThrow(user.organizationId, row.reconnectAccountId);
      if (target.externalAccountId !== profile.externalAccountId) throw new ValidationError("You signed in with a different account than the one being reconnected.");
    }

    const previous = await prisma.socialAccount.findUnique({
      where: { organizationId_provider_externalAccountId: { organizationId: user.organizationId, provider: row.provider, externalAccountId: profile.externalAccountId } },
      select: { id: true, status: true },
    });
    const data = {
      displayName: profile.displayName, handle: profile.handle ?? null, avatarUrl: profile.avatarUrl ?? null, accountType: profile.accountType ?? "PROFILE",
      status: "CONNECTED" as const, scopes: tokens.scopes ?? connector.defaultScopes, tokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt) : null,
      lastSyncAt: new Date(), lastError: null, connectedByUserId: user.id,
    };
    const account = await prisma.socialAccount.upsert({
      where: { organizationId_provider_externalAccountId: { organizationId: user.organizationId, provider: row.provider, externalAccountId: profile.externalAccountId } },
      create: { organizationId: user.organizationId, provider: row.provider, externalAccountId: profile.externalAccountId, ...data },
      update: data,
      select: ACCOUNT_SELECT,
    });
    await saveTokens(account.id, tokens);

    const reauth = !!previous && previous.status !== "CONNECTED";
    await auditLogRepository.record({
      organizationId: user.organizationId, actorUserId: user.id, actorType: "USER",
      action: row.reconnectAccountId || reauth ? "SOCIAL_ACCOUNT_REAUTHENTICATED" : "SOCIAL_ACCOUNT_CONNECTED",
      resourceType: "social_account", resourceId: account.id,
      metadata: { provider: account.provider, externalAccountId: account.externalAccountId, handle: account.handle }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return account;
  },

  async disconnect(user: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<SocialAccountView> {
    const account = await loadInOrgOrThrow(user.organizationId, id);
    await prisma.socialAccountCredential.deleteMany({ where: { socialAccountId: id } });
    const updated = await prisma.socialAccount.update({ where: { id }, data: { status: "DISCONNECTED", tokenExpiresAt: null, lastError: null }, select: ACCOUNT_SELECT });
    await auditLogRepository.record({
      organizationId: user.organizationId, actorUserId: user.id, actorType: "USER", action: "SOCIAL_ACCOUNT_DISCONNECTED", resourceType: "social_account", resourceId: id,
      metadata: { provider: account.provider, externalAccountId: account.externalAccountId, handle: account.handle }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return updated;
  },

  /**
   * Verifies one account: refreshes a token that is expiring within 7 days (or already expired), then asks the provider.
   * On failure the account moves to NEEDS_REAUTH (or ERROR for infrastructure failures) and managers are notified once.
   */
  async checkHealth(accountId: string, opts: { actor?: SanitizedUser; meta?: RequestMeta } = {}): Promise<SocialAccountView> {
    const account = await prisma.socialAccount.findUnique({ where: { id: accountId }, select: ACCOUNT_SELECT });
    if (!account) throw new NotFoundError("Social account not found.");
    if (account.status === "DISCONNECTED") return account;
    const connector = connectorRegistry.getAvailable(account.provider);
    if (!connector) return account; // provider unavailable in this environment: leave untouched

    const fail = async (status: "NEEDS_REAUTH" | "ERROR", reason: string): Promise<SocialAccountView> => {
      const updated = await prisma.socialAccount.update({ where: { id: account.id }, data: { status, lastError: reason }, select: ACCOUNT_SELECT });
      if (account.status === "CONNECTED") {
        await auditLogRepository.record({
          organizationId: account.organizationId, actorUserId: opts.actor?.id, actorType: opts.actor ? "USER" : "SYSTEM", action: "SOCIAL_ACCOUNT_NEEDS_ATTENTION",
          resourceType: "social_account", resourceId: account.id, result: "FAILURE", metadata: { provider: account.provider, status, reason }, ipAddress: opts.meta?.ip, userAgent: opts.meta?.userAgent,
        });
        await notifyManagers(updated, `${account.displayName} needs attention`, status === "NEEDS_REAUTH" ? `Reconnect ${account.displayName} (${account.provider}) to keep it working. ${reason}` : `${account.displayName} (${account.provider}) failed a health check. ${reason}`);
      }
      return updated;
    };

    let tokens: SocialTokenSet | null;
    try {
      tokens = await loadTokens(account.id);
    } catch (err) {
      logger.error({ accountId: account.id, err: safeError(err) }, "[social] could not decrypt stored credentials");
      return fail("ERROR", "Stored credentials could not be read.");
    }
    if (!tokens) return fail("NEEDS_REAUTH", "No stored credentials; reconnect this account.");

    try {
      const expiresSoon = !!account.tokenExpiresAt && account.tokenExpiresAt.getTime() - Date.now() < EXPIRY_WARNING_MS;
      let expiresAt = account.tokenExpiresAt;
      if (expiresSoon) {
        try {
          tokens = await connector.refreshToken(tokens);
          await saveTokens(account.id, tokens);
          expiresAt = tokens.expiresAt ? new Date(tokens.expiresAt) : null;
        } catch (err) {
          return fail("NEEDS_REAUTH", `Token expires ${account.tokenExpiresAt!.toISOString().slice(0, 10)} and could not be refreshed. ${safeError(err, [tokens.accessToken, tokens.refreshToken])}`.slice(0, 300));
        }
      }
      const health = await connector.healthCheck(tokens);
      if (!health.ok) return fail("NEEDS_REAUTH", safeError(health.error ?? "The provider rejected the credentials.", [tokens.accessToken, tokens.refreshToken]));
      return prisma.socialAccount.update({
        where: { id: account.id },
        data: { status: "CONNECTED", lastSyncAt: new Date(), lastError: null, tokenExpiresAt: health.expiresAt ? new Date(health.expiresAt) : expiresAt },
        select: ACCOUNT_SELECT,
      });
    } catch (err) {
      return fail("ERROR", safeError(err, [tokens?.accessToken, tokens?.refreshToken]));
    }
  },

  /** Daily job: re-check every connected/errored account (bounded per run). Returns counts only. */
  async runTokenHealthJob(limit = 500): Promise<{ checked: number; needsAttention: number; errors: number }> {
    const accounts = await prisma.socialAccount.findMany({ where: { status: { in: ["CONNECTED", "ERROR"] } }, select: { id: true }, orderBy: { lastSyncAt: "asc" }, take: limit });
    let needsAttention = 0;
    let errors = 0;
    for (const { id } of accounts) {
      try {
        const result = await this.checkHealth(id);
        if (result.status === "NEEDS_REAUTH" || result.status === "ERROR") needsAttention += 1;
      } catch (err) {
        errors += 1;
        logger.error({ accountId: id, err: safeError(err) }, "[social] token health check crashed");
      }
    }
    return { checked: accounts.length, needsAttention, errors };
  },
};
