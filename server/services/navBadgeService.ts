/** Sidebar badge counts — one cheap COUNT per figure, cached ~30s per (user, org); never includes a count the caller lacks permission for. */
import { prisma } from "../db/prisma";
import { notificationRepository } from "../repositories/notificationRepository";
import { approvalCenterService } from "./approvalCenterService";
import type { SanitizedUser } from "../types/domain";

export interface NavBadges {
  approvals?: number;
  notifications: number;
  myWork?: number;
  /** Social posts awaiting approval — only for users who can approve them. */
  socialApprovals?: number;
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: NavBadges }>();

export function clearNavBadgeCache(): void {
  cache.clear();
}

export const navBadgeService = {
  async get(caller: SanitizedUser): Promise<NavBadges> {
    const key = `${caller.id}:${caller.organizationId}:${caller.role.key}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

    const perms = caller.role.permissions;
    const universal = caller.role.key === "ADMIN" || caller.role.key === "SUPER_ADMIN";
    const [notifications, approvals, myWork, socialApprovals] = await Promise.all([
      notificationRepository.unreadCount(caller.id, caller.organizationId),
      perms.includes("approvals.read") ? approvalCenterService.summary(caller).then((s) => s.total) : Promise.resolve(undefined),
      perms.includes("automation.read")
        ? Promise.all([
            prisma.automationTask.count({ where: { organizationId: caller.organizationId, assignedUserId: caller.id, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
            // Same eligibility rule as the My Work page (role-matched unless ADMIN/SUPER_ADMIN).
            prisma.automationApproval.count({ where: { organizationId: caller.organizationId, status: "PENDING", ...(universal ? {} : { requiredRole: caller.role.key }) } }),
          ]).then(([tasks, pending]) => tasks + pending)
        : Promise.resolve(undefined),
      perms.includes("social.approve") ? prisma.socialPost.count({ where: { organizationId: caller.organizationId, deletedAt: null, status: "PENDING_APPROVAL" } }) : Promise.resolve(undefined),
    ]);

    const value: NavBadges = { notifications, ...(approvals !== undefined ? { approvals } : {}), ...(myWork !== undefined ? { myWork } : {}), ...(socialApprovals !== undefined ? { socialApprovals } : {}) };
    cache.set(key, { at: Date.now(), value });
    return value;
  },
};
