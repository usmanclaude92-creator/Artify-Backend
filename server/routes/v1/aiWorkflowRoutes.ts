/** AI workflow routes (Phase 12 — docs/AI_WORKFLOW_ARCHITECTURE.md). Execution is rate-limited (aiExecutionLimiter) since each run can invoke multiple governed tool calls. */
import { Router } from "express";
import { aiWorkflowService } from "../../services/aiWorkflowService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { aiExecutionLimiter } from "../../middleware/rateLimiter";
import { createAiWorkflowSchema, executeAiWorkflowSchema, listAiWorkflowsQuerySchema, updateAiWorkflowSchema } from "../../schemas/aiSchemas";

const router = Router();

router.use(authenticateToken);

function requestMeta(req: { ip?: string; headers: Record<string, unknown>; requestId?: string }) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] as string | undefined, requestId: req.requestId };
}

router.get(
  "/",
  requirePermission("ai.workflows.read"),
  asyncHandler(async (req, res) => {
    const query = listAiWorkflowsQuerySchema.parse(req.query);
    const { rows, total } = await aiWorkflowService.listWorkflows(
      req.user!.organizationId,
      { search: query.search },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { workflows: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("ai.workflows.read"),
  asyncHandler(async (req, res) => {
    const workflow = await aiWorkflowService.getWorkflow(req.user!.organizationId, req.params.id!);
    sendSuccess(res, { workflow });
  })
);

router.post(
  "/",
  requirePermission("ai.workflows.create"),
  asyncHandler(async (req, res) => {
    const input = createAiWorkflowSchema.parse(req.body);
    const workflow = await aiWorkflowService.createWorkflow(req.user!, input, requestMeta(req));
    sendSuccess(res, { workflow }, 201);
  })
);

router.patch(
  "/:id",
  requirePermission("ai.workflows.update"),
  asyncHandler(async (req, res) => {
    const input = updateAiWorkflowSchema.parse(req.body);
    const workflow = await aiWorkflowService.updateWorkflow(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { workflow });
  })
);

router.post(
  "/:id/publish",
  requirePermission("ai.workflows.publish"),
  asyncHandler(async (req, res) => {
    const workflow = await aiWorkflowService.publishWorkflow(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { workflow });
  })
);

router.delete(
  "/:id",
  requirePermission("ai.workflows.delete"),
  asyncHandler(async (req, res) => {
    const workflow = await aiWorkflowService.archiveWorkflow(req.user!, req.params.id!, requestMeta(req));
    sendSuccess(res, { workflow });
  })
);

router.post(
  "/:id/execute",
  requirePermission("ai.workflows.execute"),
  aiExecutionLimiter,
  asyncHandler(async (req, res) => {
    const input = executeAiWorkflowSchema.parse(req.body);
    const execution = await aiWorkflowService.executeWorkflow(req.user!, req.params.id!, input, requestMeta(req));
    sendSuccess(res, { execution }, 202);
  })
);

export default router;
