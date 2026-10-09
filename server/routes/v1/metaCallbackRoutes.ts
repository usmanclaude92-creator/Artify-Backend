/**
 * Public Meta platform callbacks (Step 15). No session: authenticity comes from the HMAC `signed_request` (app secret). Every failure is closed:
 *  400 for a missing/malformed/tampered/expired request, 503 when the app secret is not configured. Nothing about the person is echoed back.
 * Meta app settings: "Deauthorize callback URL" = POST /api/v1/meta/deauthorize ; "Data deletion request URL" = POST /api/v1/meta/data-deletion
 */
import { Router, type Request } from "express";
import { metaCallbackLimiter } from "../../middleware/rateLimiter";
import { asyncHandler } from "../../utils/asyncHandler";
import { metaCallbackService } from "../../services/meta/metaCallbackService";
import { SignedRequestError } from "../../services/meta/signedRequest";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { sendError, ApiErrorCode, sendSuccess } from "../../core/apiResponse";
import type { Response } from "express";

const router = Router();
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId });

async function rejected(req: Request, res: Response, kind: string, e: SignedRequestError) {
  await auditLogRepository.record({ actorType: "SYSTEM", action: "META_CALLBACK_REJECTED", resourceType: "meta_callback", result: "FAILURE", metadata: { kind, reason: e.reason }, ipAddress: req.ip, userAgent: req.headers["user-agent"] }).catch(() => undefined);
  if (e.reason === "not_configured") return res.status(503).json({ error: "Meta callbacks are not configured." });
  return res.status(400).json({ error: "Invalid request." });
}

router.post("/data-deletion", metaCallbackLimiter, asyncHandler(async (req, res) => {
  try {
    const out = await metaCallbackService.requestDeletion((req.body as Record<string, unknown> | undefined)?.signed_request, meta(req));
    res.status(200).json(out); // exactly { url, confirmation_code }: the shape Meta expects
  } catch (e) {
    if (e instanceof SignedRequestError) return void (await rejected(req, res, "deletion", e));
    throw e;
  }
}));

router.post("/deauthorize", metaCallbackLimiter, asyncHandler(async (req, res) => {
  try {
    await metaCallbackService.deauthorize((req.body as Record<string, unknown> | undefined)?.signed_request, meta(req));
    res.status(200).json({ ok: true });
  } catch (e) {
    if (e instanceof SignedRequestError) return void (await rejected(req, res, "deauthorize", e));
    throw e;
  }
}));

/** A person (or reviewer) opening a callback URL in a browser sends GET. Say what the URL is for instead of a bare 404. Meta itself only POSTs. */
for (const path of ["/data-deletion", "/deauthorize"]) {
  router.get(path, (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "This address only accepts POST requests sent by Meta (Facebook / Instagram). Nothing to see here." });
  });
}

/** Public status lookup for a deletion confirmation code (used by the website's /data-deletion-status page). */
router.get("/deletion-status", metaCallbackLimiter, asyncHandler(async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const status = await metaCallbackService.deletionStatus(code);
  if (!status) return void sendError(res, 404, ApiErrorCode.RESOURCE_NOT_FOUND, "No request found for this code.");
  sendSuccess(res, status);
}));

export default router;
