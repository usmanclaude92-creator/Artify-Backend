/**
 * Phase 17 — integrations registry.
 *
 * Two honest kinds:
 *  - SYSTEM integrations are configured through deployment environment
 *    variables. They are reported read-only, as configured / not configured
 *    (booleans only — never a value), with last-activity timestamps drawn
 *    from real tables. Nothing is called "connected" unless it has been
 *    verified.
 *  - CONFIGURABLE integrations are stored per organization, with the
 *    credential encrypted (secretBox) and only `secretLast4` ever returned.
 *    Status VERIFIED means the last test action genuinely succeeded.
 */
import type { Integration } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { config } from "../../config/env";
import { NotFoundError, ValidationError } from "../../core/errors";
import { decryptSecret, encryptSecret, encryptionKeySource, last4 } from "../../utils/secretBox";
import { assertSafeOutboundUrl } from "../../utils/outboundUrl";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";

interface CatalogEntry {
  provider: string;
  label: string;
  description: string;
  /** Non-secret config fields the provider accepts. */
  configFields: { key: string; label: string; required: boolean; placeholder?: string }[];
  secretLabel: string;
}

/** Providers the platform can genuinely store credentials for and verify. */
export const INTEGRATION_CATALOG: readonly CatalogEntry[] = [
  {
    provider: "custom_api",
    label: "Custom HTTP API",
    description: "An external HTTPS API. The credential is sent as a Bearer token when testing; automation actions can reference it as they gain support.",
    configFields: [
      { key: "baseUrl", label: "Base URL", required: true, placeholder: "https://api.example.com" },
      { key: "healthPath", label: "Health-check path", required: false, placeholder: "/health" },
    ],
    secretLabel: "API token",
  },
];

function catalogEntry(provider: string): CatalogEntry {
  const entry = INTEGRATION_CATALOG.find((c) => c.provider === provider);
  if (!entry) throw new NotFoundError("Unknown integration provider.");
  return entry;
}

export function projectIntegration(i: Integration) {
  return {
    id: i.id,
    provider: i.provider,
    name: i.name,
    enabled: i.enabled,
    config: i.config,
    hasSecret: !!i.secretCiphertext,
    secretLast4: i.secretLast4,
    status: i.status,
    lastVerifiedAt: i.lastVerifiedAt,
    lastSuccessAt: i.lastSuccessAt,
    lastFailureAt: i.lastFailureAt,
    lastError: i.lastError,
    updatedAt: i.updatedAt,
  };
}

function deriveStatus(i: Pick<Integration, "secretCiphertext" | "config">): "NOT_CONFIGURED" | "CONFIGURED" {
  const cfg = (i.config ?? {}) as Record<string, unknown>;
  return i.secretCiphertext && typeof cfg.baseUrl === "string" && cfg.baseUrl ? "CONFIGURED" : "NOT_CONFIGURED";
}

