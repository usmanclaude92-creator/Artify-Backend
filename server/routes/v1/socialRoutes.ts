/** Social Media — connected accounts. Read needs social.read; every mutation needs social.accounts.manage. Responses never contain token material. */
import { Router, type Request } from "express";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { sensitiveActionLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { socialAccountService } from "../../services/social/socialAccountService";
import { connectCallbackSchema, connectSelectSchema, connectStartSchema } from "../../schemas/socialSchemas";
import { providerSetup } from "../../services/social/connectors/setupInfo";
import { NotFoundError } from "../../core/errors";

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"] });
const noStore = (res: import("express").Response) => res.setHeader("Cache-Control", "no-store");

export const socialAccountsRouter = Router();
socialAccountsRouter.use(authenticateToken);

socialAccountsRouter.get("/", requirePermission("social.read"), asyncHandler(async (req, res) => sendSuccess(res, await socialAccountService.list(req.user!.organizationId))));

socialAccountsRouter.post(
  "/connect/start",
  requirePermission("social.accounts.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = connectStartSchema.parse(req.body);
    noStore(res);
    sendSuccess(res, await socialAccountService.startConnect(req.user!, input.provider, input.accountId));
  })
);

socialAccountsRouter.post(
  "/callback",
  requirePermission("social.accounts.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = connectCallbackSchema.parse(req.body);
    noStore(res);
    // Either { account, warnings? } (single asset) or { selection } (the user must pick which assets to connect).
    sendSuccess(res, await socialAccountService.handleCallback(req.user!, input, meta(req)));
  })
);

socialAccountsRouter.post(
  "/connect/select",
  requirePermission("social.accounts.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    noStore(res);
    sendSuccess(res, await socialAccountService.completeSelection(req.user!, connectSelectSchema.parse(req.body), meta(req)));
  })
);

socialAccountsRouter.get(
  "/providers/:provider/setup",
  requirePermission("social.accounts.manage"),
  asyncHandler(async (req, res) => {
    const setup = providerSetup(String(req.params.provider));
    if (!setup) throw new NotFoundError("No setup guide for this provider.");
    sendSuccess(res, { setup });
  })
);

socialAccountsRouter.get("/:id", requirePermission("social.read"), asyncHandler(async (req, res) => sendSuccess(res, { account: await socialAccountService.get(req.user!.organizationId, req.params.id!) })));

socialAccountsRouter.post(
  "/:id/reconnect",
  requirePermission("social.accounts.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const account = await socialAccountService.get(req.user!.organizationId, req.params.id!);
    noStore(res);
    sendSuccess(res, await socialAccountService.startConnect(req.user!, account.provider, account.id));
  })
);

socialAccountsRouter.post(
  "/:id/disconnect",
  requirePermission("social.accounts.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => sendSuccess(res, { account: await socialAccountService.disconnect(req.user!, req.params.id!, meta(req)) }))
);

socialAccountsRouter.post(
  "/:id/health",
  requirePermission("social.accounts.manage"),
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    await socialAccountService.get(req.user!.organizationId, req.params.id!); // workspace scope check first
    sendSuccess(res, { account: await socialAccountService.checkHealth(req.params.id!, { actor: req.user!, meta: meta(req) }) });
  })
);
