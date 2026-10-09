/** Dashboard, marketing funnel, saved views, CSV export and scheduled reports (Step 14, docs/DASHBOARD.md). */
import { Router } from "express";
import { z } from "zod";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { AuthorizationError, NotFoundError, ValidationError } from "../../core/errors";
import { prisma } from "../../db/prisma";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { sendCsv, toCsv } from "../../utils/csv";
import { canRead, dashboardService, DASHBOARD_PERIODS, WIDGET_KEYS, WIDGET_PERMISSION, type WidgetKey } from "../../services/dashboard/dashboardService";
import { nextRunAfter, reportService, REPORT_SECTIONS } from "../../services/dashboard/reportService";
import type { Request } from "express";

const router = Router();
router.use(authenticateToken);
/** Internal users only: the client portal has its own dashboard. */
router.use((req, _res, next) => { if (req.user?.role.key === "CLIENT_PORTAL") throw new AuthorizationError("The workspace dashboard is not available to client portal users."); next(); });

const periodQ = z.object({ period: z.coerce.number().int().default(28).refine((n) => (DASHBOARD_PERIODS as readonly number[]).includes(n), "period must be 7, 28 or 90") });
const meta = (req: Request) => ({ ipAddress: req.ip, userAgent: req.get("user-agent") ?? undefined });

router.get("/", asyncHandler(async (req, res) => {
  const { period } = periodQ.parse(req.query);
  sendSuccess(res, await dashboardService.compute(req.user!, period));
}));

router.get("/export/:widget", asyncHandler(async (req, res) => {
  const { period } = periodQ.parse(req.query);
  const key = String(req.params.widget).replace(/\.csv$/, "") as WidgetKey;
  if (!(WIDGET_KEYS as readonly string[]).includes(key)) throw new NotFoundError("Unknown widget.");
  if (!canRead(req.user!, WIDGET_PERMISSION[key])) throw new AuthorizationError(`Permission denied. Required privilege: "${[WIDGET_PERMISSION[key]].flat().join('" or "')}"`);
  const out = await dashboardService.compute(req.user!, period, [key]);
  const w = out.widgets[0]!;
  const csv = w.csv ?? { header: ["note"], rows: [[w.emptyText ?? "No data"]] };
  await auditLogRepository.record({ organizationId: req.user!.organizationId, actorUserId: req.user!.id, actorType: "USER", action: "dashboard.export", resourceType: "dashboard_widget", resourceId: key, ...meta(req) });
  sendCsv(res, `${key}-${out.period.from}_${out.period.to}.csv`, toCsv(csv.header, csv.rows));
}));

// ---- saved views (personal) ----
router.get("/views", asyncHandler(async (req, res) => {
  const rows = await prisma.dashboardView.findMany({ where: { organizationId: req.user!.organizationId, userId: req.user!.id }, orderBy: { createdAt: "asc" }, take: 50 });
  sendSuccess(res, { views: rows.map((v) => ({ id: v.id, name: v.name, period: v.period })) });
}));
router.post("/views", asyncHandler(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(60), period: z.number().int().refine((n) => (DASHBOARD_PERIODS as readonly number[]).includes(n)) }).parse(req.body);
  const count = await prisma.dashboardView.count({ where: { organizationId: req.user!.organizationId, userId: req.user!.id } });
  if (count >= 20) throw new ValidationError("You can keep at most 20 saved views.");
  const v = await prisma.dashboardView.create({ data: { organizationId: req.user!.organizationId, userId: req.user!.id, name: b.name, period: b.period } });
  sendSuccess(res, { view: { id: v.id, name: v.name, period: v.period } }, 201);
}));
router.delete("/views/:id", asyncHandler(async (req, res) => {
  const r = await prisma.dashboardView.deleteMany({ where: { id: req.params.id!, organizationId: req.user!.organizationId, userId: req.user!.id } });
  if (r.count === 0) throw new NotFoundError("Saved view not found.");
  sendSuccess(res, { deleted: true });
}));