async function systemIntegrations(organizationId: string) {
  const [aiLast, aiFail, inboundLast, inboundRejected, endpoints, failedDeliveries, apiKeys] = await Promise.all([
    prisma.aIExecution.findFirst({ where: { organizationId, status: "COMPLETED" }, orderBy: { createdAt: "desc" }, select: { completedAt: true, createdAt: true } }),
    prisma.aIExecution.findFirst({ where: { organizationId, status: "FAILED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.webhookEvent.findFirst({ where: { organizationId, status: { in: ["VERIFIED", "PROCESSED"] } }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    prisma.webhookEvent.findFirst({ where: { organizationId, status: "REJECTED" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    prisma.webhookEndpoint.count({ where: { organizationId, deletedAt: null } }),
    prisma.webhookDelivery.count({ where: { organizationId, status: "FAILED", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
    prisma.apiKey.count({ where: { organizationId, revokedAt: null } }),
  ]);

  const storageConfigured =
    config.objectStorageProvider !== "none" && !!config.objectStorageBucket &&
    (config.objectStorageProvider === "supabase" ? !!config.supabaseStorageUrl && !!config.supabaseStorageServiceRoleKey : !!config.objectStorageAccessKeyId && !!config.objectStorageSecretAccessKey);

  const state = (configured: boolean) => (configured ? "configured" : "not_configured");
  return [
    {
      key: "ai_gemini", name: "AI provider (Gemini)", category: "AI", managedBy: "environment",
      status: state(config.aiProvider === "gemini" && !!config.geminiApiKey), verified: false,
      detail: config.aiProvider === "none" ? "AI is disabled (AI_PROVIDER=none)." : config.geminiApiKey ? "API key present (value never exposed)." : "GEMINI_API_KEY is not set.",
      lastSuccessAt: aiLast?.completedAt ?? aiLast?.createdAt ?? null, lastFailureAt: aiFail?.createdAt ?? null,
      requires: ["AI_PROVIDER=gemini", "GEMINI_API_KEY"],
    },
    {
      key: "object_storage", name: `Media storage (${config.objectStorageProvider})`, category: "Storage", managedBy: "environment",
      status: state(storageConfigured), verified: false,
      detail: storageConfigured ? "Provider credentials present." : "No production storage provider is fully configured.",
      lastSuccessAt: null, lastFailureAt: null, requires: ["OBJECT_STORAGE_PROVIDER", "OBJECT_STORAGE_BUCKET", "provider credentials"],
    },
    {
      key: "rate_limit_store", name: "Shared rate-limit store (Redis)", category: "Security", managedBy: "environment",
      status: state(!!config.redisUrl), verified: false,
      detail: config.redisUrl ? "REDIS_URL set." : "Not set — rate limits are per serverless instance, not shared.",
      lastSuccessAt: null, lastFailureAt: null, requires: ["REDIS_URL"],
    },
    {
      key: "cron", name: "Scheduled automation tick", category: "Automation", managedBy: "environment",
      status: state(!!config.cronSecret), verified: false,
      detail: config.cronSecret ? "CRON_SECRET set." : "CRON_SECRET not set — the tick endpoint is disabled.",
      lastSuccessAt: null, lastFailureAt: null, requires: ["CRON_SECRET"],
    },
    {
      key: "inbound_webhooks", name: "Inbound signed webhooks", category: "Webhooks", managedBy: "environment",
      status: state(!!config.webhookSecret), verified: false,
      detail: "Receives signed lead events at /api/v1/webhooks/leads.",
      lastSuccessAt: inboundLast?.receivedAt ?? null, lastFailureAt: inboundRejected?.receivedAt ?? null, requires: ["WEBHOOK_SECRET"],
    },
    {
      key: "public_website", name: "Public website content", category: "Website", managedBy: "environment",
      status: state(config.publicWebsiteOrganizationId === organizationId), verified: false,
      detail: config.publicWebsiteOrganizationId ? (config.publicWebsiteOrganizationId === organizationId ? "This organization serves the public website." : "Another organization serves the public website.") : "PUBLIC_WEBSITE_ORGANIZATION_ID is not set.",
      lastSuccessAt: null, lastFailureAt: null, requires: ["PUBLIC_WEBSITE_ORGANIZATION_ID"],
    },
    {
      key: "outbound_webhooks", name: "Outbound webhooks", category: "Webhooks", managedBy: "control-center",
      status: endpoints > 0 ? "configured" : "not_configured", verified: false,
      detail: `${endpoints} endpoint${endpoints === 1 ? "" : "s"}; ${failedDeliveries} failed delivery${failedDeliveries === 1 ? "" : "ies"} in the last 24h.`,
      lastSuccessAt: null, lastFailureAt: null, requires: [],
    },
    {
      key: "api_keys", name: "API keys", category: "API access", managedBy: "control-center",
      status: apiKeys > 0 ? "configured" : "not_configured", verified: false,
      detail: `${apiKeys} active key${apiKeys === 1 ? "" : "s"}.`, lastSuccessAt: null, lastFailureAt: null, requires: [],
    },
  ];
}

async function runTest(i: Integration): Promise<{ ok: boolean; error?: string }> {
  const cfg = i.config as { baseUrl?: string; healthPath?: string };
  try {
    const url = await assertSafeOutboundUrl(new URL(cfg.healthPath ?? "", cfg.baseUrl).toString());
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${decryptSecret(i.secretCiphertext!)}`, "user-agent": "Artify-Integrations/1.0" },
    });
    return res.status >= 200 && res.status < 300 ? { ok: true } : { ok: false, error: `Endpoint responded with HTTP ${res.status}.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 300) : "Connection test failed." };
  }
}

export const integrationService = {
  async overview(organizationId: string) {
    const rows = await prisma.integration.findMany({ where: { organizationId } });
    return {
      system: await systemIntegrations(organizationId),
      configurable: INTEGRATION_CATALOG.map((c) => ({
        ...c,
        integration: (() => {
          const row = rows.find((r) => r.provider === c.provider);
          return row ? projectIntegration(row) : null;
        })(),
      })),
      encryption: { source: encryptionKeySource() },
    };
  },

  async upsert(
    caller: SanitizedUser,
    provider: string,
    input: { name?: string; enabled?: boolean; config?: Record<string, string>; secret?: string },
    meta: RequestMeta = {}
  ) {
    const entry = catalogEntry(provider);
    const existing = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId: caller.organizationId, provider } } });

    let cfg = (existing?.config ?? {}) as Record<string, string>;
    if (input.config) {
      const allowed = new Set(entry.configFields.map((f) => f.key));
      const unknown = Object.keys(input.config).filter((k) => !allowed.has(k));
      if (unknown.length) throw new ValidationError(`Unknown configuration field(s): ${unknown.join(", ")}`);
      cfg = { ...cfg, ...input.config };
      for (const f of entry.configFields) if (f.required && !cfg[f.key]) throw new ValidationError(`${f.label} is required.`);
      if (cfg.baseUrl) await assertSafeOutboundUrl(cfg.baseUrl);
    }

    const secretChange = input.secret !== undefined ? { secretCiphertext: encryptSecret(input.secret), secretLast4: last4(input.secret) } : {};
    const merged = { secretCiphertext: input.secret !== undefined ? "set" : existing?.secretCiphertext ?? null, config: cfg };
    const credentialsChanged = input.secret !== undefined || input.config !== undefined;
    const data = {
      name: input.name ?? existing?.name ?? entry.label,
      enabled: input.enabled ?? existing?.enabled ?? false,
      config: cfg,
      ...secretChange,
      // Any change to credentials/target invalidates prior verification.
      ...(credentialsChanged ? { status: deriveStatus(merged), lastVerifiedAt: null, lastError: null } : {}),
    };
    if (data.enabled && deriveStatus(merged) === "NOT_CONFIGURED") throw new ValidationError("Configure the base URL and credential before enabling this integration.");

    const row = existing
      ? await prisma.integration.update({ where: { id: existing.id }, data })
      : await prisma.integration.create({ data: { ...data, organizationId: caller.organizationId, provider, createdById: caller.id, status: deriveStatus(merged) } });

    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER",
      action: input.secret !== undefined ? "INTEGRATION_CREDENTIAL_SET" : "INTEGRATION_UPDATED",
      resourceType: "integration", resourceId: row.id,
      afterData: { provider, enabled: row.enabled, configKeys: Object.keys(cfg), credentialRotated: input.secret !== undefined }, // never the secret
      ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return projectIntegration(row);
  },

  async test(caller: SanitizedUser, provider: string, meta: RequestMeta = {}) {
    catalogEntry(provider);
    const row = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId: caller.organizationId, provider } } });
    if (!row || deriveStatus(row) === "NOT_CONFIGURED") throw new ValidationError("Configure this integration before testing it.");
    const result = await runTest(row);
    const now = new Date();
    const updated = await prisma.integration.update({
      where: { id: row.id },
      data: result.ok
        ? { status: "VERIFIED", lastVerifiedAt: now, lastSuccessAt: now, lastError: null }
        : { status: "FAILING", lastVerifiedAt: now, lastFailureAt: now, lastError: result.error ?? "Connection test failed." },
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "INTEGRATION_TESTED",
      resourceType: "integration", resourceId: row.id, result: result.ok ? "SUCCESS" : "FAILURE", afterData: { provider, ok: result.ok }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return projectIntegration(updated);
  },

  async clearSecret(caller: SanitizedUser, provider: string, meta: RequestMeta = {}) {
    catalogEntry(provider);
    const row = await prisma.integration.findUnique({ where: { organizationId_provider: { organizationId: caller.organizationId, provider } } });
    if (!row) throw new NotFoundError("Integration not configured.");
    const updated = await prisma.integration.update({
      where: { id: row.id },
      data: { secretCiphertext: null, secretLast4: null, enabled: false, status: "NOT_CONFIGURED", lastVerifiedAt: null },
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "INTEGRATION_CREDENTIAL_REMOVED",
      resourceType: "integration", resourceId: row.id, afterData: { provider }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return projectIntegration(updated);
  },
};
