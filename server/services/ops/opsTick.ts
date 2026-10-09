/** Ops work that rides on the scheduler tick (Step 13): record health, send grouped alerts, run the retention purge and the scheduled export. Never throws. */
import { config } from "../../config/env";
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";
import { healthService } from "./healthService";
import { heartbeat } from "./heartbeat";
import { retentionService, purgeEnabled } from "./retentionService";
import { backupService } from "./backupService";
import { reportService } from "../dashboard/reportService";

const inWindow = (now: Date) => now.getUTCHours() >= 2 && now.getUTCHours() <= 4;

export async function opsTick(now = new Date()) {
  const out = { health: { checks: 0, red: 0, alerted: 0 }, purge: { ran: false }, export: { ran: false, error: false } };
  const orgId = config.publicWebsiteOrganizationId;
  if (!orgId) return out;
  try {
    const checks = await healthService.runAndStore(orgId, now);
    out.health.checks = checks.length;
    out.health.red = checks.filter((c) => c.status === "red").length;
    out.health.alerted = (await healthService.alertIfNeeded(orgId, now)).alerted;
  } catch (err) { logger.warn({ err: err instanceof Error ? err.message : "unknown" }, "[ops] health pass failed"); }

  try { await reportService.tick(now); } catch (err) { logger.warn({ err: err instanceof Error ? err.message : "unknown" }, "[ops] report tick failed"); }

  if (inWindow(now)) {
    const lastPurge = await prisma.jobHeartbeat.findUnique({ where: { key: "retention_purge" } }).catch(() => null);
    const doneToday = lastPurge?.lastFinishedAt && lastPurge.lastFinishedAt.toDateString() === now.toDateString();
    if (!doneToday) {
      try { await heartbeat.around("retention_purge", () => retentionService.run(orgId, { now, execute: purgeEnabled() })); out.purge.ran = true; } catch { /* recorded by heartbeat */ }
    }
    if (process.env.BACKUP_EXPORT_ENABLED === "true") {
      const last = await prisma.jobHeartbeat.findUnique({ where: { key: "critical_export" } }).catch(() => null);
      if (!(last?.lastFinishedAt && last.lastFinishedAt.toDateString() === now.toDateString() && last.lastStatus === "ok")) {
        try { await heartbeat.around("critical_export", () => backupService.runCriticalExport(orgId, null, now)); out.export.ran = true; } catch { out.export.error = true; }
      }
    }
  }
  return out;
}
