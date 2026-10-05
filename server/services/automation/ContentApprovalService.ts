/**
 * Phase 16 — Content Approval (docs/AUTOMATION_ARCHITECTURE.md §2). Submit
 * for approval / approve / reject / request changes for CMS Page/Post
 * content, reusing the existing `automation_approvals` table — the same
 * table every workflow-step APPROVAL uses, never a parallel approval
 * system — and `pageService.publishPage`/`postService.publishPost`
 * verbatim on approve (never a duplicate publish code path; existing
 * revision/version handling is untouched). Rejecting/requesting changes
 * sends the content back to DRAFT so the author can revise and resubmit
 * through the existing `submitForReview` -> `submitForApproval` path —
 * "resubmit" is just that same path again, not a separate feature.
 *
 * Every row in `automation_approvals` requires a real AutomationExecution
 * (its `executionId`/`workflowId` FKs are mandatory, by the existing
 * schema's own design, for every other approval in this table). Rather
 * than run the full step-execution engine for something that is not
 * really a multi-step workflow, this creates one lightweight execution
 * row directly, anchored to a per-organization "Content Approval" system
 * workflow created lazily on first use (never pre-seeded, never
 * duplicated — `getOrCreateWorkflow` finds-or-creates exactly one row per org).
 */
import crypto from "node:crypto";
import type { AutomationApprovalStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { pageService } from "../pageService";
import { postService } from "../postService";
import { notificationService } from "../notificationService";
import { userRepository } from "../../repositories/userRepository";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { eventEngine } from "./EventEngine";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import type { SanitizedUser } from "../../types/domain";

const SYSTEM_WORKFLOW_NAME = "Content Approval";
const SYSTEM_WORKFLOW_CATEGORY = "CONTENT_APPROVAL";
/** Mirrors ApprovalEngine.decideApproval's own universal-approver rule: ADMIN/SUPER_ADMIN may decide any approval regardless of a specific requiredRole. */
const APPROVER_ROLE_KEYS = ["ADMIN", "SUPER_ADMIN"];

export type ContentType = "page" | "post";
export type ContentApprovalDecision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

interface ContentRow {
  title: string;
  slug: string;
  status: string;
}

async function getOrCreateWorkflow(organizationId: string) {
  const existing = await prisma.automationWorkflow.findFirst({ where: { organizationId, category: SYSTEM_WORKFLOW_CATEGORY } });
  if (existing) return existing;
  return prisma.automationWorkflow.create({
    data: {
      organizationId,
      name: SYSTEM_WORKFLOW_NAME,
      description: "System workflow anchoring CMS content approval requests.",
      category: SYSTEM_WORKFLOW_CATEGORY,
      status: "ACTIVE",
      triggerType: "MANUAL",
      steps: [],
    },
  });
}

async function loadContentOrThrow(contentType: ContentType, id: string, organizationId: string): Promise<ContentRow> {
  if (contentType === "page") {
    const page = await prisma.page.findFirst({ where: { id, organizationId }, select: { title: true, slug: true, status: true } });
    if (!page) throw new NotFoundError("Page not found.");
    return page;
  }
  const post = await prisma.post.findFirst({ where: { id, organizationId }, select: { title: true, slug: true, status: true } });
  if (!post) throw new NotFoundError("Post not found.");
  return post;
}

export const contentApprovalService = {
  async submitForApproval(caller: SanitizedUser, contentType: ContentType, contentId: string): Promise<{ approvalId: string }> {
    const organizationId = caller.organizationId;
    const content = await loadContentOrThrow(contentType, contentId, organizationId);
    if (content.status !== "IN_REVIEW") {
      throw new ConflictError(`Only content already submitted for review (status IN_REVIEW) can be sent for approval (current status: ${content.status}).`);
    }

    const existingPending = await prisma.automationApproval.findFirst({
      where: { organizationId, entityType: contentType, entityId: contentId, status: "PENDING" },
    });
    if (existingPending) {
      throw new ConflictError("This content already has a pending approval request.", { approvalId: existingPending.id });
    }

    const workflow = await getOrCreateWorkflow(organizationId);
    const execution = await prisma.automationExecution.create({
      data: {
        organizationId,
        workflowId: workflow.id,
        workflowVersion: workflow.currentVersion,
        status: "WAITING_APPROVAL",
        triggerType: "MANUAL",
        entityType: contentType,
        entityId: contentId,
        correlationId: crypto.randomUUID(),
        initiatedById: caller.id,
      },
    });

    const approval = await prisma.automationApproval.create({
      data: {
        organizationId,
        executionId: execution.id,
        workflowId: workflow.id,
        stepId: "content-approval",
        action: `publish_${contentType}`,
        description: `Publish "${content.title}"`,
        entityType: contentType,
        entityId: contentId,
        requesterId: caller.id,
        status: "PENDING",
      },
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTENT_APPROVAL_REQUESTED",
      resourceType: contentType,
      resourceId: contentId,
      afterData: { approvalId: approval.id },
    });

    const approvers = await userRepository.listActiveByRoleKeysInOrg(organizationId, APPROVER_ROLE_KEYS);
    await Promise.all(
      approvers
        .filter((u) => u.id !== caller.id)
        .map((u) =>
          notificationService.notify({
            organizationId,
            userId: u.id,
            type: "approval_requested",
            title: "Content approval requested",
            message: `"${content.title}" is waiting for your approval.`,
            entityType: "automation_approval",
            entityId: approval.id,
          })
        )
    );

    return { approvalId: approval.id };
  },

  async decide(caller: SanitizedUser, approvalId: string, decision: ContentApprovalDecision, reason?: string): Promise<{ approvalId: string; decision: string }> {
    const organizationId = caller.organizationId;
    const approval = await prisma.automationApproval.findFirst({ where: { id: approvalId, organizationId } });
    if (!approval) throw new NotFoundError("Approval request not found.");
    if (approval.status !== "PENDING") throw new ValidationError(`This approval is already resolved with status ${approval.status}.`);
    if (approval.entityType !== "page" && approval.entityType !== "post") {
      throw new ValidationError("This approval is not a content approval.");
    }
    const contentType: ContentType = approval.entityType;
    const entityId = approval.entityId!;
    const content = await loadContentOrThrow(contentType, entityId, organizationId);

    const updated = await prisma.automationApproval.update({
      where: { id: approval.id },
      data: { status: decision, approverId: caller.id, decisionReason: reason || null, decidedAt: new Date() },
    });

    let executionStatus: "COMPLETED" | "CANCELLED" = "CANCELLED";
    if (decision === "APPROVED") {
      if (contentType === "page") await pageService.publishPage(caller, entityId);
      else await postService.publishPost(caller, entityId);
      executionStatus = "COMPLETED";
    } else {
      // REJECTED or CHANGES_REQUESTED — back to DRAFT; the author revises and resubmits via submitForReview -> submitForApproval again.
      if (contentType === "page") await prisma.page.update({ where: { id: entityId }, data: { status: "DRAFT" } });
      else await prisma.post.update({ where: { id: entityId }, data: { status: "DRAFT" } });
    }

    await prisma.automationExecution.update({ where: { id: approval.executionId }, data: { status: executionStatus, completedAt: new Date() } });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: decision === "APPROVED" ? "CONTENT_APPROVAL_GRANTED" : decision === "CHANGES_REQUESTED" ? "CONTENT_APPROVAL_CHANGES_REQUESTED" : "CONTENT_APPROVAL_REJECTED",
      resourceType: contentType,
      resourceId: entityId,
      metadata: { approvalId: approval.id, reason: reason ?? null },
    });

    if (approval.requesterId && approval.requesterId !== caller.id) {
      await notificationService.notify({
        organizationId,
        userId: approval.requesterId,
        type: decision === "APPROVED" ? "approval_completed" : "approval_rejected",
        title: decision === "APPROVED" ? "Content approved" : decision === "CHANGES_REQUESTED" ? "Changes requested" : "Content rejected",
        message: reason ? `"${content.title}": ${reason}` : `"${content.title}" was ${decision.toLowerCase().replace("_", " ")}.`,
        entityType: contentType,
        entityId,
      });
    }

    try {
      await eventEngine.emit({
        eventType: decision === "APPROVED" ? "content.approved" : "content.rejected",
        entityType: contentType,
        entityId,
        organizationId,
        actorId: caller.id,
        actorType: "USER",
        sourceModule: "CMS",
        payload: { approvalId: approval.id, decision, reason: reason ?? null },
      });
    } catch {
      // best-effort — see pageService.submitForReview's equivalent comment.
    }

    return { approvalId: updated.id, decision: updated.status };
  },

  async listForOrg(organizationId: string, status: string | undefined, page: number, limit: number) {
    const where: { organizationId: string; entityType: { in: ContentType[] }; status?: AutomationApprovalStatus } = {
      organizationId,
      entityType: { in: ["page", "post"] },
    };
    if (status) where.status = status as AutomationApprovalStatus;
    const [rows, total] = await Promise.all([
      prisma.automationApproval.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { approver: { select: { id: true, firstName: true, lastName: true, email: true } } },
      }),
      prisma.automationApproval.count({ where }),
    ]);
    return { rows, total, page, limit };
  },
};
