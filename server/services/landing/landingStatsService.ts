/**
 * Per-page analytics from data the platform already stores: `analytics_events` (`page_view`, written by the website beacon) and
 * the managed form's submissions. No estimates: when nothing was recorded the numbers are 0/null and `hasData` is false.
 * "Unique sessions" are tab-scoped random session ids, not people, and are labelled that way.
 */
import { prisma } from "../../db/prisma";
import { landingFormSlug } from "./landingForm";
import { landingPageService, landingPath } from "./landingPageService";
import type { SanitizedUser } from "../../types/domain";

export const landingStatsService = {
  async forPage(caller: SanitizedUser, id: string, days: number) {
    const org = caller.organizationId;
    await landingPageService.loadPage(org, id); // tenancy + existence
    const page = (await prisma.page.findUnique({ where: { id }, select: { slug: true } }))!;
    const since = new Date(Date.now() - days * 86_400_000);
    const path = landingPath(page.slug);

    const [views, sessions, daily, sources, form] = await Promise.all([
      prisma.analyticsEvent.count({ where: { organizationId: org, eventType: "page_view", path, createdAt: { gte: since } } }),
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE organization_id = ${org} AND event_type = 'page_view' AND path = ${path} AND created_at >= ${since} AND session_id IS NOT NULL`,
      prisma.$queryRaw<Array<{ day: Date; views: bigint }>>`SELECT date_trunc('day', created_at) AS day, COUNT(*) AS views FROM analytics_events WHERE organization_id = ${org} AND event_type = 'page_view' AND path = ${path} AND created_at >= ${since} GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<Array<{ source: string | null; n: bigint }>>`SELECT utm_source AS source, COUNT(*) AS n FROM analytics_events WHERE organization_id = ${org} AND event_type = 'page_view' AND path = ${path} AND created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      prisma.form.findUnique({ where: { landingPageId: id }, select: { id: true } }),
    ]);
    const submissions = form ? await prisma.formSubmission.count({ where: { organizationId: org, formId: form.id, createdAt: { gte: since } } }) : 0;
    const uniqueSessions = Number(sessions[0]?.n ?? 0);
    return {
      days, path, formSlug: landingFormSlug(id),
      views, uniqueSessions, submissions,
      /** submissions / unique sessions; null when there are no sessions to divide by (never a made-up 0%). */
      conversionRate: uniqueSessions > 0 ? Math.round((submissions / uniqueSessions) * 1000) / 10 : null,
      topSources: sources.map((s) => ({ source: s.source ?? "(direct / none)", views: Number(s.n) })),
      daily: daily.map((d) => ({ date: d.day.toISOString().slice(0, 10), views: Number(d.views) })),
      hasData: views > 0 || submissions > 0,
      note: "Views and sessions come from the website's first-party beacon; a session is one browser tab, not a person. Ad blockers can hide views, so the conversion rate can be overstated.",
    };
  },
};
