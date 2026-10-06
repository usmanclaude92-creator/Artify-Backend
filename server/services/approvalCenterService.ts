/**
 * Global Approvals center — a READ-ONLY aggregation over the three existing approval stores
 * (AI approval requests, automation workflow approvals, CMS content approvals) plus a thin decision
 * dispatcher that delegates to each source's existing service, so every source-level rule (payload-hash
 * guard, role check, publish-on-approve, workflow resume…) still applies untouched. There is no new
 * approvals table. "social" posts (PENDING_APPROVAL) are the fourth source; decisions delegate to socialPostService.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { aiApprovalService } from "./aiApprovalService";
import { automationService } from "./automation/AutomationService";
import { contentApprovalService } from "./automation/ContentApprovalService";
import { socialPostService } from "./social/socialPostService";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { AuthorizationError, NotFoundError, ValidationError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { ApprovalSource, ListApprovalsQuery, ApprovalDecisionInput } from "../schemas/approvalCenterSchemas";
import type { RequestMeta } from "./authService";

export type NormalizedStatus = "pending" | "approved" | "rejected" | "expired";

export interface NormalizedApproval {
  id: string;
  source: ApprovalSource;
  title: string;
  summary: string;
  requestedBy: { id: string; name: string } | null;
  requestedAt: Date;
  status: NormalizedStatus;
  dueAt: Date | null;
  /** In-app deep link to the source item. */
  link: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  /** True when the caller holds the source's decide permission (and, for automation, the role rule). */
  canDecide: boolean;
}

const SOURCE_READ_PERMISSION: Record<ApprovalSource, string> = {
  ai: "ai.approvals.read",
  automation: "automation.read",
  content: "content.update",
  social: "social.read",
};
const SOURCE_DECIDE_PERMISSION: Record<ApprovalSource, string> = {
  ai: "ai.approvals.decide",
  automation: "automation.approve",
  content: "content.publish",
  social: "social.approve",
};
const CONTENT_ENTITY_TYPES = ["page", "post"];

