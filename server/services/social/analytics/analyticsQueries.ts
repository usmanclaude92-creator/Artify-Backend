/**
 * Read side of social analytics. Everything is workspace-scoped and built ONLY from stored snapshots:
 *  - a metric with no stored number is `null` (rendered "—" or "not available yet" with its reason), never 0;
 *  - period totals are shown only for days that have data, with the coverage ("12 of 28 days"), and a comparison with the previous period is
 *    shown only when BOTH periods are fully covered — otherwise the reason is returned instead of a misleading percentage;
 *  - nothing here is estimated or interpolated. Best posting times are averages of our own stored post numbers, with the sample size.
 */
import { prisma } from "../../../db/prisma";
import { NotFoundError, ValidationError } from "../../../core/errors";
import { connectorRegistry } from "../connectors/registry";
import { addDays, dayString, parseDay, startOfUtcDay } from "../connectors/metaInsights";
import type { AudienceDimension } from "../connectors/types";
import { ACCOUNT_METRICS, ACCOUNT_METRIC_KEYS, NO_ANALYTICS_REASON, POST_METRIC_KEYS, type MetricDef } from "./metrics";
import type { Capabilities } from "./analyticsIngest";

const MAX_RANGE_DAYS = 366;
const BEST_TIMES_MIN_POSTS = 10;
const BEST_TIMES_MIN_PER_SLOT = 2;

export interface DateRange { from: string; to: string }
export interface ResolvedRange { range: DateRange; previous: DateRange; days: number }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000) + 1;

/** Default: the last 28 COMPLETED days (ending yesterday, UTC). The previous period is the equal-length range right before it. */
export function resolveRange(from?: string, to?: string, now = new Date()): ResolvedRange {
  const today = startOfUtcDay(now);
  const end = to ?? dayString(addDays(today, -1));
  const start = from ?? dayString(addDays(parseDay(end), -27));
  if (!DAY_RE.test(start) || !DAY_RE.test(end) || Number.isNaN(parseDay(start).getTime()) || Number.isNaN(parseDay(end).getTime())) throw new ValidationError("Dates must look like 2026-10-31.");
  if (start > end) throw new ValidationError("The start date must not be after the end date.");
  if (end > dayString(today)) throw new ValidationError("The end date cannot be in the future.");
  const days = daysBetween(start, end);
  if (days > MAX_RANGE_DAYS) throw new ValidationError(`Choose a period of at most ${MAX_RANGE_DAYS} days.`);
  const prevTo = dayString(addDays(parseDay(start), -1));
  const prevFrom = dayString(addDays(parseDay(prevTo), -(days - 1)));
  return { range: { from: start, to: end }, previous: { from: prevFrom, to: prevTo }, days };
}

const eachDay = (r: DateRange): string[] => {
  const out: string[] = [];
  for (let d = parseDay(r.from); dayString(d) <= r.to; d = addDays(d, 1)) out.push(dayString(d));
  return out;
};

export interface Kpi {
  metric: string;
  label: string;
  kind: MetricDef["kind"];
  description: string;
  /** Sum over the days that have data (flow) or the latest known total (level). null = no data at all. */
  current: number | null;
  previous: number | null;
  daysWithData: number;
  daysInRange: number;
  previousDaysWithData: number;
  /** Percentage change vs the previous period; null unless both periods are fully covered (see compareNote). */
  changePct: number | null;
  compareNote: string | null;
  /** For followers: change between two real snapshots. */
  netChange: { value: number; fromDate: string; toDate: string } | null;
  series: Array<{ date: string; value: number | null }>;
  /** Why there is no number (permission missing, network does not provide it, nothing collected yet). */
  unavailableReason: string | null;
}

type DayValues = Map<string, number | null>;

