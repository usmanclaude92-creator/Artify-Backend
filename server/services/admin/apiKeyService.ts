/**
 * Phase 17 — API keys for machine access. Keys are shown once at creation and
 * stored only as a SHA-256 hash (they are high-entropy random values that are
 * verified, never recovered — same model as Session.tokenHash). Scopes are
 * permission keys, capped at what the creating user themselves holds and never
 * including the administrative "critical" permissions.
 */
import { randomBytes } from "node:crypto";
import type { ApiKey } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { hashToken } from "../../utils/crypto";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { isPermissionKey, type SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";
import { CRITICAL_PERMISSIONS } from "./criticalPermissions";

const KEY_PREFIX = "artify_ak_";
const MAX_ACTIVE_KEYS = 25;
const MAX_LIFETIME_DAYS = 365;
const LAST_USED_THROTTLE_MS = 60_000;

export function generateApiKey(): string {
  return `${KEY_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function projectApiKey(k: ApiKey) {
  const now = Date.now();
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
    status: k.revokedAt ? "revoked" : k.expiresAt && k.expiresAt.getTime() <= now ? "expired" : "active",
  };
}

function validateScopes(caller: SanitizedUser, scopes: string[]): string[] {
  const unique = [...new Set(scopes)];
  if (unique.length === 0) throw new ValidationError("Select at least one scope.");
  const invalid = unique.filter((s) => !isPermissionKey(s));
  if (invalid.length) throw new ValidationError(`Unknown scope(s): ${invalid.join(", ")}`);
  const critical = unique.filter((s) => CRITICAL_PERMISSIONS.includes(s));
  if (critical.length) throw new ValidationError(`Administrative scope(s) cannot be granted to an API key: ${critical.join(", ")}`);
  if (caller.role.key !== "SUPER_ADMIN") {
    const exceeding = unique.filter((s) => !caller.role.permissions.includes(s));
    if (exceeding.length) throw new ValidationError(`You cannot grant scopes you do not hold yourself: ${exceeding.join(", ")}`);
  }
  return unique;
}

export const apiKeyService = {
  async list(organizationId: string) {
    const keys = await prisma.apiKey.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } });
    return keys.map(projectApiKey);
  },

  async create(caller: SanitizedUser, input: { name: string; scopes: string[]; expiresInDays?: number }, meta: RequestMeta = {}) {
    const active = await prisma.apiKey.count({ where: { organizationId: caller.organizationId, revokedAt: null } });
    if (active >= MAX_ACTIVE_KEYS) throw new ConflictError(`An organization can have at most ${MAX_ACTIVE_KEYS} active API keys.`);
    const scopes = validateScopes(caller, input.scopes);
    if (input.expiresInDays !== undefined && (input.expiresInDays < 1 || input.expiresInDays > MAX_LIFETIME_DAYS)) {
      throw new ValidationError(`Expiry must be between 1 and ${MAX_LIFETIME_DAYS} days.`);
    }

    const key = generateApiKey();
    const record = await prisma.apiKey.create({
      data: {
        organizationId: caller.organizationId,
        name: input.name,
        prefix: key.slice(0, KEY_PREFIX.length + 6),
        keyHash: hashToken(key),
        scopes,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000) : null,
        createdById: caller.id,
      },
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "API_KEY_CREATED",
      resourceType: "api_key", resourceId: record.id, afterData: { name: record.name, scopes, expiresAt: record.expiresAt?.toISOString() ?? null }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    // The plaintext key exists only in this response.
    return { apiKey: projectApiKey(record), key };
  },

  async revoke(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    const existing = await prisma.apiKey.findFirst({ where: { id, organizationId: caller.organizationId } });
    if (!existing) throw new NotFoundError("API key not found.");
    if (existing.revokedAt) return projectApiKey(existing);
    const updated = await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "API_KEY_REVOKED",
      resourceType: "api_key", resourceId: id, beforeData: { name: existing.name }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return projectApiKey(updated);
  },

  /** Resolves a presented key to its record, or null for unknown/revoked/expired — callers must not distinguish. */
  async verify(presented: string, ip?: string): Promise<ApiKey | null> {
    if (!presented.startsWith(KEY_PREFIX)) return null;
    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashToken(presented) } });
    if (!key || key.revokedAt) return null;
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null;
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip ?? null } }).catch(() => undefined);
    }
    return key;
  },
};
