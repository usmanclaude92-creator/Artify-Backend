/** CRM dashboard summary (§21) — real counts only, each section gated by the caller's own permission (same degrade-gracefully pattern as the Phase 4 Control Center dashboard). */
import { Router } from "express";
import { leadService } from "../../services/leadService";
import { clientService } from "../../services/clientService";
import { opportunityService } from "../../services/opportunityService";
import { auditLogQueryRepository } from "../../repositories/auditLogQueryRepository";
import { authenticateToken } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";

const router = Router();

router.use(authenticateToken);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const permissions = req.user!.role.permissions;
    const organizationId = req.user!.organizationId;

    const [leadCounts, leadRecent, clientCounts, clientRecent, opportunityStats] = await Promise.all([
      permissions.includes("leads.read") ? leadService.dashboardCounts(organizationId) : Promise.resolve(null),
      permissions.includes("leads.read") ? leadService.recent(organizationId, 5) : Promise.resolve([]),
      permissions.includes("clients.read") ? clientService.dashboardCounts(organizationId) : Promise.resolve(null),
      permissions.includes("clients.read") ? clientService.recent(organizationId, 5) : Promise.resolve([]),
      permissions.includes("opportunities.read") ? opportunityService.dashboardStats(organizationId) : Promise.resolve(null),
    ]);

    // Unified activity feed (§21) — only the resource types the caller can
    // read are included, same degrade-gracefully pattern as the counts
    // above; a caller with none of these permissions gets null, not an
    // empty array (distinguishing "no access" from "no activity yet").
    const activityResourceTypes: string[] = [];
    if (permissions.includes("leads.read")) activityResourceTypes.push("lead");
    if (permissions.includes("opportunities.read")) activityResourceTypes.push("opportunity");
    if (permissions.includes("clients.read")) activityResourceTypes.push("client");
    if (permissions.includes("forms.read")) activityResourceTypes.push("form_submission");
    const recentActivity = activityResourceTypes.length
      ? (await auditLogQueryRepository.list({ organizationId, resourceTypes: activityResourceTypes }, 1, 20)).rows
      : null;

    const OPEN_STAGES = ["PROSPECTING", "QUALIFICATION", "PROPOSAL", "NEGOTIATION"] as const;
    const byStage = opportunityStats?.byStage ?? {};
    const openValue = OPEN_STAGES.reduce((sum, stage) => sum + Number(byStage[stage]?.value ?? 0), 0);
    const openCount = OPEN_STAGES.reduce((sum, stage) => sum + (byStage[stage]?.count ?? 0), 0);

    sendSuccess(res, {
      leads: leadCounts && {
        total: Object.values(leadCounts).reduce((a, b) => a + b, 0),
        new: leadCounts.NEW ?? 0,
        contacted: leadCounts.CONTACTED ?? 0,
        qualified: leadCounts.QUALIFIED ?? 0,
        converted: leadCounts.CONVERTED ?? 0,
        lost: leadCounts.LOST ?? 0,
        recent: leadRecent,
      },
      clients: clientCounts && {
        total: Object.values(clientCounts).reduce((a, b) => a + b, 0),
        prospect: clientCounts.PROSPECT ?? 0,
        active: clientCounts.ACTIVE ?? 0,
        inactive: clientCounts.INACTIVE ?? 0,
        suspended: clientCounts.SUSPENDED ?? 0,
        archived: clientCounts.ARCHIVED ?? 0,
        recent: clientRecent,
      },
      opportunities: opportunityStats && {
        openCount,
        openValue: openValue.toString(),
        byStage,
        recent: opportunityStats.recent,
      },
      recentActivity,
    });
  })
);

export default router;
