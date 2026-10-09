/**
 * Scheduled dashboard reports (Step 14). Rendering reuses dashboardService, so a report can never show a number the dashboard would not.
 * Each recipient gets their OWN rendering containing only the sections they may read; a recipient who lost access to every section is skipped.
 * Delivery = in-app notification + downloadable HTML (always); email is added only when an outbound email provider is configured.
 * Dry run (the default for new schedules) renders and stores but delivers nothing. The kill switch blocks every scheduled and test delivery.
 */
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";
import { NotFoundError, ValidationError } from "../../core/errors";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { notificationService } from "../notificationService";
import { emailService } from "../emailService";
import { heartbeat } from "../ops/heartbeat";
import { canRead, dashboardService, DASHBOARD_PERIODS, WIDGET_KEYS, WIDGET_PERMISSION, WIDGET_SECTION, type Widget, type WidgetKey } from "./dashboardService";
import type { SanitizedUser } from "../../types/domain";

export const REPORT_SECTIONS = ["attention", "website", "crm", "social", "marketing", "operations"] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export const SECTION_TITLES: Record<ReportSection, string> = { attention: "Attention needed", website: "Website", crm: "CRM", social: "Social", marketing: "Marketing & landing pages", operations: "Operations" };

const widgetsOf = (section: ReportSection): WidgetKey[] => WIDGET_KEYS.filter((k) => WIDGET_SECTION[k] === section);

type Person = Pick<SanitizedUser, "id" | "role" | "organizationId"> & { email: string; firstName: string };

/** A person may receive a section when they can read at least one of its widgets. */
export const canReceiveSection = (u: Pick<SanitizedUser, "role">, section: ReportSection): boolean => widgetsOf(section).some((k) => canRead(u, WIDGET_PERMISSION[k]));

export function nextRunAfter(cadence: "WEEKLY" | "MONTHLY", from: Date): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 7, 0, 0));
  if (cadence === "WEEKLY") {
    do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() !== 1 || d <= from);
  } else {
    const m = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 7, 0, 0));
    return m;
  }
  return d;
}

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtCmp = (c: unknown): string => {
  const x = c as { current: number; previous: number | null; changePct: number | null; note: string | null };
  const base = `${x.current}`;
  if (x.changePct !== null) return `${base} (${x.changePct > 0 ? "+" : ""}${x.changePct}% vs previous ${x.previous})`;
  return x.note ? `${base} <small>(${esc(x.note)})</small>` : base;
};

function widgetHtml(w: Widget): string {
  const head = `<h3>${esc(w.title)}</h3><p class="meta">Source: ${esc(w.source)} · as of ${esc(w.asOf)}${w.sourceAsOf ? ` · data refreshed ${esc(w.sourceAsOf)}` : ""}</p>`;
  if (w.state === "empty") return `${head}<p>${esc(w.emptyText)}</p>`;
  const d = (w.data ?? {}) as Record<string, any>;
  switch (w.key) {
    case "website": return `${head}<ul><li>Page views: ${fmtCmp(d.views)}</li><li>Sessions: ${fmtCmp(d.sessions)}</li></ul>`;
    case "landing": return `${head}<ul><li>Published pages: ${esc(d.publishedPages)}</li><li>Views: ${fmtCmp(d.views)}</li><li>Form submissions: ${fmtCmp(d.submissions)}</li><li>Submissions per session: ${d.conversionRate === null ? "not available (no sessions)" : `${esc(d.conversionRate)}%`}</li></ul>`;
    case "crm": return `${head}<ul>${d.leads ? `<li>Leads: ${esc(d.leads.total)} (${Object.entries(d.leads.byStatus).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(", ")}) · new in period ${fmtCmp(d.leads.createdInPeriod)}</li>` : ""}${d.pipeline ? `<li>Open pipeline: ${(d.pipeline.open as any[]).map((o) => `${esc(o.count)} deals, ${esc(o.value)} ${esc(o.currency)}`).join("; ") || "none"} · won in period ${fmtCmp(d.pipeline.wonInPeriod)}</li>` : ""}</ul>`;
    case "funnel": return `${head}<table><tr><th>Source</th>${(d.stages as string[]).map((s) => `<th>${esc(s)}</th>`).join("")}</tr>${(d.rows as any[]).map((r) => `<tr><td>${esc(r.source)}</td>${(d.stages as string[]).map((s) => `<td>${esc(r[s])}</td>`).join("")}</tr>`).join("")}</table><p class="meta">${esc(d.note)}</p>`;
    case "social_analytics": return `${head}${(d.accounts as any[]).map((a) => `<p><b>${esc(a.name)}</b>: ${(a.headline as any[]).map((k) => `${esc(k.label)} ${k.current === null ? "—" : esc(k.current)}${k.changePct !== null ? ` (${k.changePct > 0 ? "+" : ""}${esc(k.changePct)}%)` : ""}`).join(" · ")}</p>`).join("")}`;
    case "social_accounts": return `${head}<ul>${(d.accounts as any[]).map((a) => `<li>${esc(a.name)} — ${esc(a.status)}</li>`).join("")}</ul>`;
    case "operations": return `${head}<ul>${Object.entries(d.checks ?? {}).map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join("")}</ul>`;
    default: {
      const items = (d.red ?? d.recent ?? d.oldest ?? d.accounts ?? []) as any[];
      const counts = d.counts ? Object.entries(d.counts).filter(([, v]) => (v as number) > 0).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(", ") : "";
      return `${head}<p><b>${esc(d.total)}</b>${counts ? ` (${counts})` : ""}</p>${items.length ? `<ul>${items.map((i) => `<li>${esc(i.title ?? i.who ?? i.name ?? i.key)}${i.reason ? ` — ${esc(i.reason)}` : ""}${i.status ? ` — ${esc(i.status)}` : ""}</li>`).join("")}</ul>` : ""}`;
    }
  }
}

