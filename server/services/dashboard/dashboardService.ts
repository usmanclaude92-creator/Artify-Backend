/**
 * Role-aware Dashboard (Step 14, docs/DASHBOARD.md). Every number is read from rows this platform already stores; nothing calls Meta, Google or any
 * other network. A widget the caller may not read is never computed (`state: "forbidden"`). Each widget says when it was computed (`asOf`) and, for
 * snapshot-style sources, when its source was last refreshed (`sourceAsOf`). Period-over-period percentages are produced only when BOTH periods
 * are fully covered by stored data; otherwise the reason is returned instead.
 */
import { prisma } from "../../db/prisma";
import { approvalCenterService } from "../approvalCenterService";
import { analyticsQueries } from "../social/analytics/analyticsQueries";
import { HEARTBEATS } from "../ops/heartbeat";
import type { SanitizedUser } from "../../types/domain";

export const DASHBOARD_PERIODS = [7, 28, 90] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
const DAY = 86_400_000;

export const WIDGET_KEYS = [
  "attention_approvals", "attention_posts", "attention_sla", "attention_health", "attention_accounts",
  "website", "crm", "social_accounts", "social_analytics", "landing", "funnel", "operations",
] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];

/** Permission each widget needs (docs/DASHBOARD.md §1). funnel/crm have finer, per-stage gates inside. */
export const WIDGET_PERMISSION: Record<WidgetKey, string | string[]> = {
  attention_approvals: "approvals.read",
  attention_posts: "social.read",
  attention_sla: "social.read",
  attention_health: "ops.health.read",
  attention_accounts: "social.read",
  website: "analytics.read",
  crm: ["leads.read", "opportunities.read"],
  social_accounts: "social.read",
  social_analytics: "social.analytics.read",
  landing: "marketing.landing.read",
  funnel: "marketing.landing.read",
  operations: "ops.health.read",
};

/** Module a widget belongs to, used for the summary cards / report sections. */
export const WIDGET_SECTION: Record<WidgetKey, "attention" | "website" | "crm" | "social" | "marketing" | "operations"> = {
  attention_approvals: "attention", attention_posts: "attention", attention_sla: "attention", attention_health: "attention", attention_accounts: "attention",
  website: "website", crm: "crm", social_accounts: "social", social_analytics: "social", landing: "marketing", funnel: "marketing", operations: "operations",
};

export interface Csv { header: string[]; rows: Array<Array<string | number | null>> }
export interface Widget {
  key: WidgetKey;
  title: string;
  state: "ok" | "empty" | "forbidden";
  asOf: string;
  sourceAsOf: string | null;
  source: string;
  link: string;
  emptyText?: string;
  data?: Record<string, unknown>;
  csv?: Csv;
}
export interface Period { days: DashboardPeriod; from: string; to: string; previousFrom: string; previousTo: string }

export const canRead = (user: Pick<SanitizedUser, "role">, perm: string | string[]): boolean => {
  if (user.role.key === "SUPER_ADMIN") return true;
  return (Array.isArray(perm) ? perm : [perm]).some((p) => user.role.permissions.includes(p));
};
const has = (user: Pick<SanitizedUser, "role">, p: string) => user.role.key === "SUPER_ADMIN" || user.role.permissions.includes(p);

export function resolvePeriod(days: number, now = new Date()): { start: Date; end: Date; prevStart: Date; info: Period } {
  const d = (DASHBOARD_PERIODS as readonly number[]).includes(days) ? (days as DashboardPeriod) : 28;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); // today 00:00 UTC, exclusive
  const start = new Date(end.getTime() - d * DAY);
  const prevStart = new Date(start.getTime() - d * DAY);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start, end, prevStart, info: { days: d, from: iso(start), to: iso(new Date(end.getTime() - DAY)), previousFrom: iso(prevStart), previousTo: iso(new Date(start.getTime() - DAY)) } };
}

export interface Compare { current: number; previous: number | null; changePct: number | null; note: string | null }
/** previous/percentage only when the earliest stored row is on or before the start of the previous period. */
export function compare(current: number, previous: number, earliest: Date | null, prevStart: Date): Compare {
  if (!earliest) return { current, previous: null, changePct: null, note: "Nothing has been stored yet, so there is nothing to compare with." };
  if (earliest > prevStart) return { current, previous: null, changePct: null, note: `Comparison needs data from ${prevStart.toISOString().slice(0, 10)}; the first stored record is ${earliest.toISOString().slice(0, 10)}.` };
  if (previous === 0) return { current, previous, changePct: null, note: "The previous period had none, so no percentage is shown." };
  return { current, previous, changePct: Math.round(((current - previous) / previous) * 1000) / 10, note: null };
}

