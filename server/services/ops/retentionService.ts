/** Retention purge (Step 13). One job per policy entry that names one; cutoffs come from RETENTION_POLICY. Deletes only when RETENTION_PURGE_ENABLED=true. */
import { prisma } from "../../db/prisma";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { RETENTION_POLICY, type RetentionEntry } from "./retentionPolicy";
import { backupService } from "./backupService";

type Count = (cutoff: Date, orgId: string) => Promise<number>;
interface Job { count: Count; purge: Count }

const cutoffFor = (days: number, now: Date) => new Date(now.getTime() - days * 86_400_000);

/** Jobs keyed by RetentionEntry.purgeJob. `social_inbox` is executed by the inbox job itself (it owns the per-workspace setting); here it is only reported. */
export const PURGE_JOBS: Record<string, Job> = {
  analytics_events: {
    count: (c, org) => prisma.analyticsEvent.count({ where: { organizationId: org, createdAt: { lt: c } } }),
    purge: async (c, org) => (await prisma.analyticsEvent.deleteMany({ where: { organizationId: org, createdAt: { lt: c } } })).count,
  },
  sessions: {
    count: (c, org) => prisma.session.count({ where: { organizationId: org, OR: [{ expiresAt: { lt: c } }, { revokedAt: { lt: c } }] } }),
    purge: async (c, org) => (await prisma.session.deleteMany({ where: { organizationId: org, OR: [{ expiresAt: { lt: c } }, { revokedAt: { lt: c } }] } })).count,
  },
  preview_tokens: {
    count: (c, org) => prisma.landingPreviewToken.count({ where: { page: { organizationId: org }, expiresAt: { lt: c } } }),
    purge: async (c, org) => (await prisma.landingPreviewToken.deleteMany({ where: { page: { organizationId: org }, expiresAt: { lt: c } } })).count,
  },
  critical_exports: {
    count: (c, org) => prisma.dataExport.count({ where: { organizationId: org, kind: "critical", expiresAt: { lt: new Date() } } }).then(() => 0),
    purge: (_c, org) => backupService.applyRetention(org),
  },
  social_inbox: {
    count: (c, org) => prisma.socialMessage.count({ where: { organizationId: org, createdAt: { lt: c } } }),
    purge: async () => 0, // executed by inboxTick (needs per-workspace retentionDays); reported only
  },
};

export const purgeEnabled = () => process.env.RETENTION_PURGE_ENABLED === "true";

export interface RetentionRunRow { key: string; dataClass: string; retentionDays: number | null; cutoff: string | null; eligible: number | null; purged: number; note?: string }

export const retentionService = {
  policy: (): RetentionEntry[] => RETENTION_POLICY,

  async run(orgId: string, opts: { now?: Date; execute?: boolean } = {}): Promise<{ executed: boolean; rows: RetentionRunRow[] }> {
    const now = opts.now ?? new Date();
    const execute = !!opts.execute && purgeEnabled();
    const rows: RetentionRunRow[] = [];
    for (const e of RETENTION_POLICY) {
      if (!e.purgeJob || e.retentionDays === null) { rows.push({ key: e.key, dataClass: e.dataClass, retentionDays: e.retentionDays, cutoff: null, eligible: null, purged: 0, note: "No automatic purge (kept until erased or reviewed)." }); continue; }
      const job = PURGE_JOBS[e.purgeJob];
      if (!job) { rows.push({ key: e.key, dataClass: e.dataClass, retentionDays: e.retentionDays, cutoff: null, eligible: null, purged: 0, note: "Policy names a purge job that does not exist." }); continue; }
      const cutoff = cutoffFor(e.retentionDays, now);
      const eligible = await job.count(cutoff, orgId);
      let purged = 0;
      if (execute && e.key !== "social_inbox") purged = await job.purge(cutoff, orgId);
      rows.push({ key: e.key, dataClass: e.dataClass, retentionDays: e.retentionDays, cutoff: cutoff.toISOString(), eligible, purged, note: e.key === "social_inbox" ? "Purged by the inbox job in the 02:00 to 04:59 UTC window." : undefined });
    }
    if (execute && rows.some((r) => r.purged > 0)) {
      await auditLogRepository.record({ organizationId: orgId, actorType: "SYSTEM", action: "OPS_RETENTION_PURGE", resourceType: "retention", afterData: Object.fromEntries(rows.filter((r) => r.purged > 0).map((r) => [r.key, r.purged])) });
    }
    return { executed: execute, rows };
  },
};
