/**
 * Publishing landing pages through the Approvals center (source `landing`). Same `automation_approvals` store and system workflow
 * as CMS content approvals, no new table. Submitting validates the publish checklist; approving (permission
 * `marketing.landing.publish`) re-validates and promotes the reviewed revision to LIVE; rejecting returns the draft to its author.
 */
import crypto from "node:crypto";
import { prisma } from "../../db/prisma";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { userRepository } from "../../repositories/userRepository";
import { notificationService } from "../notificationService";
import { landingPublishIssues } from "./landingContent";
import { assertMediaUsable, landingPath, pendingApprovalFor, readDocument, readSeo, landingPageService } from "./landingPageService";
import { syncLandingForm } from "./landingForm";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";

export const LANDING_ENTITY = "landing_page";
const WORKFLOW_CATEGORY = "CONTENT_APPROVAL";
const APPROVER_ROLE_KEYS = ["ADMIN", "SUPER_ADMIN"];
export type LandingDecision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
const can = (u: SanitizedUser, key: string) => u.role.key === "SUPER_ADMIN" || u.role.permissions.includes(key);

async function workflowFor(organizationId: string) {
  const existing = await prisma.automationWorkflow.findFirst({ where: { organizationId, category: WORKFLOW_CATEGORY } });
  if (existing) return existing;
  return prisma.automationWorkflow.create({
    data: { organizationId, name: "Content Approval", description: "System workflow anchoring CMS content approval requests.", category: WORKFLOW_CATEGORY, status: "ACTIVE", triggerType: "MANUAL", steps: [] },
  });
}

