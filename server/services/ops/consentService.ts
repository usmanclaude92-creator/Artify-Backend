/** Consent register (Step 13): one row per capture event with its source and time. Holds IDs only, no personal data. Never breaks the capture it records. */
import { prisma } from "../../db/prisma";
import { logger } from "../../core/logger";

export type ConsentStatus = "GIVEN" | "DECLINED" | "NOT_COLLECTED";
export const consentStatusOf = (given: boolean | null | undefined): ConsentStatus => (given === true ? "GIVEN" : given === false ? "DECLINED" : "NOT_COLLECTED");

export const consentService = {
  async record(p: { organizationId: string; leadId?: string | null; submissionId?: string | null; source: string; consentGiven: boolean | null | undefined; at?: Date }): Promise<void> {
    try {
      await prisma.consentRecord.create({ data: { organizationId: p.organizationId, leadId: p.leadId ?? null, submissionId: p.submissionId ?? null, source: (p.source || "unknown").slice(0, 120), status: consentStatusOf(p.consentGiven), capturedAt: p.at ?? new Date() } });
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : "unknown" }, "[consent] could not record consent event");
    }
  },

  /** Capture paths that have a consent mechanism (forms, landing forms) or none (manual entry, automation, inbox auto-lead): the register is complete either way. */
  async list(orgId: string, q: { page: number; limit: number; status?: ConsentStatus; source?: string }) {
    const where = { organizationId: orgId, ...(q.status ? { status: q.status } : {}), ...(q.source ? { source: { startsWith: q.source } } : {}) };
    const [rows, total, bySource] = await Promise.all([
      prisma.consentRecord.findMany({ where, orderBy: { capturedAt: "desc" }, skip: (q.page - 1) * q.limit, take: q.limit }),
      prisma.consentRecord.count({ where }),
      prisma.consentRecord.groupBy({ by: ["source", "status"], where: { organizationId: orgId }, _count: true }),
    ]);
    return { rows, total, summary: bySource.map((b) => ({ source: b.source, status: b.status, count: b._count })) };
  },
};