// ---- recipient inbox (each person reads only their own deliveries) ----
router.get("/reports/inbox", asyncHandler(async (req, res) => {
  const rows = await prisma.dashboardReportDelivery.findMany({
    where: { organizationId: req.user!.organizationId, userId: req.user!.id, outcome: "DELIVERED" }, orderBy: { createdAt: "desc" }, take: 30,
    select: { id: true, createdAt: true, sections: true, channels: true, run: { select: { periodFrom: true, periodTo: true, schedule: { select: { name: true } } } } },
  });
  sendSuccess(res, { reports: rows.map((r) => ({ id: r.id, name: r.run.schedule.name, periodFrom: r.run.periodFrom, periodTo: r.run.periodTo, sections: r.sections, channels: r.channels, createdAt: r.createdAt.toISOString() })) });
}));
router.get("/reports/deliveries/:id/download", asyncHandler(async (req, res) => {
  const d = await prisma.dashboardReportDelivery.findFirst({ where: { id: req.params.id!, organizationId: req.user!.organizationId, userId: req.user!.id, html: { not: null } } });
  if (!d) throw new NotFoundError("Report not found.");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="dashboard-report-${d.createdAt.toISOString().slice(0, 10)}.html"`);
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
  res.send(d.html);
}));

// ---- schedules (reports.manage) ----
const manage = requirePermission("reports.manage");
const scheduleBody = z.object({
  name: z.string().trim().min(1).max(80),
  cadence: z.enum(["WEEKLY", "MONTHLY"]),
  sections: z.array(z.enum(REPORT_SECTIONS)).min(1),
  recipientIds: z.array(z.string().uuid()).min(1).max(25),
  periodDays: z.number().int().refine((n) => (DASHBOARD_PERIODS as readonly number[]).includes(n)).default(7),
  enabled: z.boolean().default(true),
  dryRun: z.boolean().default(true),
});
const shape = (s: Awaited<ReturnType<typeof prisma.dashboardReportSchedule.findFirstOrThrow>>) => ({ id: s.id, name: s.name, cadence: s.cadence, sections: s.sections, recipientIds: s.recipientIds, periodDays: s.periodDays, enabled: s.enabled, dryRun: s.dryRun, nextRunAt: s.nextRunAt?.toISOString() ?? null, lastRunAt: s.lastRunAt?.toISOString() ?? null });

router.get("/reports/settings", manage, asyncHandler(async (req, res) => sendSuccess(res, await reportService.getSettings(req.user!.organizationId))));
router.put("/reports/settings", manage, asyncHandler(async (req, res) => {
  const b = z.object({ killSwitch: z.boolean() }).parse(req.body);
  sendSuccess(res, await reportService.setKillSwitch(req.user!, b.killSwitch));
}));

router.get("/reports/schedules", manage, asyncHandler(async (req, res) => {
  const [rows, settings] = await Promise.all([prisma.dashboardReportSchedule.findMany({ where: { organizationId: req.user!.organizationId }, orderBy: { createdAt: "asc" }, take: 50 }), reportService.getSettings(req.user!.organizationId)]);
  sendSuccess(res, { schedules: rows.map(shape), settings });
}));
router.post("/reports/schedules", manage, asyncHandler(async (req, res) => {
  const b = scheduleBody.parse(req.body);
  const org = req.user!.organizationId;
  await reportService.validate(org, b.sections, b.recipientIds);
  const s = await prisma.dashboardReportSchedule.create({ data: { organizationId: org, name: b.name, cadence: b.cadence, sections: b.sections, recipientIds: b.recipientIds, periodDays: b.periodDays, enabled: b.enabled, dryRun: b.dryRun, nextRunAt: nextRunAfter(b.cadence, new Date()), createdBy: req.user!.id } });
  await auditLogRepository.record({ organizationId: org, actorUserId: req.user!.id, actorType: "USER", action: "dashboard.reports.schedule_create", resourceType: "dashboard_report_schedule", resourceId: s.id, afterData: { name: b.name, cadence: b.cadence, sections: b.sections, recipients: b.recipientIds.length, dryRun: b.dryRun }, ...meta(req) });
  sendSuccess(res, { schedule: shape(s) }, 201);
}));
router.patch("/reports/schedules/:id", manage, asyncHandler(async (req, res) => {
  const org = req.user!.organizationId;
  const cur = await prisma.dashboardReportSchedule.findFirst({ where: { id: req.params.id!, organizationId: org } });
  if (!cur) throw new NotFoundError("Report schedule not found.");
  const b = scheduleBody.partial().parse(req.body);
  const sections = b.sections ?? cur.sections;
  const recipients = b.recipientIds ?? cur.recipientIds;
  if (b.sections || b.recipientIds) await reportService.validate(org, sections, recipients);
  const cadence = (b.cadence ?? cur.cadence) as "WEEKLY" | "MONTHLY";
  const s = await prisma.dashboardReportSchedule.update({ where: { id: cur.id }, data: { ...b, ...(b.cadence ? { nextRunAt: nextRunAfter(cadence, new Date()) } : {}) } });
  await auditLogRepository.record({ organizationId: org, actorUserId: req.user!.id, actorType: "USER", action: "dashboard.reports.schedule_update", resourceType: "dashboard_report_schedule", resourceId: s.id, beforeData: { dryRun: cur.dryRun, enabled: cur.enabled }, afterData: { dryRun: s.dryRun, enabled: s.enabled }, ...meta(req) });
  sendSuccess(res, { schedule: shape(s) });
}));
router.delete("/reports/schedules/:id", manage, asyncHandler(async (req, res) => {
  const org = req.user!.organizationId;
  const r = await prisma.dashboardReportSchedule.deleteMany({ where: { id: req.params.id!, organizationId: org } });
  if (r.count === 0) throw new NotFoundError("Report schedule not found.");
  await auditLogRepository.record({ organizationId: org, actorUserId: req.user!.id, actorType: "USER", action: "dashboard.reports.schedule_delete", resourceType: "dashboard_report_schedule", resourceId: req.params.id!, ...meta(req) });
  sendSuccess(res, { deleted: true });
}));
router.post("/reports/schedules/:id/run", manage, asyncHandler(async (req, res) => sendSuccess(res, await reportService.run(req.params.id!, "MANUAL", req.user!))));
router.post("/reports/schedules/:id/send-test", manage, asyncHandler(async (req, res) => sendSuccess(res, await reportService.sendTestToSelf(req.user!, req.params.id!))));
router.get("/reports/schedules/:id/runs", manage, asyncHandler(async (req, res) => {
  const sch = await prisma.dashboardReportSchedule.findFirst({ where: { id: req.params.id!, organizationId: req.user!.organizationId }, select: { id: true } });
  if (!sch) throw new NotFoundError("Report schedule not found.");
  const runs = await prisma.dashboardReportRun.findMany({ where: { scheduleId: sch.id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, trigger: true, status: true, dryRun: true, periodFrom: true, periodTo: true, summary: true, createdAt: true } });
  sendSuccess(res, { runs });
}));
/** Active internal members who can be picked as recipients (id, name, role only). */
router.get("/reports/recipients", manage, asyncHandler(async (req, res) => {
  const rows = await prisma.organizationMembership.findMany({ where: { organizationId: req.user!.organizationId, status: "ACTIVE", user: { status: "ACTIVE", deletedAt: null }, role: { key: { not: "CLIENT_PORTAL" } } }, include: { user: { select: { id: true, firstName: true, lastName: true, email: true } }, role: { select: { key: true, name: true } } }, take: 200, orderBy: { createdAt: "asc" } });
  sendSuccess(res, { recipients: rows.map((m) => ({ id: m.user.id, name: `${m.user.firstName} ${m.user.lastName}`.trim(), email: m.user.email, role: m.role.name, roleKey: m.role.key })) });
}));

export default router;
