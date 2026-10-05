/**
 * Phase 17 — outbound webhook endpoints (the pre-existing webhookService only
 * handles INBOUND signed events). Subscribes to the existing EventEngine, so
 * the supported event catalog is exactly what the platform really emits — no
 * parallel event system.
 *
 * Delivery contract (document for receivers):
 *   POST <url>  Content-Type: application/json
 *   X-Artify-Event, X-Artify-Delivery, X-Artify-Timestamp (unix seconds)
 *   X-Artify-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${body}`)>
 * Same scheme (timestamp bound into the signed payload) the inbound verifier
 * uses. Retries: up to 5 attempts, backoff 1m/5m/30m/2h/6h, driven by the
 * automation cron tick (processDueRetries) and the manual retry endpoint.
 */
import { randomBytes } from "node:crypto";
import type { Prisma, WebhookDelivery, WebhookEndpoint } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { decryptSecret, encryptSecret, last4 } from "../../utils/secretBox";
import { signHmac } from "../../utils/crypto";
import { assertSafeOutboundUrl } from "../../utils/outboundUrl";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { EventEngine } from "../automation/EventEngine";
import type { BusinessEventPayload } from "../automation/types";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const REQUEST_TIMEOUT_MS = 4000;
const MAX_ENDPOINTS_PER_ORG = 20;
export const TEST_EVENT = "webhook.test";

export function newSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

/** Public projection — never includes the secret or its ciphertext. */
export function projectEndpoint(e: WebhookEndpoint) {
  return {
    id: e.id,
    name: e.name,
    url: e.url,
    events: e.events,
    enabled: e.enabled,
    secretLast4: e.secretLast4,
    lastDeliveryAt: e.lastDeliveryAt,
    lastSuccessAt: e.lastSuccessAt,
    lastFailureAt: e.lastFailureAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function projectDelivery(d: WebhookDelivery) {
  return {
    id: d.id,
    endpointId: d.endpointId,
    eventType: d.eventType,
    eventId: d.eventId,
    status: d.status,
    attempts: d.attempts,
    responseStatus: d.responseStatus,
    error: d.error,
    nextRetryAt: d.nextRetryAt,
    createdAt: d.createdAt,
    deliveredAt: d.deliveredAt,
  };
}

export function supportedEvents(): { eventType: string; description: string; sourceModule: string }[] {
  return EventEngine.getInstance()
    .listRegisteredEvents()
    .map((e) => ({ eventType: e.eventType, description: e.description, sourceModule: e.sourceModule }))
    .sort((a, b) => a.eventType.localeCompare(b.eventType));
}

function validateEvents(events: string[]): string[] {
  const allowed = new Set(supportedEvents().map((e) => e.eventType));
  const unique = [...new Set(events)];
  if (unique.length === 0) throw new ValidationError("Select at least one event.");
  if (unique.includes("*")) return ["*"];
  const unknown = unique.filter((e) => !allowed.has(e));
  if (unknown.length) throw new ValidationError(`Unsupported event type(s): ${unknown.join(", ")}`);
  return unique;
}

async function loadInOrg(id: string, organizationId: string): Promise<WebhookEndpoint> {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, organizationId, deletedAt: null } });
  if (!endpoint) throw new NotFoundError("Webhook endpoint not found.");
  return endpoint;
}