/** Pure KPI maths (exported for tests). `values` maps UTC day → stored value (null = stored as unavailable; absent = never captured). */
export function computeKpi(def: MetricDef, values: DayValues, range: ResolvedRange, unavailableReason: string | null): Kpi {
  const days = eachDay(range.range);
  const prevDays = eachDay(range.previous);
  const base = { metric: def.key, label: def.label, kind: def.kind, description: def.description, daysInRange: days.length };
  const series = days.map((date) => ({ date, value: values.get(date) ?? null }));

  if (def.kind === "level") {
    const dated = [...values.entries()].filter(([, v]) => v !== null).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, number]>;
    const upTo = (day: string) => [...dated].reverse().find(([d]) => d <= day) ?? null;
    const cur = upTo(range.range.to);
    const prev = upTo(range.previous.to);
    const start = upTo(range.range.from) ?? dated.find(([d]) => d >= range.range.from && d <= range.range.to) ?? null;
    const netChange = cur && start && start[0] < cur[0] ? { value: cur[1] - start[1], fromDate: start[0], toDate: cur[0] } : null;
    const comparable = !!cur && !!prev && prev[1] !== 0;
    return {
      ...base, current: cur ? cur[1] : null, previous: prev ? prev[1] : null,
      daysWithData: dated.filter(([d]) => d >= range.range.from && d <= range.range.to).length, previousDaysWithData: dated.filter(([d]) => d >= range.previous.from && d <= range.previous.to).length,
      changePct: comparable ? round1(((cur![1] - prev![1]) / prev![1]) * 100) : null,
      compareNote: comparable ? null : prev ? "The previous total was 0, so a percentage is not meaningful." : "No follower total was captured before this period.",
      netChange, series: series.filter((s) => s.value !== null), unavailableReason: cur ? null : unavailableReason ?? "No follower total has been captured yet.",
    };
  }

  const sum = (ds: string[]) => { let total = 0; let n = 0; for (const d of ds) { const v = values.get(d); if (typeof v === "number") { total += v; n += 1; } } return { total: n ? total : null, n }; };
  const cur = sum(days);
  const prev = sum(prevDays);
  const full = cur.n === days.length && prev.n === prevDays.length;
  let changePct: number | null = null;
  let compareNote: string | null = null;
  if (cur.total === null) compareNote = null;
  else if (!full) compareNote = `Not compared: ${cur.n} of ${days.length} days have data this period and ${prev.n} of ${prevDays.length} in the previous period.`;
  else if (prev.total === 0) compareNote = "The previous period was 0, so a percentage is not meaningful.";
  else changePct = round1(((cur.total! - prev.total!) / prev.total!) * 100);
  return {
    ...base, current: cur.total, previous: prev.total, daysWithData: cur.n, previousDaysWithData: prev.n, changePct, compareNote, netChange: null, series,
    unavailableReason: cur.total === null ? unavailableReason ?? "No data has been collected for this period yet." : null,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function reasonFor(caps: Capabilities | null, metric: string): string | null {
  if (caps?.permission) return caps.permission.reason;
  const c = caps?.daily?.[metric];
  return c?.status === "UNAVAILABLE" ? (c.reason ?? "The network does not provide this metric.") : null;
}

async function loadAccount(organizationId: string, id: string) {
  const account = await prisma.socialAccount.findFirst({ where: { id, organizationId }, include: { analyticsState: true } });
  if (!account) throw new NotFoundError("Social account not found.");
  return account;
}

export interface AccountSyncInfo { firstSyncAt: string | null; lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null; backfillFrom: string | null; historyLimitDays: number | null }

function accountMeta(a: Awaited<ReturnType<typeof loadAccount>>) {
  const connector = connectorRegistry.get(a.provider);
  const supported = !!connector?.analytics;
  const st = a.analyticsState;
  const sync: AccountSyncInfo = {
    firstSyncAt: st?.firstSyncAt?.toISOString() ?? null, lastRunAt: st?.lastRunAt?.toISOString() ?? null, lastSuccessAt: st?.lastSuccessAt?.toISOString() ?? null,
    lastError: st?.lastError ?? null, backfillFrom: st?.backfillFrom ? dayString(st.backfillFrom) : null, historyLimitDays: st?.historyLimitDays ?? connector?.analytics?.historyDays ?? null,
  };
  return {
    id: a.id, provider: a.provider, displayName: a.displayName, handle: a.handle, avatarUrl: a.avatarUrl, accountType: a.accountType, status: a.status,
    analytics: supported ? ("supported" as const) : ("unsupported" as const),
    unsupportedReason: supported ? null : (NO_ANALYTICS_REASON[a.provider] ?? "This network provides no analytics to this app."),
    historyDays: connector?.analytics?.historyDays ?? null,
    sync,
    capabilities: ((st?.capabilities ?? null) as Capabilities | null),
  };
}

async function dayValues(socialAccountId: string, metrics: string[], from: string, to: string): Promise<Map<string, DayValues>> {
  const rows = await prisma.socialAccountMetric.findMany({ where: { socialAccountId, metric: { in: metrics }, metricDate: { gte: parseDay(from), lte: parseDay(to) } }, select: { metric: true, metricDate: true, value: true } });
  const out = new Map<string, DayValues>();
  for (const m of metrics) out.set(m, new Map());
  for (const r of rows) out.get(r.metric)!.set(dayString(r.metricDate), r.value);
  return out;
}

export const HEADLINE_METRICS = ["followers", "reach", "views", "engagement"] as const;

export const analyticsQueries = {
  resolveRange,

  /** One entry per connected account with its headline KPIs (Social Overview + the account picker). */
  async summary(organizationId: string, q: { from?: string; to?: string }, now = new Date()) {
    const r = resolveRange(q.from, q.to, now);
    const accounts = await prisma.socialAccount.findMany({ where: { organizationId }, include: { analyticsState: true }, orderBy: { createdAt: "asc" }, take: 100 });
    const out = [];
    for (const a of accounts) {
      const meta = accountMeta(a as Awaited<ReturnType<typeof loadAccount>>);
      let headline: Kpi[] = [];
      if (meta.analytics === "supported") {
        const values = await dayValues(a.id, [...HEADLINE_METRICS], r.previous.from, r.range.to);
        headline = HEADLINE_METRICS.map((m) => computeKpi(ACCOUNT_METRICS.find((d) => d.key === m)!, values.get(m)!, r, reasonFor(meta.capabilities, m)));
      }
      out.push({ ...meta, headline: headline.map((k) => ({ ...k, series: [] })) });
    }
    return { range: r.range, previous: r.previous, days: r.days, accounts: out };
  },

  async accountDetail(organizationId: string, accountId: string, q: { from?: string; to?: string }, now = new Date()) {
    const a = await loadAccount(organizationId, accountId);
    const r = resolveRange(q.from, q.to, now);
    const meta = accountMeta(a);
    if (meta.analytics === "unsupported") return { range: r.range, previous: r.previous, days: r.days, account: meta, kpis: [] as Kpi[], coverage: { firstDataDate: null, lastDataDate: null } };
    const values = await dayValues(a.id, ACCOUNT_METRIC_KEYS, r.previous.from, r.range.to);
    const kpis = ACCOUNT_METRICS.map((d) => computeKpi(d, values.get(d.key)!, r, reasonFor(meta.capabilities, d.key)));
    const span = await prisma.socialAccountMetric.aggregate({ where: { socialAccountId: a.id, value: { not: null } }, _min: { metricDate: true }, _max: { metricDate: true } });
    return { range: r.range, previous: r.previous, days: r.days, account: meta, kpis, coverage: { firstDataDate: span._min.metricDate ? dayString(span._min.metricDate) : null, lastDataDate: span._max.metricDate ? dayString(span._max.metricDate) : null } };
  },

  async topPosts(organizationId: string, accountId: string, q: { from?: string; to?: string; sort?: string; limit?: number }, now = new Date()) {
    const a = await loadAccount(organizationId, accountId);
    const r = resolveRange(q.from, q.to, now);
    const byDate = q.sort === "published";
    const sort = POST_METRIC_KEYS.includes(q.sort ?? "") ? (q.sort as string) : "interactions";
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const targets = await prisma.socialPostTarget.findMany({
      where: { socialAccountId: a.id, status: "PUBLISHED", publishedAt: { gte: parseDay(r.range.from), lt: addDays(parseDay(r.range.to), 1) }, post: { organizationId, deletedAt: null } },
      include: { post: { select: { id: true, title: true, body: true } } }, orderBy: { publishedAt: "desc" }, take: 500,
    });
    const metrics = await prisma.socialPostMetric.findMany({ where: { targetId: { in: targets.map((t) => t.id) } }, orderBy: { capturedOn: "desc" }, select: { targetId: true, metric: true, value: true, status: true, note: true, capturedOn: true } });
    const latest = new Map<string, Map<string, { value: number | null; status: string; note: string | null; capturedOn: string }>>();
    for (const m of metrics) {
      const byMetric = latest.get(m.targetId) ?? latest.set(m.targetId, new Map()).get(m.targetId)!;
      if (!byMetric.has(m.metric)) byMetric.set(m.metric, { value: m.value, status: m.status, note: m.note, capturedOn: dayString(m.capturedOn) });
    }
    const rows = targets.map((t) => {
      const m = latest.get(t.id);
      return {
        targetId: t.id, postId: t.post.id, title: t.post.title, excerpt: t.post.body.slice(0, 140), publishedAt: t.publishedAt?.toISOString() ?? null, externalUrl: t.externalUrl,
        capturedOn: m ? [...m.values()].map((v) => v.capturedOn).sort().at(-1) ?? null : null,
        metrics: Object.fromEntries(POST_METRIC_KEYS.map((k) => [k, m?.get(k) ? { value: m.get(k)!.value, status: m.get(k)!.status, note: m.get(k)!.note } : { value: null, status: "UNAVAILABLE", note: "No snapshot has been captured yet." }])),
      };
    });
    rows.sort((x, y) => {
      if (byDate) return (y.publishedAt ?? "").localeCompare(x.publishedAt ?? "");
      const a1 = x.metrics[sort]!.value;
      const b1 = y.metrics[sort]!.value;
      if (a1 === null && b1 === null) return (y.publishedAt ?? "").localeCompare(x.publishedAt ?? "");
      if (a1 === null) return 1;
      if (b1 === null) return -1;
      return b1 - a1;
    });
    return { range: r.range, sort, total: rows.length, withMetrics: rows.filter((x) => x.capturedOn).length, rows: rows.slice(0, limit) };
  },

  async postDetail(organizationId: string, targetId: string) {
    const t = await prisma.socialPostTarget.findFirst({
      where: { id: targetId, post: { organizationId, deletedAt: null } },
      include: { post: { select: { id: true, title: true, body: true, status: true } }, account: { select: { id: true, provider: true, displayName: true } } },
    });
    if (!t) throw new NotFoundError("Post not found.");
    const rows = await prisma.socialPostMetric.findMany({ where: { targetId }, orderBy: [{ capturedOn: "asc" }], select: { capturedOn: true, metric: true, value: true, status: true, note: true } });
    const byDay = new Map<string, Record<string, { value: number | null; status: string; note: string | null }>>();
    for (const m of rows) {
      const d = dayString(m.capturedOn);
      (byDay.get(d) ?? byDay.set(d, {}).get(d)!)[m.metric] = { value: m.value, status: m.status, note: m.note };
    }
    const history = [...byDay.entries()].map(([capturedOn, metrics]) => ({ capturedOn, metrics }));
    return {
      targetId: t.id, composerPostId: t.post.id, title: t.post.title, body: t.post.body, postStatus: t.post.status, account: t.account,
      publishedAt: t.publishedAt?.toISOString() ?? null, externalUrl: t.externalUrl, history, latest: history.at(-1) ?? null,
    };
  },

  async audience(organizationId: string, accountId: string, q: { from?: string; to?: string }, now = new Date()) {
    const a = await loadAccount(organizationId, accountId);
    const meta = accountMeta(a);
    const r = resolveRange(q.from ?? dayString(addDays(startOfUtcDay(now), -90)), q.to, now);
    const connector = connectorRegistry.get(a.provider);
    const followersRows = await prisma.socialAccountMetric.findMany({ where: { socialAccountId: a.id, metric: "followers", metricDate: { gte: parseDay(r.range.from), lte: parseDay(r.range.to) } }, orderBy: { metricDate: "asc" }, select: { metricDate: true, value: true } });
    const followers = followersRows.filter((x) => x.value !== null).map((x) => ({ date: dayString(x.metricDate), value: x.value as number }));
    const first = followers[0] ?? null;
    const last = followers.at(-1) ?? null;
    const flow = await dayValues(a.id, ["follows_new", "unfollows"], r.range.from, r.range.to);
    const sumFlow = (m: string) => { let t = 0; let n = 0; for (const v of flow.get(m)!.values()) if (typeof v === "number") { t += v; n += 1; } return n ? { total: t, days: n } : null; };
    const dims = connector?.analytics?.audienceDimensions ?? [];
    const snaps = await prisma.socialAudienceSnapshot.findMany({ where: { socialAccountId: a.id }, orderBy: { capturedOn: "desc" }, take: 40 });
    const labels: Record<AudienceDimension, string> = { age_gender: "Age and gender", country: "Countries", city: "Cities", locale: "Languages" };
    const demographics = (dims as readonly AudienceDimension[]).map((d) => {
      const s = snaps.find((x) => x.dimension === d);
      return {
        dimension: d, label: labels[d], status: s ? (s.status as "OK" | "UNAVAILABLE") : ("PENDING" as const),
        reason: s ? s.reason : "Not collected yet: the first audience snapshot is taken by the daily job.", capturedOn: s ? dayString(s.capturedOn) : null,
        buckets: s?.status === "OK" ? ((s.buckets ?? []) as Array<{ key: string; value: number }>).slice(0, 25) : [],
      };
    });
    return {
      range: r.range, account: meta,
      followers: {
        series: followers, current: last, first,
        netChange: first && last && first.date < last.date ? { value: last.value - first.value, fromDate: first.date, toDate: last.date } : null,
        newFollows: sumFlow("follows_new"), unfollows: sumFlow("unfollows"),
        historyNote: first ? `Follower history starts on ${first.date}: ${a.provider === "meta_instagram" ? "Instagram does not provide earlier follower totals." : "totals are captured daily from the day the account was first synced."}` : "No follower total has been captured yet.",
      },
      demographics,
      demographicsSupported: dims.length > 0,
      demographicsReason: dims.length > 0 ? null : a.provider === "meta_facebook" ? "Facebook Page demographics are not read in this release (Meta's current metric names could not be confirmed)." : (NO_ANALYTICS_REASON[a.provider] ?? "This network provides no audience data to this app."),
    };
  },

  /** Best posting slots from OUR stored post numbers. Needs enough posts; otherwise says so instead of guessing. */
  async bestTimes(organizationId: string, accountId: string, q: { metric?: string; tz?: string }) {
    const a = await loadAccount(organizationId, accountId);
    const metric = ["reach", "views", "interactions"].includes(q.metric ?? "") ? (q.metric as string) : "interactions";
    const tz = validTimeZone(q.tz);
    const targets = await prisma.socialPostTarget.findMany({ where: { socialAccountId: a.id, status: "PUBLISHED", publishedAt: { not: null }, post: { organizationId, deletedAt: null } }, select: { id: true, publishedAt: true }, take: 1000 });
    const rows = await prisma.socialPostMetric.findMany({ where: { targetId: { in: targets.map((t) => t.id) }, metric: { in: [metric, "likes", "comments"] } }, orderBy: { capturedOn: "desc" }, select: { targetId: true, metric: true, value: true } });
    const latest = new Map<string, Map<string, number | null>>();
    for (const m of rows) { const mm = latest.get(m.targetId) ?? latest.set(m.targetId, new Map()).get(m.targetId)!; if (!mm.has(m.metric)) mm.set(m.metric, m.value); }
    const scoreOf = (id: string): number | null => {
      const mm = latest.get(id);
      if (!mm) return null;
      const direct = mm.get(metric);
      if (typeof direct === "number") return direct;
      if (metric === "interactions") { const l = mm.get("likes"); const c = mm.get("comments"); if (typeof l === "number" && typeof c === "number") return l + c; }
      return null;
    };
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" });
    const slots = new Map<string, { weekday: string; hour: number; scores: number[] }>();
    let withData = 0;
    for (const t of targets) {
      const s = scoreOf(t.id);
      if (s === null || !t.publishedAt) continue;
      withData += 1;
      const parts = fmt.formatToParts(t.publishedAt);
      const weekday = parts.find((p) => p.type === "weekday")!.value;
      const hour = Number(parts.find((p) => p.type === "hour")!.value) % 24;
      const key = `${weekday}-${hour}`;
      (slots.get(key) ?? slots.set(key, { weekday, hour, scores: [] }).get(key)!).scores.push(s);
    }
    const ranked = [...slots.values()].map((s) => ({ weekday: s.weekday, hour: s.hour, posts: s.scores.length, average: s.scores.reduce((x, y) => x + y, 0) / s.scores.length })).filter((s) => s.posts >= BEST_TIMES_MIN_PER_SLOT).sort((x, y) => y.average - x.average);
    const enough = withData >= BEST_TIMES_MIN_POSTS && ranked.length > 0;
    return {
      metric, timeZone: tz, postsWithData: withData, minPosts: BEST_TIMES_MIN_POSTS, minPerSlot: BEST_TIMES_MIN_PER_SLOT,
      enough, slots: enough ? ranked.map((s) => ({ ...s, average: round1(s.average) })) : [],
      reason: enough ? null : withData < BEST_TIMES_MIN_POSTS ? `Needs at least ${BEST_TIMES_MIN_POSTS} published posts with numbers; there ${withData === 1 ? "is" : "are"} ${withData} so far.` : `No weekday-and-hour combination has at least ${BEST_TIMES_MIN_PER_SLOT} posts yet.`,
      note: "Averages of this account's own stored post numbers (the interactions score is likes + comments when the network gives no combined figure). Small samples are shown with their post counts.",
    };
  },
};

function validTimeZone(tz?: string): string {
  if (!tz) return "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
}

// ---------------- CSV ----------------
/** Quotes a cell; values starting with = + - @ (or tab/CR) are prefixed so spreadsheets cannot run them as formulas. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: Array<Array<string | number | null | undefined>>): string => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export const analyticsExport = {
  /** `kind=account`: one row per day with a column per metric (an empty cell means "not available", never 0). `kind=posts`: one row per published post with its latest numbers. */
  async csv(organizationId: string, accountId: string, kind: "account" | "posts", q: { from?: string; to?: string }, now = new Date()): Promise<{ filename: string; body: string }> {
    const a = await loadAccount(organizationId, accountId);
    const r = resolveRange(q.from, q.to, now);
    const slug = a.displayName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "account";
    if (kind === "posts") {
      const top = await analyticsQueries.topPosts(organizationId, accountId, { from: r.range.from, to: r.range.to, sort: "published", limit: 100 }, now);
      const rows: Array<Array<string | number | null>> = [["published_at", "title", "post_url", "snapshot_date", ...POST_METRIC_KEYS]];
      for (const p of top.rows) rows.push([p.publishedAt, p.title, p.externalUrl, p.capturedOn, ...POST_METRIC_KEYS.map((k) => p.metrics[k]!.value)]);
      return { filename: `social-posts_${slug}_${r.range.from}_${r.range.to}.csv`, body: toCsv(rows) };
    }
    const values = await dayValues(a.id, ACCOUNT_METRIC_KEYS, r.range.from, r.range.to);
    const rows: Array<Array<string | number | null>> = [["date", ...ACCOUNT_METRIC_KEYS]];
    for (const d of eachDay(r.range)) rows.push([d, ...ACCOUNT_METRIC_KEYS.map((m) => values.get(m)!.get(d) ?? null)]);
    return { filename: `social-account_${slug}_${r.range.from}_${r.range.to}.csv`, body: toCsv(rows) };
  },
};