const has = (caller: SanitizedUser, key: string) => caller.role.permissions.includes(key);
const isUniversalApprover = (caller: SanitizedUser) => caller.role.key === "ADMIN" || caller.role.key === "SUPER_ADMIN";
const fullName = (u: { firstName: string; lastName: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}`.trim() : "");

/** The sources a caller may see at all: approvals.read AND the source-level read permission. */
export function visibleSources(caller: SanitizedUser): Array<ApprovalSource> {
  if (!has(caller, "approvals.read")) return [];
  return (Object.keys(SOURCE_READ_PERMISSION) as Array<ApprovalSource>).filter((s) => has(caller, SOURCE_READ_PERMISSION[s]));
}

function canDecideSource(caller: SanitizedUser, source: ApprovalSource): boolean {
  return has(caller, SOURCE_DECIDE_PERMISSION[source]);
}

// ---- per-source "where" builders -------------------------------------------------------------

function dateRange(q: ListApprovalsQuery, field: string): Record<string, unknown> {
  if (!q.from && !q.to) return {};
  return { [field]: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } };
}

function aiWhere(caller: SanitizedUser, q: ListApprovalsQuery): Prisma.AIApprovalRequestWhereInput {
  const status = q.status === "pending" ? { status: "PENDING" as const, expiresAt: { gt: new Date() } } : q.status === "approved" ? { status: "APPROVED" as const } : { status: { in: ["REJECTED", "EXPIRED"] as Array<"REJECTED" | "EXPIRED"> } };
  return {
    organizationId: caller.organizationId,
    ...status,
    ...(q.assignee === "me" && q.status !== "pending" ? { OR: [{ requestedById: caller.id }, { approvedById: caller.id }] } : {}),
    ...(q.search ? { OR: [{ action: { contains: q.search, mode: "insensitive" } }, { resourceType: { contains: q.search, mode: "insensitive" } }] } : {}),
    ...dateRange(q, "createdAt"),
  };
}

function automationBaseWhere(caller: SanitizedUser, q: ListApprovalsQuery, content: boolean): Prisma.AutomationApprovalWhereInput {
  const status =
    q.status === "pending"
      ? { status: "PENDING" as const }
      : q.status === "approved"
        ? { status: "APPROVED" as const }
        : { status: { in: ["REJECTED", "CHANGES_REQUESTED", "EXPIRED", "CANCELLED"] as Array<"REJECTED" | "CHANGES_REQUESTED" | "EXPIRED" | "CANCELLED"> } };
  const and: Prisma.AutomationApprovalWhereInput[] = [];
  if (q.assignee === "me") {
    if (q.status === "pending") {
      if (!content && !isUniversalApprover(caller)) and.push({ requiredRole: caller.role.key });
    } else {
      and.push({ OR: [{ requesterId: caller.id }, { approverId: caller.id }] });
    }
  }
  if (q.search) and.push({ OR: [{ description: { contains: q.search, mode: "insensitive" } }, { action: { contains: q.search, mode: "insensitive" } }] });
  return {
    organizationId: caller.organizationId,
    ...status,
    ...(content ? { entityType: { in: CONTENT_ENTITY_TYPES } } : { OR: [{ entityType: null }, { entityType: { notIn: CONTENT_ENTITY_TYPES } }] }),
    ...(and.length ? { AND: and } : {}),
    ...dateRange(q, "requestedAt"),
  };
}

// ---- row normalisers -------------------------------------------------------------------------

function normStatus(raw: string): NormalizedStatus {
  if (raw === "PENDING") return "pending";
  if (raw === "APPROVED") return "approved";
  if (raw === "EXPIRED" || raw === "CANCELLED") return "expired";
  return "rejected"; // REJECTED, CHANGES_REQUESTED
}

async function usersById(ids: string[]): Promise<Map<string, { id: string; firstName: string; lastName: string }>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(rows.map((u) => [u.id, u]));
}

const person = (u: { id: string; firstName: string; lastName: string } | null | undefined) => (u ? { id: u.id, name: fullName(u) } : null);

function contentTitle(description: string | null, entityId: string | null): string {
  const m = description?.match(/"(.+)"/);
  return m?.[1] ?? description ?? entityId ?? "Content";
}

async function fetchAi(caller: SanitizedUser, q: ListApprovalsQuery, take: number) {
  const where = aiWhere(caller, q);
  const [rows, total] = await Promise.all([
    prisma.aIApprovalRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: { requestedBy: { select: { id: true, firstName: true, lastName: true } }, approvedBy: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.aIApprovalRequest.count({ where }),
  ]);
  const canDecide = canDecideSource(caller, "ai");
  const items: NormalizedApproval[] = rows.map((r) => ({
    id: r.id,
    source: "ai",
    title: r.action,
    summary: [r.resourceType, r.resourceId].filter(Boolean).join(" ") || "AI tool action awaiting human approval",
    requestedBy: person(r.requestedBy),
    requestedAt: r.createdAt,
    status: r.status === "PENDING" && r.expiresAt.getTime() < Date.now() ? "expired" : normStatus(r.status),
    dueAt: r.expiresAt,
    link: "/ai/approvals",
    decidedBy: person(r.approvedBy),
    decidedAt: r.approvedAt,
    decisionComment: r.rejectionReason,
    canDecide: canDecide && r.status === "PENDING" && r.expiresAt.getTime() >= Date.now(),
  }));
  return { items, total };
}

async function fetchAutomation(caller: SanitizedUser, q: ListApprovalsQuery, take: number, content: boolean) {
  const where = automationBaseWhere(caller, q, content);
  const source: "automation" | "content" = content ? "content" : "automation";
  const [rows, total] = await Promise.all([
    prisma.automationApproval.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      take,
      include: { workflow: { select: { name: true } } },
    }),
    prisma.automationApproval.count({ where }),
  ]);
  const users = await usersById(rows.flatMap((r) => [r.requesterId ?? "", r.approverId ?? ""]));
  const decidePerm = canDecideSource(caller, source);
  const items: NormalizedApproval[] = rows.map((r) => {
    const roleOk = content || isUniversalApprover(caller) || !r.requiredRole || r.requiredRole === caller.role.key;
    const title = content ? contentTitle(r.description, r.entityId) : (r.description ?? r.action);
    return {
      id: r.id,
      source,
      title,
      summary: content ? `${r.entityType === "post" ? "Blog post" : "Page"} awaiting publish approval` : `Workflow "${r.workflow.name}" · ${r.action}${r.requiredRole ? ` · needs ${r.requiredRole}` : ""}`,
      requestedBy: person(r.requesterId ? users.get(r.requesterId) : null),
      requestedAt: r.requestedAt,
      status: normStatus(r.status),
      dueAt: r.expiresAt,
      link: content ? (r.entityType === "post" ? `/cms/posts?q=${encodeURIComponent(title)}` : `/cms/pages?q=${encodeURIComponent(title)}`) : "/automation",
      decidedBy: person(r.approverId ? users.get(r.approverId) : null),
      decidedAt: r.decidedAt,
      decisionComment: r.decisionReason,
      canDecide: decidePerm && roleOk && r.status === "PENDING",
    };
  });
  return { items, total };
}

async function fetchSocial(caller: SanitizedUser, q: ListApprovalsQuery, take: number) {
  const status = q.status === "pending" ? { status: "PENDING_APPROVAL" as const } : q.status === "approved" ? { status: { in: ["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED"] as Array<"APPROVED" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED"> } } : { status: "REJECTED" as const };
  const where: Prisma.SocialPostWhereInput = {
    organizationId: caller.organizationId,
    deletedAt: null,
    ...status,
    ...(q.assignee === "me" && q.status !== "pending" ? { OR: [{ createdById: caller.id }, { decidedById: caller.id }] } : {}),
    ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" } }, { body: { contains: q.search, mode: "insensitive" } }] } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.socialPost.findMany({ where, orderBy: { updatedAt: "desc" }, take, include: { createdBy: { select: { id: true, firstName: true, lastName: true } }, targets: { include: { account: { select: { displayName: true, provider: true } } } } } }),
    prisma.socialPost.count({ where }),
  ]);
  const decidedBy = await usersById(rows.map((r) => r.decidedById ?? ""));
  const canDecide = canDecideSource(caller, "social");
  const items: NormalizedApproval[] = rows.map((r) => ({
    id: r.id,
    source: "social",
    title: r.title,
    summary: `${r.targets.map((t) => t.account.displayName).join(", ") || "No accounts"} · ${r.body.slice(0, 120)}${r.body.length > 120 ? "…" : ""}`,
    requestedBy: person(r.createdBy),
    requestedAt: r.updatedAt,
    status: r.status === "PENDING_APPROVAL" ? "pending" : r.status === "REJECTED" ? "rejected" : "approved",
    dueAt: r.scheduledAt,
    link: `/social/compose?post=${r.id}`,
    decidedBy: person(r.decidedById ? decidedBy.get(r.decidedById) : null),
    decidedAt: r.decidedAt,
    decisionComment: r.rejectionReason,
    canDecide: canDecide && r.status === "PENDING_APPROVAL",
  }));
  return { items, total };
}

export const approvalCenterService = {
  async list(caller: SanitizedUser, q: ListApprovalsQuery) {
    const allowed = visibleSources(caller);
    const wanted = (q.source ? [q.source] : ["ai", "automation", "content", "social"]).filter((s): s is "ai" | "automation" | "content" | "social" => allowed.includes(s as never));
    const take = Math.min(q.page * q.limit, 500);

    const parts = await Promise.all(
      wanted.map((s) => (s === "ai" ? fetchAi(caller, q, take) : s === "social" ? fetchSocial(caller, q, take) : fetchAutomation(caller, q, take, s === "content")))
    );
    const merged = parts.flatMap((p) => p.items).sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    const total = parts.reduce((n, p) => n + p.total, 0);
    const start = (q.page - 1) * q.limit;
    return { approvals: merged.slice(start, start + q.limit), total, page: q.page, limit: q.limit, sources: allowed };
  },

  /** Pending counts per source for the caller — role-matched for automation, exactly what they could act on. */
  async summary(caller: SanitizedUser): Promise<{ total: number; counts: Record<ApprovalSource, number>; sources: string[] }> {
    const allowed = visibleSources(caller);
    const counts: Record<ApprovalSource, number> = { ai: 0, automation: 0, content: 0, social: 0 };
    const orgId = caller.organizationId;
    await Promise.all([
      allowed.includes("ai") ? prisma.aIApprovalRequest.count({ where: { organizationId: orgId, status: "PENDING", expiresAt: { gt: new Date() } } }).then((n) => (counts.ai = n)) : null,
      allowed.includes("automation")
        ? prisma.automationApproval
            .count({ where: automationBaseWhere(caller, { status: "pending", assignee: "me", page: 1, limit: 1 }, false) })
            .then((n) => (counts.automation = n))
        : null,
      allowed.includes("content")
        ? prisma.automationApproval
            .count({ where: automationBaseWhere(caller, { status: "pending", assignee: "me", page: 1, limit: 1 }, true) })
            .then((n) => (counts.content = n))
        : null,
      allowed.includes("social") ? prisma.socialPost.count({ where: { organizationId: orgId, deletedAt: null, status: "PENDING_APPROVAL" } }).then((n) => (counts.social = n)) : null,
    ]);
    return { total: counts.ai + counts.automation + counts.content + counts.social, counts, sources: allowed };
  },

  async decide(caller: SanitizedUser, source: ApprovalSource, id: string, input: ApprovalDecisionInput, meta: RequestMeta = {}) {
    const allowed = visibleSources(caller);
    if (!allowed.includes(source)) throw new AuthorizationError("You do not have access to this approval source.");
    if (!canDecideSource(caller, source)) throw new AuthorizationError(`Missing permission: ${SOURCE_DECIDE_PERMISSION[source]}`);

    const approve = input.decision === "approve";
    let result: unknown;
    if (source === "social") {
      result = await socialPostService.decide(caller, id, approve, input.comment, meta);
    } else if (source === "ai") {
      result = await aiApprovalService.decide(caller, id, { decision: approve ? "APPROVE" : "REJECT", rejectionReason: input.comment }, meta);
    } else {
      const row = await prisma.automationApproval.findFirst({ where: { id, organizationId: caller.organizationId }, select: { entityType: true } });
      if (!row) throw new NotFoundError("Approval request not found.");
      const isContent = !!row.entityType && CONTENT_ENTITY_TYPES.includes(row.entityType);
      if (isContent !== (source === "content")) throw new ValidationError(`This approval belongs to the "${isContent ? "content" : "automation"}" source.`);
      result =
        source === "content"
          ? await contentApprovalService.decide(caller, id, approve ? "APPROVED" : "REJECTED", input.comment)
          : await automationService.decideApproval({
              approvalId: id,
              organizationId: caller.organizationId,
              userId: caller.id,
              userRole: caller.role.key,
              decision: approve ? "APPROVED" : "REJECTED",
              reason: input.comment,
            });
    }

    // The source service already audits its own decision; this entry records that it was made through the center.
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "APPROVAL_CENTER_DECISION",
      resourceType: `${source}_approval`,
      resourceId: id,
      metadata: { source, decision: input.decision, comment: input.comment ?? null },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { source, id, decision: input.decision, result };
  },
};