async function attempt(endpoint: WebhookEndpoint, delivery: WebhookDelivery): Promise<WebhookDelivery> {
  const attempts = delivery.attempts + 1;
  let responseStatus: number | null = null;
  let error: string | null = null;
  try {
    const url = await assertSafeOutboundUrl(endpoint.url);
    const body = JSON.stringify({ id: delivery.eventId, type: delivery.eventType, createdAt: delivery.createdAt.toISOString(), data: delivery.payload });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signHmac(decryptSecret(endpoint.secretCiphertext), `${timestamp}.${body}`);
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual", // never follow redirects — they could point at an internal address
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "content-type": "application/json",
        "user-agent": "Artify-Webhooks/1.0",
        "x-artify-event": delivery.eventType,
        "x-artify-delivery": delivery.id,
        "x-artify-timestamp": timestamp,
        "x-artify-signature": `sha256=${signature}`,
      },
      body,
    });
    responseStatus = res.status;
    if (res.status < 200 || res.status >= 300) error = `Endpoint responded with HTTP ${res.status}.`;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 300) : "Delivery failed.";
  }

  const ok = error === null;
  const exhausted = !ok && attempts >= MAX_ATTEMPTS;
  const updated = await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      attempts,
      responseStatus,
      error,
      status: ok ? "SUCCEEDED" : exhausted ? "FAILED" : "PENDING",
      deliveredAt: ok ? new Date() : null,
      nextRetryAt: ok || exhausted ? null : new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!),
    },
  });
  await prisma.webhookEndpoint.update({
    where: { id: endpoint.id },
    data: { lastDeliveryAt: new Date(), ...(ok ? { lastSuccessAt: new Date() } : { lastFailureAt: new Date() }) },
  });
  return updated;
}

async function createAndAttempt(endpoint: WebhookEndpoint, eventId: string, eventType: string, payload: Prisma.InputJsonValue): Promise<WebhookDelivery | null> {
  try {
    const delivery = await prisma.webhookDelivery.create({
      data: { endpointId: endpoint.id, organizationId: endpoint.organizationId, eventType, eventId, payload },
    });
    return await attempt(endpoint, delivery);
  } catch (err) {
    // (endpointId, eventId) unique => a duplicate emit is simply ignored.
    logger.warn({ err, endpointId: endpoint.id, eventType }, "[webhooks] delivery not created");
    return null;
  }
}

