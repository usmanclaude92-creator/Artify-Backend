/** Phase 17 — integrations registry, outbound webhook endpoints, and API keys. */
import { Router } from "express";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { sensitiveActionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { integrationService } from "../../services/admin/integrationService";
import { supportedEvents, webhookEndpointService } from "../../services/admin/webhookEndpointService";
import { apiKeyService } from "../../services/admin/apiKeyService";
import {
  createApiKeySchema, createWebhookEndpointSchema, pageQuerySchema, updateWebhookEndpointSchema, upsertIntegrationSchema,
} from "../../schemas/adminSchemas";
import type { Request } from "express";

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });
/** Responses carrying a one-time secret must never be cached by a browser or proxy. */
const noStore = (res: import("express").Response) => res.setHeader("Cache-Control", "no-store");

// ---- /integrations ----
export const integrationsRouter = Router();
integrationsRouter.use(authenticateToken);
integrationsRouter.get("/", requirePermission("integrations.read"), asyncHandler(async (req, res) => sendSuccess(res, await integrationService.overview(req.user!.organizationId))));
integrationsRouter.put(
  "/:provider",
  requirePermission("integrations.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = upsertIntegrationSchema.parse(req.body);
    sendSuccess(res, { integration: await integrationService.upsert(req.user!, req.params.provider!, input, meta(req)) });
  })
);
integrationsRouter.post(
  "/:provider/test",
  requirePermission("integrations.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => sendSuccess(res, { integration: await integrationService.test(req.user!, req.params.provider!, meta(req)) }))
);
integrationsRouter.delete(
  "/:provider/secret",
  requirePermission("integrations.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => sendSuccess(res, { integration: await integrationService.clearSecret(req.user!, req.params.provider!, meta(req)) }))
);

// ---- /webhook-endpoints ----
export const webhookEndpointsRouter = Router();
webhookEndpointsRouter.use(authenticateToken);
webhookEndpointsRouter.get("/events", requirePermission("webhooks.read"), (_req, res) => sendSuccess(res, { events: supportedEvents() }));
webhookEndpointsRouter.get("/", requirePermission("webhooks.read"), asyncHandler(async (req, res) => sendSuccess(res, { endpoints: await webhookEndpointService.list(req.user!.organizationId) })));
webhookEndpointsRouter.post(
  "/",
  requirePermission("webhooks.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = createWebhookEndpointSchema.parse(req.body);
    noStore(res);
    sendSuccess(res, await webhookEndpointService.create(req.user!, input, meta(req)), 201);
  })
);
webhookEndpointsRouter.patch(
  "/:id",
  requirePermission("webhooks.manage"),
  asyncHandler(async (req, res) => sendSuccess(res, { endpoint: await webhookEndpointService.update(req.user!, req.params.id!, updateWebhookEndpointSchema.parse(req.body), meta(req)) }))
);
webhookEndpointsRouter.post(
  "/:id/rotate-secret",
  requirePermission("webhooks.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    noStore(res);
    sendSuccess(res, await webhookEndpointService.rotateSecret(req.user!, req.params.id!, meta(req)));
  })
);
webhookEndpointsRouter.post(
  "/:id/test",
  requirePermission("webhooks.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => sendSuccess(res, { delivery: await webhookEndpointService.test(req.user!, req.params.id!) }))
);
webhookEndpointsRouter.delete(
  "/:id",
  requirePermission("webhooks.manage"),
  asyncHandler(async (req, res) => {
    await webhookEndpointService.remove(req.user!, req.params.id!, meta(req));
    sendSuccess(res, { message: "Webhook endpoint deleted." });
  })
);
webhookEndpointsRouter.get(
  "/:id/deliveries",
  requirePermission("webhooks.read"),
  asyncHandler(async (req, res) => {
    const { page, limit } = pageQuerySchema.parse(req.query);
    const { deliveries, total } = await webhookEndpointService.listDeliveries(req.user!.organizationId, req.params.id!, page, limit);
    sendSuccess(res, { deliveries }, 200, { page, limit, total });
  })
);
webhookEndpointsRouter.post(
  "/deliveries/:deliveryId/retry",
  requirePermission("webhooks.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => sendSuccess(res, { delivery: await webhookEndpointService.retryDelivery(req.user!, req.params.deliveryId!) }))
);

// ---- /api-keys ----
export const apiKeysRouter = Router();
apiKeysRouter.use(authenticateToken);
apiKeysRouter.get("/", requirePermission("api_keys.read"), asyncHandler(async (req, res) => sendSuccess(res, { apiKeys: await apiKeyService.list(req.user!.organizationId) })));
apiKeysRouter.post(
  "/",
  requirePermission("api_keys.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = createApiKeySchema.parse(req.body);
    noStore(res);
    sendSuccess(res, await apiKeyService.create(req.user!, input, meta(req)), 201);
  })
);
apiKeysRouter.post(
  "/:id/revoke",
  requirePermission("api_keys.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => sendSuccess(res, { apiKey: await apiKeyService.revoke(req.user!, req.params.id!, meta(req)) }))
);