const forbidden = (key: WidgetKey, title: string, link: string, now: Date): Widget => ({ key, title, state: "forbidden", asOf: now.toISOString(), sourceAsOf: null, source: "", link });
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

type Ctx = { user: SanitizedUser; org: string; now: Date; p: ReturnType<typeof resolvePeriod> };

async function sessionsIn(org: string, from: Date, to: Date, lpOnly: boolean): Promise<number> {
  const rows = lpOnly
    ? await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE organization_id = ${org} AND event_type = 'page_view' AND path LIKE '/lp/%' AND created_at >= ${from} AND created_at < ${to} AND session_id IS NOT NULL`
    : await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(DISTINCT session_id) AS n FROM analytics_events WHERE organization_id = ${org} AND event_type = 'page_view' AND created_at >= ${from} AND created_at < ${to} AND session_id IS NOT NULL`;
  return num(rows[0]?.n);
}

const builders: Record<WidgetKey, (c: Ctx) => Promise<Omit<Widget, "key" | "title" | "asOf" | "link">>> = {
  async attention_approvals({ user }) {
    const s = await approvalCenterService.summary(user);
    const rows = Object.entries(s.counts).filter(([, n]) => n > 0).map(([k, n]) => [k, n] as [string, number]);
    return { state: s.total > 0 ? "ok" : "empty", sourceAsOf: null, source: "Approvals center (live counts)", emptyText: "Nothing is waiting for your approval.", data: { total: s.total, counts: s.counts }, csv: { header: ["source", "waiting"], rows } };
  },

  async attention_posts({ org, now }) {
    const since = new Date(now.getTime() - 30 * DAY);
    const where = { status: { in: ["FAILED", "UNCERTAIN", "MISSED"] as Array<"FAILED" | "UNCERTAIN" | "MISSED"> }, updatedAt: { gte: since }, post: { organizationId: org, deletedAt: null } };
    const [grouped, recent] = await Promise.all([
      prisma.socialPostTarget.groupBy({ by: ["status"], where, _count: { _all: true } }),
      prisma.socialPostTarget.findMany({ where, orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, status: true, updatedAt: true, post: { select: { id: true, title: true } }, account: { select: { displayName: true } } } }),
    ]);
    const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
    const total = grouped.reduce((n, g) => n + g._count._all, 0);
    return {
      state: total > 0 ? "ok" : "empty", sourceAsOf: null, source: "social_post_targets (last 30 days)", emptyText: "No failed or uncertain posts in the last 30 days.",
      data: { total, counts, recent: recent.map((r) => ({ id: r.id, postId: r.post.id, title: r.post.title, account: r.account.displayName, status: r.status, at: r.updatedAt.toISOString() })) },
      csv: { header: ["post", "account", "status", "updated_at"], rows: recent.map((r) => [r.post.title, r.account.displayName, r.status, r.updatedAt.toISOString()]) },
    };
  },

  async attention_sla({ org, now }) {
    const where = { organizationId: org, status: { in: ["OPEN", "PENDING"] as Array<"OPEN" | "PENDING"> }, firstResponseAt: null, slaDueAt: { lt: now } };
    const [total, oldest] = await Promise.all([
      prisma.socialConversation.count({ where }),
      prisma.socialConversation.findMany({ where, orderBy: { slaDueAt: "asc" }, take: 5, select: { id: true, participantName: true, participantHandle: true, slaDueAt: true, account: { select: { displayName: true } } } }),
    ]);
    return {
      state: total > 0 ? "ok" : "empty", sourceAsOf: null, source: "social_conversations (first reply overdue)", emptyText: "No conversation is past its reply deadline.",
      data: { total, oldest: oldest.map((c) => ({ id: c.id, who: c.participantName ?? c.participantHandle ?? "Unknown sender", account: c.account.displayName, dueAt: iso(c.slaDueAt) })) },
      csv: { header: ["sender", "account", "reply_due_at"], rows: oldest.map((c) => [c.participantName ?? c.participantHandle ?? "", c.account.displayName, iso(c.slaDueAt)]) },
    };
  },

  async attention_health({ org }) {
    const rows = await prisma.healthCheckResult.findMany({ where: { organizationId: org }, orderBy: { key: "asc" } });
    const last = rows.reduce<Date | null>((m, r) => (!m || r.checkedAt > m ? r.checkedAt : m), null);
    if (rows.length === 0) return { state: "empty", sourceAsOf: null, source: "health_check_results", emptyText: "Health has not been recorded yet.", data: { total: 0, red: [] } };
    const red = rows.filter((r) => r.status === "red");
    return {
      state: red.length > 0 ? "ok" : "empty", sourceAsOf: iso(last), source: "health_check_results (written by the 5-minute tick)", emptyText: "All stored health checks are OK or not yet checked.",
      data: { total: red.length, checked: rows.length, red: red.map((r) => ({ key: r.key, reason: r.reason, since: iso(r.redSince) })) },
      csv: { header: ["check", "reason", "red_since"], rows: red.map((r) => [r.key, r.reason, iso(r.redSince)]) },
    };
  },

  async attention_accounts({ org, now }) {
    const soon = new Date(now.getTime() + 14 * DAY);
    const rows = await prisma.socialAccount.findMany({
      where: { organizationId: org, OR: [{ status: { in: ["NEEDS_REAUTH", "ERROR"] } }, { tokenExpiresAt: { lt: soon } }] },
      orderBy: { displayName: "asc" }, take: 20, select: { id: true, displayName: true, provider: true, status: true, tokenExpiresAt: true },
    });
    return {
      state: rows.length > 0 ? "ok" : "empty", sourceAsOf: null, source: "social_accounts", emptyText: "No connected account needs attention.",
      data: { total: rows.length, accounts: rows.map((a) => ({ id: a.id, name: a.displayName, provider: a.provider, status: a.status, tokenExpiresAt: iso(a.tokenExpiresAt) })) },
      csv: { header: ["account", "provider", "status", "token_expires_at"], rows: rows.map((a) => [a.displayName, a.provider, a.status, iso(a.tokenExpiresAt)]) },
    };
  },

  async website({ org, p }) {
    const where = (from: Date, to: Date) => ({ organizationId: org, eventType: "page_view", createdAt: { gte: from, lt: to } });
    const [views, prevViews, sessions, prevSessions, earliest, top] = await Promise.all([
      prisma.analyticsEvent.count({ where: where(p.start, p.end) }),
      prisma.analyticsEvent.count({ where: where(p.prevStart, p.start) }),
      sessionsIn(org, p.start, p.end, false),
      sessionsIn(org, p.prevStart, p.start, false),
      prisma.analyticsEvent.aggregate({ where: { organizationId: org, eventType: "page_view" }, _min: { createdAt: true }, _max: { createdAt: true } }),
      prisma.analyticsEvent.groupBy({ by: ["path"], where: where(p.start, p.end), _count: { _all: true }, orderBy: { _count: { path: "desc" } }, take: 5 }),
    ]);
    const min = earliest._min.createdAt;
    if (!min) return { state: "empty", sourceAsOf: null, source: "analytics_events", emptyText: "No website traffic has been recorded yet.", data: { views: 0, sessions: 0 } };
    return {
      state: "ok", sourceAsOf: iso(earliest._max.createdAt), source: "analytics_events (page_view, first-party beacon)",
      data: { views: compare(views, prevViews, min, p.prevStart), sessions: compare(sessions, prevSessions, min, p.prevStart), topPages: top.map((t) => ({ path: t.path ?? "(unknown)", views: t._count._all })), note: "A session is one browser tab, not a person. Ad blockers can hide views." },
      csv: { header: ["metric", "value"], rows: [["page_views", views], ["sessions", sessions], ...top.map((t) => [`top_page ${t.path ?? "(unknown)"}`, t._count._all] as [string, number])] },
    };
  },

  async crm({ user, org, p }) {
    const canL = has(user, "leads.read");
    const canO = has(user, "opportunities.read");
    const OPEN = ["PROSPECTING", "QUALIFICATION", "PROPOSAL", "NEGOTIATION"] as const;
    const [byStatus, created, createdPrev, oldest, open, won, wonPrev, oppOldest] = await Promise.all([
      canL ? prisma.lead.groupBy({ by: ["status"], where: { organizationId: org, deletedAt: null }, _count: { _all: true } }) : null,
      canL ? prisma.lead.count({ where: { organizationId: org, deletedAt: null, createdAt: { gte: p.start, lt: p.end } } }) : null,
      canL ? prisma.lead.count({ where: { organizationId: org, deletedAt: null, createdAt: { gte: p.prevStart, lt: p.start } } }) : null,
      canL ? prisma.lead.aggregate({ where: { organizationId: org, deletedAt: null }, _min: { createdAt: true }, _max: { createdAt: true } }) : null,
      canO ? prisma.opportunity.groupBy({ by: ["currency"], where: { organizationId: org, deletedAt: null, stage: { in: [...OPEN] } }, _count: { _all: true }, _sum: { value: true } }) : null,
      canO ? prisma.opportunity.count({ where: { organizationId: org, deletedAt: null, stage: "CLOSED_WON", actualCloseDate: { gte: p.start, lt: p.end } } }) : null,
      canO ? prisma.opportunity.count({ where: { organizationId: org, deletedAt: null, stage: "CLOSED_WON", actualCloseDate: { gte: p.prevStart, lt: p.start } } }) : null,
      canO ? prisma.opportunity.aggregate({ where: { organizationId: org, deletedAt: null }, _min: { createdAt: true } }) : null,
    ]);
    const leadTotal = (byStatus ?? []).reduce((n, g) => n + g._count._all, 0);
    const oppAny = (open ?? []).length > 0 || (won ?? 0) > 0 || Boolean(oppOldest?._min.createdAt);
    if (leadTotal === 0 && !oppAny) return { state: "empty", sourceAsOf: null, source: "leads, opportunities", emptyText: canL ? "No leads yet." : "No opportunities yet.", data: {} };
    const statusCounts = Object.fromEntries((byStatus ?? []).map((g) => [g.status, g._count._all]));
    const min = oldest?._min.createdAt ?? null;
    const data: Record<string, unknown> = {};
    if (canL) Object.assign(data, { leads: { total: leadTotal, byStatus: statusCounts, createdInPeriod: compare(created ?? 0, createdPrev ?? 0, min, p.prevStart) } });
    if (canO) Object.assign(data, { pipeline: { open: (open ?? []).map((o) => ({ currency: o.currency, count: o._count._all, value: Number(o._sum.value ?? 0) })), wonInPeriod: compare(won ?? 0, wonPrev ?? 0, oppOldest?._min.createdAt ?? null, p.prevStart) } });
    const rows: Array<[string, string | number | null]> = [];
    if (canL) { for (const [k, v] of Object.entries(statusCounts)) rows.push([`leads ${k}`, v as number]); rows.push(["leads created in period", created ?? 0]); }
    if (canO) { for (const o of open ?? []) rows.push([`open pipeline ${o.currency}`, `${o._count._all} deals / ${Number(o._sum.value ?? 0)}`]); rows.push(["deals won in period", won ?? 0]); }
    return { state: "ok", sourceAsOf: iso(oldest?._max.createdAt), source: "leads, opportunities", data, csv: { header: ["metric", "value"], rows } };
  },

  async social_accounts({ org }) {
    const rows = await prisma.socialAccount.findMany({ where: { organizationId: org }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, displayName: true, provider: true, status: true, lastSyncAt: true } });
    if (rows.length === 0) return { state: "empty", sourceAsOf: null, source: "social_accounts", emptyText: "No social account is connected.", data: {} };
    const last = rows.reduce<Date | null>((m, r) => (r.lastSyncAt && (!m || r.lastSyncAt > m) ? r.lastSyncAt : m), null);
    return { state: "ok", sourceAsOf: iso(last), source: "social_accounts", data: { accounts: rows.map((a) => ({ id: a.id, name: a.displayName, provider: a.provider, status: a.status, lastSyncAt: iso(a.lastSyncAt) })) }, csv: { header: ["account", "provider", "status", "last_sync_at"], rows: rows.map((a) => [a.displayName, a.provider, a.status, iso(a.lastSyncAt)]) } };
  },

  async social_analytics({ org, now, p }) {
    const summary = await analyticsQueries.summary(org, { from: p.info.from, to: p.info.to }, now);
    const accounts = summary.accounts.filter((a) => a.analytics === "supported");
    if (accounts.length === 0) return { state: "empty", sourceAsOf: null, source: "social_account_metrics", emptyText: "No analytics have been stored yet — they appear after the first daily sync.", data: {} };
    const last = accounts.reduce<string | null>((m, a) => (a.sync.lastSuccessAt && (!m || a.sync.lastSuccessAt > m) ? a.sync.lastSuccessAt : m), null);
    const tops = await Promise.all(accounts.map((a) => analyticsQueries.topPosts(org, a.id, { from: p.info.from, to: p.info.to, limit: 3 }, now).then((t) => ({ account: a.displayName, rows: t.rows.filter((r) => r.capturedOn) })).catch(() => ({ account: a.displayName, rows: [] }))));
    const anyNumber = accounts.some((a) => a.headline.some((k) => k.current !== null));
    if (!anyNumber) return { state: "empty", sourceAsOf: last, source: "social_account_metrics", emptyText: "No analytics have been stored yet — they appear after the first daily sync.", data: {} };
    const csvRows: Array<[string, string | number | null]> = [];
    for (const a of accounts) for (const k of a.headline) csvRows.push([`${a.displayName} ${k.label}`, k.current]);
    return {
      state: "ok", sourceAsOf: last, source: "social_account_metrics / social_post_metrics (daily snapshots)",
      data: {
        accounts: accounts.map((a) => ({ id: a.id, name: a.displayName, provider: a.provider, headline: a.headline.map((k) => ({ metric: k.metric, label: k.label, current: k.current, previous: k.previous, changePct: k.changePct, compareNote: k.compareNote, daysWithData: k.daysWithData, daysInRange: k.daysInRange })) })),
        topPosts: tops.map((t) => ({ account: t.account, posts: t.rows.map((r) => ({ title: r.title, publishedAt: r.publishedAt, interactions: r.metrics.interactions?.value ?? null, externalUrl: r.externalUrl })) })),
      },
      csv: { header: ["metric", "value"], rows: csvRows },
    };
  },

  async landing({ org, p }) {
    const [pages, views, prevViews, sessions, prevSessions, subs, prevSubs, earliest, perPage] = await Promise.all([
      prisma.page.count({ where: { organizationId: org, landingBuilder: true, deletedAt: null, status: { not: "ARCHIVED" }, landingLiveRevisionId: { not: null } } }),
      prisma.analyticsEvent.count({ where: { organizationId: org, eventType: "page_view", path: { startsWith: "/lp/" }, createdAt: { gte: p.start, lt: p.end } } }),
      prisma.analyticsEvent.count({ where: { organizationId: org, eventType: "page_view", path: { startsWith: "/lp/" }, createdAt: { gte: p.prevStart, lt: p.start } } }),
      sessionsIn(org, p.start, p.end, true),
      sessionsIn(org, p.prevStart, p.start, true),
      prisma.formSubmission.count({ where: { organizationId: org, form: { landingPageId: { not: null } }, createdAt: { gte: p.start, lt: p.end } } }),
      prisma.formSubmission.count({ where: { organizationId: org, form: { landingPageId: { not: null } }, createdAt: { gte: p.prevStart, lt: p.start } } }),
      prisma.analyticsEvent.aggregate({ where: { organizationId: org, eventType: "page_view", path: { startsWith: "/lp/" } }, _min: { createdAt: true }, _max: { createdAt: true } }),
      prisma.analyticsEvent.groupBy({ by: ["path"], where: { organizationId: org, eventType: "page_view", path: { startsWith: "/lp/" }, createdAt: { gte: p.start, lt: p.end } }, _count: { _all: true }, orderBy: { _count: { path: "desc" } }, take: 5 }),
    ]);
    if (pages === 0 && views === 0 && subs === 0) return { state: "empty", sourceAsOf: null, source: "pages, analytics_events, form_submissions", emptyText: "No landing page has been published.", data: { publishedPages: 0 } };
    const min = earliest._min.createdAt;
    return {
      state: "ok", sourceAsOf: iso(earliest._max.createdAt), source: "analytics_events (/lp/…), form_submissions of landing forms",
      data: {
        publishedPages: pages, views: compare(views, prevViews, min, p.prevStart), sessions: compare(sessions, prevSessions, min, p.prevStart), submissions: compare(subs, prevSubs, min, p.prevStart),
        /** submissions per unique session; null (not 0%) when there are no sessions to divide by. */
        conversionRate: sessions > 0 ? Math.round((subs / sessions) * 1000) / 10 : null,
        topPages: perPage.map((r) => ({ path: r.path ?? "", views: r._count._all })),
        note: "Views come from the website's first-party beacon; the rate can be overstated when ad blockers hide views.",
      },
      csv: { header: ["metric", "value"], rows: [["published_pages", pages], ["views", views], ["sessions", sessions], ["submissions", subs], ["conversion_rate_pct", sessions > 0 ? Math.round((subs / sessions) * 1000) / 10 : null]] },
    };
  },

  async funnel(c) {
    const f = await funnelFor(c.user, c.org, c.p);
    if (f.state === "empty") return { state: "empty", sourceAsOf: f.sourceAsOf, source: f.source, emptyText: "No landing-page activity in this period.", data: f.data };
    return { state: "ok", sourceAsOf: f.sourceAsOf, source: f.source, data: f.data, csv: f.csv };
  },

  async operations({ org }) {
    const [health, beats] = await Promise.all([
      prisma.healthCheckResult.groupBy({ by: ["status"], where: { organizationId: org }, _count: { _all: true }, _max: { checkedAt: true } }),
      prisma.jobHeartbeat.findMany({ where: { key: { in: HEARTBEATS.map((h) => h.key).concat("dashboard_reports") } } }),
    ]);
    if (health.length === 0 && beats.length === 0) return { state: "empty", sourceAsOf: null, source: "health_check_results, job_heartbeats", emptyText: "Health has not been recorded yet.", data: {} };
    const counts = Object.fromEntries(health.map((h) => [h.status, h._count._all]));
    const last = health.reduce<Date | null>((m, h) => (h._max.checkedAt && (!m || h._max.checkedAt > m) ? h._max.checkedAt : m), null);
    const jobs = beats.map((b) => ({ key: b.key, label: HEARTBEATS.find((h) => h.key === b.key)?.label ?? "Dashboard reports", lastFinishedAt: iso(b.lastFinishedAt), lastStatus: b.lastStatus }));
    return { state: "ok", sourceAsOf: iso(last), source: "health_check_results, job_heartbeats", data: { checks: counts, jobs }, csv: { header: ["job", "last_finished_at", "last_status"], rows: jobs.map((j) => [j.label, j.lastFinishedAt, j.lastStatus]) } };
  },
};