export function renderReportHtml(name: string, period: { from: string; to: string }, sections: Array<{ section: ReportSection; widgets: Widget[] }>, generatedAt: string): string {
  const body = sections.map((s) => `<section><h2>${esc(SECTION_TITLES[s.section])}</h2>${s.widgets.map(widgetHtml).join("")}</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(name)}</title><style>body{font-family:Arial,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#0f172a}h2{border-bottom:1px solid #e2e8f0;padding-bottom:4px}.meta,small{color:#475569;font-size:12px}table{border-collapse:collapse}td,th{border:1px solid #cbd5e1;padding:4px 8px;text-align:left}</style></head><body><h1>${esc(name)}</h1><p class="meta">Period ${esc(period.from)} to ${esc(period.to)} (UTC, completed days) · generated ${esc(generatedAt)}. Every number comes from data stored in Artify; nothing is estimated.</p>${body || "<p>No section is available to you.</p>"}</body></html>`;
}

async function loadRecipients(org: string, ids: string[]): Promise<Person[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.organizationMembership.findMany({
    where: { organizationId: org, status: "ACTIVE", userId: { in: ids }, user: { status: "ACTIVE", deletedAt: null }, role: { key: { not: "CLIENT_PORTAL" } } },
    include: { user: true, role: { include: { rolePermissions: { include: { permission: true } } } } },
  });
  return rows.map((m) => ({ id: m.userId, organizationId: org, email: m.user.email, firstName: m.user.firstName, role: { id: m.role.id, key: m.role.key, name: m.role.name, permissions: m.role.rolePermissions.map((rp) => rp.permission.key) } }));
}

export const reportService = {
  async getSettings(org: string) {
    const s = await prisma.dashboardReportSetting.findUnique({ where: { organizationId: org } });
    return { killSwitch: s?.killSwitch ?? false, emailConfigured: emailService.isEnabled(), updatedAt: s?.updatedAt?.toISOString() ?? null };
  },

  async setKillSwitch(actor: SanitizedUser, on: boolean) {
    await prisma.dashboardReportSetting.upsert({ where: { organizationId: actor.organizationId }, create: { organizationId: actor.organizationId, killSwitch: on, updatedBy: actor.id }, update: { killSwitch: on, updatedBy: actor.id, updatedAt: new Date() } });
    await auditLogRepository.record({ organizationId: actor.organizationId, actorUserId: actor.id, actorType: "USER", action: on ? "dashboard.reports.kill_switch_on" : "dashboard.reports.kill_switch_off", resourceType: "dashboard_report_settings", resourceId: actor.organizationId });
    return this.getSettings(actor.organizationId);
  },

  /** Rejects unknown sections and recipients who are not active internal members, or who cannot read every selected section. */
  async validate(org: string, sections: string[], recipientIds: string[]) {
    const bad = sections.filter((s) => !(REPORT_SECTIONS as readonly string[]).includes(s));
    if (bad.length) throw new ValidationError(`Unknown report section: ${bad.join(", ")}.`);
    if (sections.length === 0) throw new ValidationError("Choose at least one section.");
    if (recipientIds.length === 0) throw new ValidationError("Choose at least one recipient.");
    const people = await loadRecipients(org, recipientIds);
    const found = new Set(people.map((p) => p.id));
    const missing = recipientIds.filter((id) => !found.has(id));
    if (missing.length) throw new ValidationError("Recipients must be active internal users of this workspace (client portal users cannot receive reports).");
    for (const p of people) {
      const lacking = (sections as ReportSection[]).filter((s) => !canReceiveSection(p, s));
      if (lacking.length) throw new ValidationError(`${p.email} does not have permission to read: ${lacking.map((s) => SECTION_TITLES[s]).join(", ")}. Remove them or remove those sections.`);
    }
  },

  async generateFor(person: Person, sections: ReportSection[], days: number, name: string, now: Date) {
    const allowed = sections.filter((s) => canReceiveSection(person, s));
    if (allowed.length === 0) return null;
    const keys = allowed.flatMap(widgetsOf).filter((k) => canRead(person, WIDGET_PERMISSION[k]));
    // The widgets run with the RECIPIENT's identity, so a report can never contain more than their own dashboard.
    const dash = await dashboardService.compute(person as unknown as SanitizedUser, days, keys, now);
    const by = new Map(dash.widgets.map((w) => [w.key, w]));
    const grouped = allowed.map((section) => ({ section, widgets: widgetsOf(section).map((k) => by.get(k)!).filter((w) => w && w.state !== "forbidden") }));
    return { allowed, html: renderReportHtml(name, { from: dash.period.from, to: dash.period.to }, grouped, now.toISOString()) };
  },

  /** One run of a schedule. Never throws for a single recipient's failure. */
  async run(scheduleId: string, trigger: "SCHEDULE" | "MANUAL", actor?: SanitizedUser, now = new Date()) {
    const sch = await prisma.dashboardReportSchedule.findUnique({ where: { id: scheduleId } });
    if (!sch || (actor && sch.organizationId !== actor.organizationId)) throw new NotFoundError("Report schedule not found.");
    const org = sch.organizationId;
    const settings = await this.getSettings(org);
    const days = (DASHBOARD_PERIODS as readonly number[]).includes(sch.periodDays) ? sch.periodDays : 7;
    const dryRun = sch.dryRun;
    const killed = settings.killSwitch;
    const sections = sch.sections as ReportSection[];
    const period = (await dashboardService.compute({ role: { key: "SUPER_ADMIN", id: "", name: "", permissions: [] }, organizationId: org } as unknown as SanitizedUser, days, [], now)).period;
    const run = await prisma.dashboardReportRun.create({ data: { organizationId: org, scheduleId, trigger, status: killed ? "KILLED" : dryRun ? "DRY_RUN" : "SENT", dryRun, periodFrom: period.from, periodTo: period.to } });
    const outcomes: Array<{ userId: string; outcome: string }> = [];
    if (!killed) {
      const people = await loadRecipients(org, sch.recipientIds);
      for (const person of people) {
        try {
          const rep = await this.generateFor(person, sections, days, sch.name, now);
          if (!rep) { await prisma.dashboardReportDelivery.create({ data: { organizationId: org, runId: run.id, userId: person.id, outcome: "SKIPPED_NO_PERMISSION" } }); outcomes.push({ userId: person.id, outcome: "SKIPPED_NO_PERMISSION" }); continue; }
          if (dryRun) { await prisma.dashboardReportDelivery.create({ data: { organizationId: org, runId: run.id, userId: person.id, sections: rep.allowed, outcome: "DRY_RUN", html: rep.html } }); outcomes.push({ userId: person.id, outcome: "DRY_RUN" }); continue; }
          const channels = await this.deliver(person, org, run.id, sch.name, rep.html);
          const d = await prisma.dashboardReportDelivery.create({ data: { organizationId: org, runId: run.id, userId: person.id, sections: rep.allowed, outcome: "DELIVERED", channels, html: rep.html } });
          await notificationService.notify({ organizationId: org, userId: person.id, type: "dashboard_report", title: sch.name, message: `Your ${sch.cadence.toLowerCase()} dashboard summary is ready (${period.from} to ${period.to}).`, entityType: "dashboard_report_delivery", entityId: d.id });
          outcomes.push({ userId: person.id, outcome: "DELIVERED" });
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : "unknown", scheduleId }, "[reports] recipient failed");
          await prisma.dashboardReportDelivery.create({ data: { organizationId: org, runId: run.id, userId: person.id, outcome: "FAILED" } }).catch(() => undefined);
          outcomes.push({ userId: person.id, outcome: "FAILED" });
        }
      }
    }
    const status = killed ? "KILLED" : outcomes.some((o) => o.outcome === "FAILED") ? "PARTIAL" : dryRun ? "DRY_RUN" : "SENT";
    await prisma.dashboardReportRun.update({ where: { id: run.id }, data: { status, summary: { outcomes } } });
    await prisma.dashboardReportSchedule.update({ where: { id: scheduleId }, data: { lastRunAt: now, ...(trigger === "SCHEDULE" ? { nextRunAt: nextRunAfter(sch.cadence as "WEEKLY" | "MONTHLY", now) } : {}) } });
    await auditLogRepository.record({ organizationId: org, actorUserId: actor?.id, actorType: actor ? "USER" : "SYSTEM", action: "dashboard.reports.run", resourceType: "dashboard_report_schedule", resourceId: scheduleId, metadata: { trigger, status, dryRun, recipients: outcomes.length } });
    return { runId: run.id, status, dryRun, killed, outcomes };
  },

  /** In-app is the delivery (the notification is written by the caller); email is added only with a configured provider. */
  async deliver(person: Person, _org: string, _runId: string, name: string, html: string): Promise<string[]> {
    const channels = ["IN_APP"];
    if (emailService.isEnabled()) {
      try { await emailService.send({ to: person.email, subject: name, text: "Your Artify dashboard summary is attached in the Control Center under Notifications.", html }); channels.push("EMAIL"); } catch { /* in-app delivery stands; the failure is logged by emailService */ }
    }
    return channels;
  },

  /** "Send test to me": one real copy to the caller only. Blocked by the kill switch. */
  async sendTestToSelf(actor: SanitizedUser, scheduleId: string, now = new Date()) {
    const sch = await prisma.dashboardReportSchedule.findUnique({ where: { id: scheduleId } });
    if (!sch || sch.organizationId !== actor.organizationId) throw new NotFoundError("Report schedule not found.");
    const settings = await this.getSettings(actor.organizationId);
    if (settings.killSwitch) throw new ValidationError("The report kill switch is on, so nothing can be sent. Turn it off first.");
    const person: Person = { id: actor.id, organizationId: actor.organizationId, email: actor.email, firstName: actor.firstName, role: actor.role };
    const rep = await this.generateFor(person, sch.sections as ReportSection[], sch.periodDays, `[Test] ${sch.name}`, now);
    if (!rep) throw new ValidationError("You do not have permission to read any section of this report.");
    const period = (await dashboardService.compute(actor, sch.periodDays, [], now)).period;
    const run = await prisma.dashboardReportRun.create({ data: { organizationId: actor.organizationId, scheduleId, trigger: "TEST", status: "SENT", dryRun: false, periodFrom: period.from, periodTo: period.to, summary: { outcomes: [{ userId: actor.id, outcome: "DELIVERED" }] } } });
    const channels = await this.deliver(person, actor.organizationId, run.id, `[Test] ${sch.name}`, rep.html);
    const d = await prisma.dashboardReportDelivery.create({ data: { organizationId: actor.organizationId, runId: run.id, userId: actor.id, sections: rep.allowed, outcome: "DELIVERED", channels, html: rep.html } });
    await notificationService.notify({ organizationId: actor.organizationId, userId: actor.id, type: "dashboard_report", title: `[Test] ${sch.name}`, message: "Your test report is ready.", entityType: "dashboard_report_delivery", entityId: d.id });
    await auditLogRepository.record({ organizationId: actor.organizationId, actorUserId: actor.id, actorType: "USER", action: "dashboard.reports.send_test", resourceType: "dashboard_report_schedule", resourceId: scheduleId, metadata: { channels } });
    return { deliveryId: d.id, channels, emailConfigured: settings.emailConfigured };
  },

  /** Scheduler entry (runs inside the 5-minute tick). Due, enabled schedules only; the kill switch makes `run` record KILLED. */
  async tick(now = new Date()) {
    const due = await prisma.dashboardReportSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, take: 20 });
    if (due.length === 0) return { ran: 0 };
    let ran = 0;
    await heartbeat.around("dashboard_reports", async () => { for (const s of due) { try { await this.run(s.id, "SCHEDULE", undefined, now); ran++; } catch (err) { logger.warn({ err: err instanceof Error ? err.message : "unknown" }, "[reports] schedule failed"); } } });
    return { ran };
  },
};
