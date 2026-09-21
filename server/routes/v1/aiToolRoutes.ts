/** AI tool catalog + per-organization enablement routes (Phase 12 — docs/AI_TOOL_SECURITY.md). */
import { Router } from "express";
import { aiToolService } from "../../services/aiToolService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { updateAiOrgToolSettingSchema } from "../../schemas/aiSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown>; requestId?: string }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined, requestId: req.requestId };
}

router.get(
  "/",
  requirePermission("ai.tools.read"),
  asyncHandler(async (req, res) => {
    const tools = await aiToolService.listToolsForOrg(req.user!.organizationId);
    sendSuccess(res, { tools });
  })
);

router.patch(
  "/:code/settings",
  requirePermission("ai.tools.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiOrgToolSettingSchema.parse(req.body);
    const setting = await aiToolService.updateOrgSetting(req.user!, req.params.code!, input, requestMeta(req));
    sendSuccess(res, { setting });
  })
);

export default router;