const TITLES: Record<WidgetKey, [string, string]> = {
  attention_approvals: ["Approvals waiting", "/approvals"],
  attention_posts: ["Failed or uncertain posts", "/social/failures"],
  attention_sla: ["Inbox replies overdue", "/social/inbox"],
  attention_health: ["Red health checks", "/system-health"],
  attention_accounts: ["Social accounts needing action", "/social/accounts"],
  website: ["Website", "/analytics"],
  crm: ["CRM", "/crm"],
  social_accounts: ["Social accounts", "/social/accounts"],
  social_analytics: ["Social performance", "/social/analytics"],
  landing: ["Landing pages", "/marketing/landing-pages"],
  funnel: ["Marketing funnel", "/marketing/landing-pages"],
  operations: ["Operations", "/system-health"],
};

/** Landing views → submits → CRM leads → qualified → converted, by UTM source. Own tables only; stages the caller may not read are omitted. */
export async function funnelFor(user: SanitizedUser, org: string, p: ReturnType<typeof resolvePeriod>) {
  const canLeads = has(user, "leads.read");
  const [viewRows, subRows, leadRows, earliest] = await Promise.all([
    prisma.$queryRaw<Array<{ src: string | null; n: bigint }>>`SELECT src, COUNT(*) AS n FROM (SELECT DISTINCT ON (session_id) utm_source AS src FROM analytics_events WHERE organization_id = ${org} AND event_type = 'page_view' AND path LIKE '/lp/%' AND created_at >= ${p.start} AND created_at < ${p.end} AND session_id IS NOT NULL ORDER BY session_id, created_at) t GROUP BY 1`,
    prisma.$queryRaw<Array<{ src: string | null; n: bigint }>>`SELECT s.utm_source AS src, COUNT(*) AS n FROM form_submissions s JOIN forms f ON f.id = s.form_id WHERE s.organization_id = ${org} AND f.landing_page_id IS NOT NULL AND s.created_at >= ${p.start} AND s.created_at < ${p.end} GROUP BY 1`,
    canLeads
      ? prisma.$queryRaw<Array<{ src: string | null; status: string; n: bigint }>>`SELECT utm_source AS src, status::text AS status, COUNT(*) AS n FROM leads WHERE organization_id = ${org} AND deleted_at IS NULL AND source LIKE 'landing:%' AND created_at >= ${p.start} AND created_at < ${p.end} GROUP BY 1, 2`
      : Promise.resolve(null),
    prisma.analyticsEvent.aggregate({ where: { organizationId: org, eventType: "page_view", path: { startsWith: "/lp/" } }, _max: { createdAt: true } }),
  ]);
  const NONE = "(direct / none)";
  const row = (k: string) => ({ source: k, sessions: 0, submissions: 0, leads: 0, qualified: 0, converted: 0 });
  const by = new Map<string, ReturnType<typeof row>>();
  const get = (src: string | null) => { const k = src && src.trim() ? src.trim().toLowerCase() : NONE; return by.get(k) ?? by.set(k, row(k)).get(k)!; };
  for (const r of viewRows) get(r.src).sessions += num(r.n);
  for (const r of subRows) get(r.src).submissions += num(r.n);
  for (const r of leadRows ?? []) {
    const t = get(r.src); const n = num(r.n);
    t.leads += n;
    if (r.status === "QUALIFIED") t.qualified += n;
    if (r.status === "CONVERTED") t.converted += n;
  }
  const rows = [...by.values()].sort((a, b) => b.sessions + b.submissions + b.leads - (a.sessions + a.submissions + a.leads));
  const sum = (f: (r: ReturnType<typeof row>) => number) => rows.reduce((n, r) => n + f(r), 0);
  const totals = { sessions: sum((r) => r.sessions), submissions: sum((r) => r.submissions), leads: sum((r) => r.leads), qualified: sum((r) => r.qualified), converted: sum((r) => r.converted) };
  const source = "analytics_events, form_submissions, leads (own tables)";
  const stages = canLeads ? ["sessions", "submissions", "leads", "qualified", "converted"] : ["sessions", "submissions"];
  if (rows.length === 0) return { state: "empty" as const, sourceAsOf: iso(earliest._max.createdAt), source, data: { stages }, csv: undefined };
  const header = ["source", ...stages];
  return {
    state: "ok" as const, sourceAsOf: iso(earliest._max.createdAt), source,
    data: {
      stages, totals: canLeads ? totals : { sessions: totals.sessions, submissions: totals.submissions }, rows: rows.map((r) => (canLeads ? r : { source: r.source, sessions: r.sessions, submissions: r.submissions })),
      note: "Counts, not rates: a session is attributed to the source of its first landing view; each stage is counted on its own table, so a later stage can exceed an earlier one (ad blockers hide views; leads can also come from other sources). Qualified and converted are the lead's CURRENT status for leads created in this period.",
    },
    csv: { header, rows: [...rows.map((r) => [r.source, ...stages.map((st) => (r as unknown as Record<string, number>)[st]!)]), ["TOTAL", ...stages.map((st) => (totals as Record<string, number>)[st]!)]] as Array<Array<string | number | null>> },
  };
}

export const dashboardService = {
  /** Compute the widgets (optionally only some) the caller may read. Forbidden widgets are not computed. */
  async compute(user: SanitizedUser, days: number, only?: readonly WidgetKey[], now = new Date()) {
    const p = resolvePeriod(days, now);
    const ctx: Ctx = { user, org: user.organizationId, now, p };
    const keys = only ?? WIDGET_KEYS;
    const widgets = await Promise.all(
      keys.map(async (key): Promise<Widget> => {
        const [title, link] = TITLES[key];
        if (!canRead(user, WIDGET_PERMISSION[key])) return forbidden(key, title, link, now);
        const w = await builders[key](ctx);
        return { key, title, link, asOf: now.toISOString(), ...w };
      }),
    );
    return { period: p.info, asOf: now.toISOString(), widgets };
  },
};