export const webhookEndpointService = {
  async list(organizationId: string) {
    const endpoints = await prisma.webhookEndpoint.findMany({ where: { organizationId, deletedAt: null }, orderBy: { createdAt: "desc" } });
    const since = new Date(Date.now() - 24 * 3600_000);
    const stats = await prisma.webhookDelivery.groupBy({
      by: ["endpointId", "status"],
      where: { organizationId, createdAt: { gte: since } },
      _count: true,
    });
    return endpoints.map((e) => ({
      ...projectEndpoint(e),
      last24h: {
        succeeded: stats.find((s) => s.endpointId === e.id && s.status === "SUCCEEDED")?._count ?? 0,
        failed: stats.find((s) => s.endpointId === e.id && s.status === "FAILED")?._count ?? 0,
        pending: stats.find((s) => s.endpointId === e.id && s.status === "PENDING")?._count ?? 0,
      },
    }));
  },

  async create(caller: SanitizedUser, input: { name: string; url: string; events: string[] }, meta: RequestMeta = {}) {
    const count = await prisma.webhookEndpoint.count({ where: { organizationId: caller.organizationId, deletedAt: null } });
    if (count >= MAX_ENDPOINTS_PER_ORG) throw new ConflictError(`An organization can have at most ${MAX_ENDPOINTS_PER_ORG} webhook endpoints.`);
    await assertSafeOutboundUrl(input.url);
    const events = validateEvents(input.events);
    const secret = newSigningSecret();
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        organizationId: caller.organizationId,
        name: input.name,
        url: input.url,
        events,
        secretCiphertext: encryptSecret(secret),
        secretLast4: last4(secret),
        createdById: caller.id,
      },
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "WEBHOOK_ENDPOINT_CREATED",
      resourceType: "webhook_endpoint", resourceId: endpoint.id, afterData: { name: endpoint.name, url: endpoint.url, events }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    // The signing secret is returned exactly once, here.
    return { endpoint: projectEndpoint(endpoint), secret };
  },

  async update(caller: SanitizedUser, id: string, input: { name?: string; url?: string; events?: string[]; enabled?: boolean }, meta: RequestMeta = {}) {
    const existing = await loadInOrg(id, caller.organizationId);
    if (input.url !== undefined) await assertSafeOutboundUrl(input.url);
    const endpoint = await prisma.webhookEndpoint.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.events !== undefined ? { events: validateEvents(input.events) } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "WEBHOOK_ENDPOINT_UPDATED",
      resourceType: "webhook_endpoint", resourceId: id, beforeData: { url: existing.url, events: existing.events, enabled: existing.enabled },
      afterData: { url: endpoint.url, events: endpoint.events, enabled: endpoint.enabled }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return projectEndpoint(endpoint);
  },

  async rotateSecret(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    const existing = await loadInOrg(id, caller.organizationId);
    const secret = newSigningSecret();
    const endpoint = await prisma.webhookEndpoint.update({ where: { id: existing.id }, data: { secretCiphertext: encryptSecret(secret), secretLast4: last4(secret) } });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "WEBHOOK_SECRET_ROTATED",
      resourceType: "webhook_endpoint", resourceId: id, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return { endpoint: projectEndpoint(endpoint), secret };
  },

  async remove(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    const existing = await loadInOrg(id, caller.organizationId);
    await prisma.webhookEndpoint.update({ where: { id: existing.id }, data: { deletedAt: new Date(), enabled: false } });
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: "WEBHOOK_ENDPOINT_DELETED",
      resourceType: "webhook_endpoint", resourceId: id, beforeData: { name: existing.name, url: existing.url }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
  },

  async test(caller: SanitizedUser, id: string) {
    const endpoint = await loadInOrg(id, caller.organizationId);
    const eventId = `test_${randomBytes(8).toString("hex")}`;
    const delivery = await createAndAttempt(endpoint, eventId, TEST_EVENT, { message: "Test delivery from Artify Control Center." });
    if (!delivery) throw new ConflictError("Test delivery could not be created.");
    return projectDelivery(delivery);
  },

  async listDeliveries(organizationId: string, endpointId: string, page: number, limit: number) {
    await loadInOrg(endpointId, organizationId);
    const where = { endpointId, organizationId };
    const [rows, total] = await Promise.all([
      prisma.webhookDelivery.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.webhookDelivery.count({ where }),
    ]);
    return { deliveries: rows.map(projectDelivery), total };
  },

  async retryDelivery(caller: SanitizedUser, deliveryId: string) {
    const delivery = await prisma.webhookDelivery.findFirst({ where: { id: deliveryId, organizationId: caller.organizationId } });
    if (!delivery) throw new NotFoundError("Delivery not found.");
    if (delivery.status === "SUCCEEDED") throw new ConflictError("This delivery already succeeded.");
    const endpoint = await loadInOrg(delivery.endpointId, caller.organizationId);
    return projectDelivery(await attempt(endpoint, delivery));
  },

  /** Fan an event out to every enabled, subscribed endpoint in its organization. */
  async dispatch(event: BusinessEventPayload): Promise<void> {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { organizationId: event.organizationId, enabled: true, deletedAt: null, OR: [{ events: { has: event.eventType } }, { events: { has: "*" } }] },
    });
    await Promise.all(
      endpoints.map((endpoint) =>
        createAndAttempt(endpoint, event.eventId, event.eventType, {
          entityType: event.entityType, entityId: event.entityId, occurredAt: event.timestamp, payload: event.payload,
        } as Prisma.InputJsonValue)
      )
    );
  },

  /** Cron-driven: re-attempt deliveries whose backoff has elapsed. */
  async processDueRetries(limit = 25): Promise<number> {
    const due = await prisma.webhookDelivery.findMany({
      where: { status: "PENDING", nextRetryAt: { lte: new Date() }, endpoint: { enabled: true, deletedAt: null } },
      include: { endpoint: true },
      orderBy: { nextRetryAt: "asc" },
      take: limit,
    });
    for (const d of due) await attempt(d.endpoint, d);
    return due.length;
  },
};

let subscribed = false;
/** Idempotent — wires the dispatcher into the shared EventEngine once per process. */
export function registerWebhookDispatcher(): void {
  if (subscribed) return;
  subscribed = true;
  EventEngine.getInstance().subscribe(async (event) => {
    try {
      await webhookEndpointService.dispatch(event);
    } catch (err) {
      logger.error({ err, eventType: event.eventType }, "[webhooks] dispatch failed");
    }
  });
}
