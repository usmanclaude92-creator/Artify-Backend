/**
 * Scheduler heartbeats (Step 13). Every scheduled job writes one row (`job_heartbeats`) each time it runs, so System Health can tell
 * "ran 2 minutes ago" from "has not run for an hour". Recording must never break the job it observes.
 */
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";

export interface HeartbeatSpec { key: string; label: string; expectedEverySeconds: number; /** a job that only runs in a time window (e.g. daily purge) */ note?: string }

/** The jobs System Health watches. `expectedEverySeconds` is how often the job SHOULD run; "late" = no finished run for 3x that. */
export const HEARTBEATS: HeartbeatSpec[] = [
  { key: "publish_tick", label: "Social publish scheduler", expectedEverySeconds: 60, note: "pg_cron every minute" },
  { key: "automation_tick", label: "Automation tick", expectedEverySeconds: 300, note: "pg_cron every 5 minutes" },
  { key: "token_health", label: "Social token health job", expectedEverySeconds: 300, note: "runs inside the automation tick" },
  { key: "analytics_ingest", label: "Social analytics job", expectedEverySeconds: 300, note: "inside the tick; each account is fetched once per UTC day" },
  { key: "listening_poll", label: "Social listening poll", expectedEverySeconds: 300, note: "inside the tick; only when SOCIAL_LISTENING_POLLING=true" },
  { key: "inbox_tick", label: "Social inbox job", expectedEverySeconds: 300, note: "inside the tick" },
  { key: "retention_purge", label: "Retention purge", expectedEverySeconds: 86400, note: "daily, 02:00 to 04:59 UTC window" },
  { key: "critical_export", label: "Scheduled critical-data export", expectedEverySeconds: 86400, note: "daily, only when BACKUP_EXPORT_ENABLED=true" },
];

export const heartbeat = {
  /** Runs `fn`, records start/finish/status. Rethrows the job's own error after recording it. */
  async around<T>(key: string, fn: () => Promise<T>, isError: (r: T) => boolean = () => false): Promise<T> {
    const started = new Date();
    try {
      const result = await fn();
      await heartbeat.record(key, started, isError(result) ? "error" : "ok", isError(result) ? "job reported an error" : undefined);
      return result;
    } catch (err) {
      await heartbeat.record(key, started, "error", err instanceof Error ? err.name : "error");
      throw err;
    }
  },

  async record(key: string, startedAt: Date, status: "ok" | "error", error?: string): Promise<void> {
    try {
      const now = new Date();
      await prisma.jobHeartbeat.upsert({
        where: { key },
        create: { key, lastStartedAt: startedAt, lastFinishedAt: now, lastStatus: status, lastError: error?.slice(0, 200) ?? null, runCount: 1 },
        update: { lastStartedAt: startedAt, lastFinishedAt: now, lastStatus: status, lastError: error?.slice(0, 200) ?? null, runCount: { increment: 1 } },
      });
    } catch (err) {
      logger.warn({ key, err: err instanceof Error ? err.message : "unknown" }, "[heartbeat] could not record");
    }
  },
};