export const landingApprovalService = {
  /** Author asks for the working draft to go live (first publish, or an update to a live page). */
  async submit(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<{ approvalId: string }> {
    const organizationId = caller.organizationId;
    const page = await landingPageService.loadPage(organizationId, id);
    if (page.status === "ARCHIVED") throw new ConflictError("An archived landing page must be restored first.");
    if (await pendingApprovalFor(organizationId, id)) throw new ConflictError("This page already has a pending approval request.");
    const rev = page.currentRevision;
    if (!rev) throw new ConflictError("This page has no content to publish.");
    if (page.landingLiveRevisionId === rev.id) throw new ConflictError("There are no unpublished changes to send for approval.");
    const issues = landingPublishIssues({ title: rev.title, document: rev.editorBlocks ?? { version: 1, blocks: [] }, seo: readSeo(rev.metadata) });
    if (issues.length > 0) throw new ValidationError("This page cannot be sent for approval yet.", { issues });
    await assertMediaUsable(readDocument(rev), organizationId);

    const workflow = await workflowFor(organizationId);
    const execution = await prisma.automationExecution.create({
      data: { organizationId, workflowId: workflow.id, workflowVersion: workflow.currentVersion, status: "WAITING_APPROVAL", triggerType: "MANUAL", entityType: LANDING_ENTITY, entityId: id, correlationId: crypto.randomUUID(), initiatedById: caller.id },
    });
    const approval = await prisma.automationApproval.create({
      data: {
        organizationId, executionId: execution.id, workflowId: workflow.id, stepId: "landing-approval", action: "publish_landing_page", description: `Publish landing page "${rev.title}"`,
        entityType: LANDING_ENTITY, entityId: id, requesterId: caller.id, status: "PENDING", payload: { revisionId: rev.id, version: rev.version, slug: page.slug, update: !!page.landingLiveRevisionId },
      },
    });
    if (!page.landingLiveRevisionId) await prisma.page.update({ where: { id }, data: { status: "IN_REVIEW" } });
    await auditLogRepository.record({ organizationId, actorUserId: caller.id, actorType: "USER", action: "LANDING_PAGE_SUBMITTED_FOR_APPROVAL", resourceType: "landing_page", resourceId: id, afterData: { approvalId: approval.id, version: rev.version }, ipAddress: meta.ip, userAgent: meta.userAgent });
    const approvers = await userRepository.listActiveByRoleKeysInOrg(organizationId, APPROVER_ROLE_KEYS);
    await Promise.all(approvers.filter((u) => u.id !== caller.id).map((u) => notificationService.notify({ organizationId, userId: u.id, type: "approval_requested", title: "Landing page approval requested", message: `"${rev.title}" is waiting for your approval.`, entityType: "automation_approval", entityId: approval.id })));
    return { approvalId: approval.id };
  },

  /** The requester (or anyone who can edit) takes the request back so the page can be edited again. */
  async withdraw(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const page = await landingPageService.loadPage(organizationId, id);
    const pending = await pendingApprovalFor(organizationId, id);
    if (!pending) throw new ConflictError("There is no pending approval request for this page.");
    await prisma.automationApproval.update({ where: { id: pending.id }, data: { status: "CANCELLED", decidedAt: new Date(), decisionReason: "Withdrawn by the author" } });
    await prisma.automationExecution.updateMany({ where: { approvals: { some: { id: pending.id } } }, data: { status: "CANCELLED", completedAt: new Date() } }).catch(() => undefined);
    if (!page.landingLiveRevisionId && page.status === "IN_REVIEW") await prisma.page.update({ where: { id }, data: { status: "DRAFT" } });
    await auditLogRepository.record({ organizationId, actorUserId: caller.id, actorType: "USER", action: "LANDING_PAGE_APPROVAL_WITHDRAWN", resourceType: "landing_page", resourceId: id, afterData: { approvalId: pending.id }, ipAddress: meta.ip, userAgent: meta.userAgent });
  },

  /** Called by the Approvals center. Needs `marketing.landing.publish`. */
  async decide(caller: SanitizedUser, approvalId: string, decision: LandingDecision, reason?: string, meta: RequestMeta = {}): Promise<{ approvalId: string; decision: string }> {
    if (!can(caller, "marketing.landing.publish")) throw new AuthorizationError('Permission denied. Required privilege: "marketing.landing.publish"');
    const organizationId = caller.organizationId;
    const approval = await prisma.automationApproval.findFirst({ where: { id: approvalId, organizationId, entityType: LANDING_ENTITY } });
    if (!approval) throw new NotFoundError("Approval request not found.");
    if (approval.status !== "PENDING") throw new ValidationError(`This approval is already resolved with status ${approval.status}.`);
    const pageId = approval.entityId!;
    const page = await landingPageService.loadPage(organizationId, pageId);
    const rev = page.currentRevision;
    const reviewed = (approval.payload as { revisionId?: string } | null)?.revisionId;

    if (decision === "APPROVED") {
      if (!rev || rev.id !== reviewed) throw new ConflictError("The page changed after it was submitted. Ask the author to send the current version again.");
      const issues = landingPublishIssues({ title: rev.title, document: rev.editorBlocks ?? { version: 1, blocks: [] }, seo: readSeo(rev.metadata) });
      if (issues.length > 0) throw new ConflictError("The page can no longer be published.", { issues });
      const doc = readDocument(rev);
      await assertMediaUsable(doc, organizationId);
      const now = new Date();
      await prisma.$transaction([
        prisma.contentRevision.update({ where: { id: rev.id }, data: { status: "PUBLISHED", publishedAt: now } }),
        prisma.page.update({ where: { id: pageId }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null, landingLiveRevisionId: rev.id, landingUnpublishedAt: null, title: rev.title } }),
      ]);
      await syncLandingForm({ id: page.id, organizationId, title: rev.title, createdById: page.createdById }, doc, true);
    } else if (!page.landingLiveRevisionId) {
      await prisma.page.update({ where: { id: pageId }, data: { status: "DRAFT" } });
    }

    const updated = await prisma.automationApproval.update({ where: { id: approval.id }, data: { status: decision, approverId: caller.id, decisionReason: reason || null, decidedAt: new Date() } });
    await prisma.automationExecution.update({ where: { id: approval.executionId }, data: { status: decision === "APPROVED" ? "COMPLETED" : "CANCELLED", completedAt: new Date() } });
    await auditLogRepository.record({
      organizationId, actorUserId: caller.id, actorType: "USER", action: decision === "APPROVED" ? "LANDING_PAGE_PUBLISHED" : decision === "CHANGES_REQUESTED" ? "LANDING_PAGE_CHANGES_REQUESTED" : "LANDING_PAGE_APPROVAL_REJECTED",
      resourceType: "landing_page", resourceId: pageId, afterData: { approvalId: approval.id, reason: reason ?? null, path: landingPath(page.slug) }, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    if (approval.requesterId && approval.requesterId !== caller.id) {
      await notificationService.notify({
        organizationId, userId: approval.requesterId, type: decision === "APPROVED" ? "approval_completed" : "approval_rejected",
        title: decision === "APPROVED" ? "Landing page published" : decision === "CHANGES_REQUESTED" ? "Changes requested" : "Landing page rejected",
        message: reason ? `"${page.title}": ${reason}` : `"${page.title}" was ${decision.toLowerCase().replace("_", " ")}.`, entityType: LANDING_ENTITY, entityId: pageId,
      });
    }
    return { approvalId: updated.id, decision: updated.status };
  },
};
