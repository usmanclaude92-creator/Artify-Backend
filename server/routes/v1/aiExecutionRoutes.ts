/** Direct AI tool-call execution + execution history routes (Phase 12 — docs/AI_ARCHITECTURE.md §19). */
import { Router } from "express";
import { aiExecutionService } from "../../services/aiExecutionService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { aiExecutionLimiter } from "../../middleware/rateLimiter";
import { executeAiToolSchema, listAiExecutionsQuerySchema } from "../../schemas/aiSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown>; requestId?: string }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined, requestId: req.requestId };
}

router.get(
  "/",
  requirePermission("ai.executions.read"),
  asyncHandler(async (req, res) => {
    const query = listAiExecutionsQuerySchema.parse(req.query);
    const { rows, total } = await aiExecutionService.listExecutions(
      req.user!.organizationId,
      { kind: query.kind, status: query.status },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { executions: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("ai.executions.read"),
  asyncHandler(async (req, res) => {
    const execution = await aiExecutionService.getExecution(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { execution });
  })
);

router.post(
  "/tool-call",
  // Reuses ai.workflows.execute — "can invoke governed AI actions" is one
  // capability whether the call is wrapped in a workflow or made directly;
  // server/ai/governance.ts still checks the specific tool's own
  // requiredPermission on top of this route-level gate.
  requirePermission("ai.workflows.execute"),
  aiExecutionLimiter,
  asyncHandler(async (req, res) => {
    const input = executeAiToolSchema.parse(req.body);
    const execution = await aiExecutionService.executeTool(req.user!, input, requestMeta(req));
    sendSuccess(res, { execution }, 202);
  })
);

export default router;
