/** AI approval decisions (Phase 12 — docs/AI_GOVERNANCE.md §17). Approving a request is the ONLY code path that executes a HIGH-risk tool's handler — see server/ai/governance.ts's module doc comment for the financial-bypass-prevention guarantee this enforces. */
import crypto from "crypto";
import { aiApprovalRepository, type AiApprovalFilters } from "../repositories/aiApprovalRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { userRepository } from "../repositories/userRepository";
import { runToolHandler } from "../ai/governance";
import { AI_TOOL_REGISTRY, isRegisteredToolCode } from "../ai/toolRegistry";
import { ConflictError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { DecideAiApprovalInput } from "../schemas/aiSchemas";
import { resolveSanitizedUserForOrganization, type RequestMeta } from "./authService";
import { prisma } from "../db/prisma";

function payloadHash(input: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(input ?? {})).digest("hex");
}

export const aiApprovalService = {
  async listApprovals(organizationId: string, filters: AiApprovalFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return aiApprovalRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getApproval(organizationId: string, id: string) {
    const approval = await aiApprovalRepository.findByIdInOrg(id, organizationId);
    if (!approval) throw new NotFoundError("AI approval request not found.");
    return approval;
  },

  async decide(caller: SanitizedUser, id: string, input: DecideAiApprovalInput, meta: RequestMeta = {}) {
    const approval = await this.getApproval(caller.organizationId, id);

    if (approval.status !== "PENDING") {
      throw new ConflictError(`This approval request has already been ${approval.status.toLowerCase()}.`);
    }
    if (approval.expiresAt.getTime() < Date.now()) {
      await aiApprovalRepository.reject(id, caller.id, "Expired before a decision was made.");
      throw new ConflictError("This approval request has expired.");
    }
    if (payloadHash(approval.payload) !== approval.payloadHash) {
      // Tamper/replay guard (schema.prisma doc comment) — should be unreachable since payload is never
      // updated after creation, but a mismatch here means this request must never be auto-trusted.
      throw new ConflictError("This approval request's payload no longer matches what was requested; it cannot be approved.");
    }

    if (input.decision === "REJECT") {
      const rejected = await aiApprovalRepository.reject(id, caller.id, input.rejectionReason);

      if (approval.toolExecutionId) {
        await prisma.aIToolExecution.update({ where: { id: approval.toolExecutionId }, data: { status: "CANCELLED" } });
      }

      await auditLogRepository.record({
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "AI_APPROVAL_REJECTED",
        resourceType: "ai_approval_request",
        resourceId: id,
        afterData: { rejectionReason: input.rejectionReason },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });

      return rejected;
    }

    if (!approval.toolExecutionId) {
      throw new ValidationError("This approval request has no associated tool execution to run.");
    }
    if (!isRegisteredToolCode(approval.action)) {
      throw new ValidationError(`AI tool "${approval.action}" is no longer registered.`);
    }
    const definition = AI_TOOL_REGISTRY[approval.action]!;
    const parsed = definition.inputSchema.safeParse(approval.payload);
    if (!parsed.success) {
      throw new ValidationError(`Approved payload no longer matches "${approval.action}"'s current input schema.`);
    }

    const approved = await aiApprovalRepository.approve(id, caller.id);

    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_APPROVAL_APPROVED",
      resourceType: "ai_approval_request",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    // Execute now, as the human who requested it originally (not the approver) —
    // the approver authorizes the action, they do not become its actor.
    const requestingUser = await userRepository.findById(approval.requestedById);
    if (!requestingUser) {
      throw new NotFoundError("The user who originally requested this action no longer exists.");
    }
    const requesterCaller = await resolveSanitizedUserForOrganization(requestingUser, approval.organizationId);
    if (!requesterCaller) {
      throw new ConflictError("The user who originally requested this action no longer has access to this organization.");
    }

    await runToolHandler(definition, requesterCaller, parsed.data, meta, approval.toolExecutionId);

    return approved;
  },
};
