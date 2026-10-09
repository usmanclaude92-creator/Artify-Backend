/** Two-person approval for erasure (Approvals center source `privacy`). The approver must hold privacy.erase AND be a different person than the requester. */
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { notificationService } from "../notificationService";
import { privacyService } from "./privacyService";
import { META_DELETION_KIND, metaCallbackService } from "../meta/metaCallbackService";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";

export const PRIVACY_ENTITY = "privacy_erasure";
const can = (u: SanitizedUser, k: string) => u.role.key === "SUPER_ADMIN" || u.role.permissions.includes(k);

export const privacyApprovalService = {
  async decide(caller: SanitizedUser, approvalId: string, decision: "APPROVED" | "REJECTED", reason: string | undefined, meta: RequestMeta = {}) {
    if (!can(caller, "privacy.erase")) throw new AuthorizationError('Permission denied. Required privilege: "privacy.erase"');
    const orgId = caller.organizationId;
    const approval = await prisma.automationApproval.findFirst({ where: { id: approvalId, organizationId: orgId, entityType: PRIVACY_ENTITY } });
    if (!approval) throw new NotFoundError("Approval request not found.");
    if (approval.status !== "PENDING") throw new ValidationError(`This approval is already resolved with status ${approval.status}.`);
    if (approval.requesterId === caller.id) throw new AuthorizationError("Two-person rule: the person who requested an erasure cannot approve it.");
    const req = await prisma.privacyRequest.findFirst({ where: { id: approval.entityId!, organizationId: orgId } });
    if (!req || req.status !== "PENDING_APPROVAL") throw new ConflictError("This request is no longer pending.");
    if (decision === "REJECTED" && !(reason && reason.trim())) throw new ValidationError("A reason is required to reject.");

    let result: Record<string, number> | null = null;
    if (decision === "APPROVED") result = req.kind === META_DELETION_KIND ? await metaCallbackService.execute(orgId, req.id) : await privacyService.execute(orgId, req.id);
    const now = new Date();
    await prisma.privacyRequest.update({ where: { id: req.id }, data: { status: decision === "APPROVED" ? "EXECUTED" : "REJECTED", approvedById: caller.id, decidedAt: now, executedAt: decision === "APPROVED" ? now : null, resultCounts: result ?? undefined, targetIds: Prisma.DbNull } });
    await prisma.automationApproval.update({ where: { id: approval.id }, data: { status: decision, approverId: caller.id, decisionReason: reason?.slice(0, 500) || null, decidedAt: now } });
    await prisma.automationExecution.update({ where: { id: approval.executionId }, data: { status: decision === "APPROVED" ? "COMPLETED" : "CANCELLED", completedAt: now } });
    await auditLogRepository.record({
      organizationId: orgId, actorUserId: caller.id, actorType: "USER", action: decision === "APPROVED" ? "PRIVACY_ERASURE_EXECUTED" : "PRIVACY_ERASURE_REJECTED",
      resourceType: "privacy_request", resourceId: req.id, afterData: { kind: req.kind, subjectRef: req.subjectRef, requestedBy: req.requestedById, approvedBy: caller.id, ...(result ? { counts: result } : {}) }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    await notificationService.notify({ organizationId: orgId, userId: req.requestedById, type: decision === "APPROVED" ? "approval_completed" : "approval_rejected", title: decision === "APPROVED" ? "Erasure executed" : "Erasure rejected", message: `Request ${req.id.slice(0, 8)} was ${decision.toLowerCase()}.`, entityType: "privacy_request", entityId: req.id });
    return { approvalId: approval.id, decision, counts: result };
  },
};
