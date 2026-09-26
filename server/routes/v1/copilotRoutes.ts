/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 15: AI Copilot & Conversational Workspace — API Routes
 * (imported from usmanclaude92-creator/Artify-Backend---Google-AI-Studio-,
 * commit 4a1d7cd). Adapted from the source repo's raw try/catch +
 * `res.json({success,...})` handlers to this repo's `asyncHandler` +
 * `sendSuccess` convention.
 */
import { Router } from "express";
import { CopilotService } from "../../services/copilot/CopilotService";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { ValidationError } from "../../core/errors";

const router = Router();

// All copilot endpoints require authenticated tenant session
router.use(authenticateToken);

/**
 * GET /api/v1/copilot/workspaces
 * List workspaces accessible to current user based on RBAC permissions.
 */
router.get(
  "/workspaces",
  asyncHandler(async (req, res) => {
    const permissions = req.user!.role.permissions || [];
    const workspaces = await CopilotService.listWorkspaces(req.user!.organizationId, permissions);
    sendSuccess(res, { workspaces });
  })
);

/**
 * POST /api/v1/copilot/workspaces
 * Create a custom workspace (requires copilot.manage).
 */
router.post(
  "/workspaces",
  requirePermission("copilot.manage"),
  asyncHandler(async (req, res) => {
    if (!req.body.name || !req.body.name.trim()) {
      throw new ValidationError("Workspace name is required.");
    }

    const workspace = await CopilotService.createWorkspace(req.user!.organizationId, req.user!.id, req.body);
    sendSuccess(res, { workspace }, 201);
  })
);

/**
 * GET /api/v1/copilot/workspaces/:id
 */
router.get(
  "/workspaces/:id",
  asyncHandler(async (req, res) => {
    const permissions = req.user!.role.permissions || [];
    const workspace = await CopilotService.getWorkspace(req.params.id!, req.user!.organizationId, permissions);
    sendSuccess(res, { workspace });
  })
);

/**
 * GET /api/v1/copilot/conversations
 * List user's conversations with optional filters (workspaceId, status, search).
 */
router.get(
  "/conversations",
  requirePermission("copilot.read"),
  asyncHandler(async (req, res) => {
    const result = await CopilotService.listConversations(req.user!.organizationId, req.user!.id, {
      workspaceId: req.query.workspaceId ? String(req.query.workspaceId) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 20,
      offset: req.query.offset ? parseInt(String(req.query.offset), 10) : 0,
    });
    sendSuccess(res, result);
  })
);

/**
 * POST /api/v1/copilot/conversations
 * Create a new conversation.
 */
router.post(
  "/conversations",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const conversation = await CopilotService.createConversation(req.user!.organizationId, req.user!.id, req.body);
    sendSuccess(res, { conversation }, 201);
  })
);

/**
 * GET /api/v1/copilot/conversations/:id
 * Retrieve conversation details with recent messages and active action previews.
 */
router.get(
  "/conversations/:id",
  requirePermission("copilot.read"),
  asyncHandler(async (req, res) => {
    const conversation = await CopilotService.getConversation(req.params.id!, req.user!.organizationId, req.user!.id);
    sendSuccess(res, { conversation });
  })
);

/**
 * POST /api/v1/copilot/conversations/:id/archive
 */
router.post(
  "/conversations/:id/archive",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const updated = await CopilotService.archiveConversation(req.params.id!, req.user!.organizationId, req.user!.id);
    sendSuccess(res, { conversation: updated });
  })
);

/**
 * DELETE /api/v1/copilot/conversations/:id
 */
router.delete(
  "/conversations/:id",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const result = await CopilotService.deleteConversation(req.params.id!, req.user!.organizationId, req.user!.id);
    sendSuccess(res, result);
  })
);

/**
 * POST /api/v1/copilot/messages
 * Send a message turn in a conversation.
 */
router.post(
  "/messages",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const permissions = req.user!.role.permissions || [];

    if (!req.body.content || !req.body.content.trim()) {
      throw new ValidationError("Message content is required.");
    }

    const result = await CopilotService.sendMessage(
      {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        userPermissions: permissions,
        displayName: req.user!.email?.split("@")[0] || "User",
      },
      {
        conversationId: req.body.conversationId,
        workspaceId: req.body.workspaceId,
        content: req.body.content,
        mode: req.body.mode,
        contextMetadata: req.body.contextMetadata,
      }
    );

    sendSuccess(res, result);
  })
);

/**
 * POST /api/v1/copilot/messages/stream
 * Stream Copilot conversation turn via Server-Sent Events (SSE).
 */
router.post(
  "/messages/stream",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const permissions = req.user!.role.permissions || [];

    if (!req.body.content || !req.body.content.trim()) {
      throw new ValidationError("Message content is required.");
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent("start", { status: "PROCESSING" });

    try {
      const result = await CopilotService.sendMessage(
        {
          organizationId: req.user!.organizationId,
          userId: req.user!.id,
          userPermissions: permissions,
          displayName: req.user!.email?.split("@")[0] || "User",
        },
        {
          conversationId: req.body.conversationId,
          workspaceId: req.body.workspaceId,
          content: req.body.content,
          mode: req.body.mode,
          contextMetadata: req.body.contextMetadata,
        }
      );

      if (result.citations && result.citations.length > 0) {
        sendEvent("citations", result.citations);
      }

      if (result.toolResults && result.toolResults.length > 0) {
        sendEvent("tool_calls", result.toolResults);
      }

      if (result.actionPreview) {
        sendEvent("action_preview", result.actionPreview);
      }

      // Stream text chunks
      const fullText = result.assistantMessage.content;
      const words = fullText.split(" ");
      for (let i = 0; i < words.length; i += 3) {
        const chunk = words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
        sendEvent("chunk", { text: chunk });
      }

      sendEvent("done", {
        conversationId: result.conversationId,
        messageId: result.assistantMessage.id,
        correlationId: result.correlationId,
      });

      res.end();
    } catch (error: any) {
      sendEvent("error", { error: error.message });
      res.end();
    }
  })
);

/**
 * POST /api/v1/copilot/actions/:id/confirm
 * Confirm and execute a pending consequential action preview.
 */
router.post(
  "/actions/:id/confirm",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const permissions = req.user!.role.permissions || [];
    const result = await CopilotService.confirmAction(req.params.id!, {
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      userPermissions: permissions,
    });
    sendSuccess(res, result);
  })
);

/**
 * POST /api/v1/copilot/actions/:id/reject
 * Reject a pending consequential action preview.
 */
router.post(
  "/actions/:id/reject",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const permissions = req.user!.role.permissions || [];
    const result = await CopilotService.rejectAction(req.params.id!, {
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      userPermissions: permissions,
    });
    sendSuccess(res, result);
  })
);

/**
 * GET /api/v1/copilot/dashboard
 * Return live metrics and usage statistics for Copilot dashboard.
 */
router.get(
  "/dashboard",
  requirePermission("copilot.read"),
  asyncHandler(async (req, res) => {
    const stats = await CopilotService.getDashboardStats(req.user!.organizationId);
    sendSuccess(res, stats);
  })
);

export default router;
