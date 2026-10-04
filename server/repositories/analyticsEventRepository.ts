/**
 * AnalyticsEvent data access (Phase 15 — docs/ANALYTICS_ARCHITECTURE.md).
 * Append-only ingest plus server-side aggregation queries only — no method
 * here returns raw individual rows to a caller; every read is a count,
 * group-by, or distinct-count, since rows are never surfaced individually
 * to any UI beyond this aggregation layer (organization admins see
 * aggregates via analyticsReportingService, never a flat event feed).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface AnalyticsEventInput {
  organizationId: string;
  eventType: string;
  path?: string;
  referrer?: string;
  sessionId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  campaignId?: string;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export const analyticsEventRepository = {
  async create(data: AnalyticsEventInput): Promise<void> {
    await prisma.analyticsEvent.create({
      data: {
        organizationId: data.organizationId,
        eventType: data.eventType,
        path: data.path,
        referrer: data.referrer,
        sessionId: data.sessionId,
        utmSource: data.utmSource,
        utmMedium: data.utmMedium,
        utmCampaign: data.utmCampaign,
        utmTerm: data.utmTerm,
        utmContent: data.utmContent,
        campaignId: data.campaignId,
        entityType: data.entityType,
        entityId: data.entityId,
        metadata: data.metadata ?? {},
      },
    });
  },

  async countByEventType(organizationId: string, eventType: string, range: DateRange): Promise<number> {
    return prisma.analyticsEvent.count({
      where: { organizationId, eventType, createdAt: { gte: range.from, lte: range.to } },
    });
  },

  /** Real counts per event type actually emitted in range — never a fabricated zero for an event type nothing recorded (that type is simply absent from the returned record). */
  async countByEventTypes(organizationId: string, range: DateRange): Promise<Record<string, number>> {
    const rows = await prisma.analyticsEvent.groupBy({
      by: ["eventType"],
      where: { organizationId, createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    });
    const result: Record<string, number> = {};
    for (const row of rows) result[row.eventType] = row._count._all;
    return result;
  },

  async distinctSessionCount(organizationId: string, range: DateRange, eventType?: string): Promise<number> {
    const rows = await prisma.analyticsEvent.findMany({
      where: { organizationId, createdAt: { gte: range.from, lte: range.to }, sessionId: { not: null }, ...(eventType ? { eventType } : {}) },
      distinct: ["sessionId"],
      select: { sessionId: true },
    });
    return rows.length;
  },

  async topPaths(organizationId: string, range: DateRange, eventType: string, limit: number): Promise<Array<{ path: string; count: number }>> {
    const rows = await prisma.analyticsEvent.groupBy({
      by: ["path"],
      where: { organizationId, eventType, createdAt: { gte: range.from, lte: range.to }, path: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { path: "desc" } },
      take: limit,
    });
    return rows.filter((r) => r.path).map((r) => ({ path: r.path as string, count: r._count._all }));
  },

  /** Daily time series for a single event type — the dashboard's traffic chart. Raw SQL only for the date_trunc grouping Prisma's query builder can't express; organizationId/eventType/range are bound parameters, never interpolated. */
  async countByDay(organizationId: string, eventType: string, range: DateRange): Promise<Array<{ day: string; count: number }>> {
    const rows = await prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', created_at) AS day, COUNT(*)::bigint AS count
      FROM analytics_events
      WHERE organization_id = ${organizationId} AND event_type = ${eventType}
        AND created_at >= ${range.from} AND created_at <= ${range.to}
      GROUP BY day
      ORDER BY day ASC
    `;
    return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), count: Number(r.count) }));
  },

  async utmSourceBreakdown(organizationId: string, range: DateRange, eventType: string): Promise<Array<{ utmSource: string; count: number }>> {
    const rows = await prisma.analyticsEvent.groupBy({
      by: ["utmSource"],
      where: { organizationId, eventType, createdAt: { gte: range.from, lte: range.to }, utmSource: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { utmSource: "desc" } },
      take: 20,
    });
    return rows.filter((r) => r.utmSource).map((r) => ({ utmSource: r.utmSource as string, count: r._count._all }));
  },

  async utmCampaignBreakdown(organizationId: string, range: DateRange, eventType: string): Promise<Array<{ utmCampaign: string; count: number }>> {
    const rows = await prisma.analyticsEvent.groupBy({
      by: ["utmCampaign"],
      where: { organizationId, eventType, createdAt: { gte: range.from, lte: range.to }, utmCampaign: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { utmCampaign: "desc" } },
      take: 20,
    });
    return rows.filter((r) => r.utmCampaign).map((r) => ({ utmCampaign: r.utmCampaign as string, count: r._count._all }));
  },

  /** Whether this organization has ever ingested any event at all — distinguishes "no traffic yet" (real zero) from "analytics never configured/wired" at the service layer. */
  async hasAnyEvent(organizationId: string): Promise<boolean> {
    const row = await prisma.analyticsEvent.findFirst({ where: { organizationId }, select: { id: true } });
    return row !== null;
  },
};
