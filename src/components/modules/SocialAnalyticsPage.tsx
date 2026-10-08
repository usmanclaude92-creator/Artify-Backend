/**
 * Social Media → Analytics. Numbers come only from stored snapshots of what the networks reported (docs/SOCIAL_ANALYTICS.md).
 * A value the network did not provide is "—" with its reason; period comparisons appear only when both periods are fully covered; nothing is estimated.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Download, RefreshCw, Sparkles, ExternalLink } from "lucide-react";
import {
  socialAnalyticsApi, type AnalyticsAccountDetail, type AnalyticsAiSummary, type AnalyticsBestTimes, type AnalyticsPostDetail, type AnalyticsRange, type AnalyticsSummary, type AnalyticsTopPosts,
} from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import { hasPermission } from "../../lib/permissions";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Modal, Select } from "../ui/ui";
import { timeAgo } from "./socialShared";
import { KpiCard, NotAvailable, RangePicker, TrendChart, defaultRange, fmtDay, fmtNumber, providerLabel } from "./socialAnalyticsShared";

const POST_COLUMNS: Array<[string, string]> = [["interactions", "Interactions"], ["reach", "Reach"], ["views", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["shares", "Shares"], ["saves", "Saves"]];
const WEEKDAYS: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export const SocialAnalyticsPage: React.FC = () => {
  const { user } = useAuth();
  const { current } = useActiveWorkspace();
  const { notify } = useToast();
  const { navigate } = useRouter();
  const canManage = hasPermission(user?.role.permissions, "social.accounts.manage");
  const canCompose = hasPermission(user?.role.permissions, "social.publish");
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } }, []);

  const [range, setRange] = useState<AnalyticsRange>(defaultRange());
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [detail, setDetail] = useState<AnalyticsAccountDetail | null>(null);
  const [posts, setPosts] = useState<AnalyticsTopPosts | null>(null);
  const [best, setBest] = useState<AnalyticsBestTimes | null>(null);
  const [bestMetric, setBestMetric] = useState("interactions");
  const [sort, setSort] = useState("interactions");
  const [metric, setMetric] = useState("reach");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<AnalyticsPostDetail | null>(null);
  const [ai, setAi] = useState<AnalyticsAiSummary | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSummary(null); setError(null);
    socialAnalyticsApi.summary().then((s) => {
      if (cancelled) return;
      setSummary(s);
      setAccountId((id) => (id && s.accounts.some((a) => a.id === id) ? id : (s.accounts.find((a) => a.analytics === "supported") ?? s.accounts[0])?.id ?? ""));
    }).catch((e) => !cancelled && setError(errText(e, "Could not load analytics.")));
    return () => { cancelled = true; };
  }, [current?.organizationId]);

  const load = useCallback(async () => {
    if (!accountId) { setLoading(false); return; }
    setLoading(true); setError(null); setAi(null); setAiError(null);
    try {
      const d = await socialAnalyticsApi.account(accountId, range);
      setDetail(d);
      if (d.account.analytics === "supported") {
        const [p, b] = await Promise.all([socialAnalyticsApi.posts(accountId, { ...range, sort }), socialAnalyticsApi.bestTimes(accountId, { metric: bestMetric, tz })]);
        setPosts(p); setBest(b);
      } else { setPosts(null); setBest(null); }
    } catch (e) { setError(errText(e, "Could not load analytics.")); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, range.from, range.to, sort, bestMetric, tz]);
  useEffect(() => { void load(); }, [load]);

  const account = detail?.account;
  const kpis = detail?.kpis ?? [];
  const selected = kpis.find((k) => k.metric === metric) ?? kpis[0];
  const slug = (account?.displayName ?? "account").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "account";

  const exportCsv = async (kind: "account" | "posts") => {
    try { await socialAnalyticsApi.downloadCsv(accountId, kind, range, `social-${kind}_${slug}_${range.from}_${range.to}.csv`); }
    catch (e) { notify(errText(e, "Export failed."), "error"); }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await socialAnalyticsApi.refresh(accountId);
      notify(r.outcome === "skipped" ? `Not refreshed: ${r.reason === "no_analytics" ? "this network provides no analytics" : (r.reason ?? "skipped").replace(/_/g, " ")}.` : r.outcome === "error" ? "The refresh hit a problem; see the message on this page." : "Analytics refreshed.", r.outcome === "error" ? "error" : "success");
      await load();
    } catch (e) { notify(errText(e, "Refresh failed."), "error"); }
    finally { setRefreshing(false); }
  };
  const summarise = async () => {
    setAiBusy(true); setAiError(null);
    try { setAi(await socialAnalyticsApi.aiSummary(accountId, range)); }
    catch (e) { setAi(null); setAiError(errText(e, "The summary could not be created.")); }
    finally { setAiBusy(false); }
  };
  const openPost = async (targetId: string) => { try { setDrill(await socialAnalyticsApi.post(targetId)); } catch (e) { notify(errText(e, "Could not open the post."), "error"); } };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><BarChart3 className="w-5 h-5" style={{ color: "var(--accent)" }} aria-hidden="true" /> Social Analytics</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>What the networks report for your connected accounts. Numbers are snapshots taken by a daily job; anything a network does not provide shows as “—”, never as 0.</p>
        </div>
      </div>

      {error && !summary ? <ErrorState message={error} /> : summary === null ? <LoadingState /> : summary.accounts.length === 0 ? (
        <Card><EmptyState title="No social accounts connected" description="Connect Facebook or Instagram under Connected Accounts. Analytics starts with the first daily snapshot after the Insights permission is granted." /></Card>
      ) : (
        <>
          <Card className="p-4 flex flex-wrap items-end gap-3">
            <label className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
              Account
              <Select aria-label="Account" value={accountId} onChange={(e) => { setAccountId(e.target.value); setPosts(null); setBest(null); }}>
                {summary.accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName} · {providerLabel(a.provider)}</option>)}
              </Select>
            </label>
            <RangePicker value={range} onChange={setRange} />
            <div className="flex gap-2 flex-wrap ml-auto">
              {canManage && account?.analytics === "supported" && <Button variant="secondary" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> {refreshing ? "Refreshing…" : "Refresh now"}</Button>}
              {account?.analytics === "supported" && <Button variant="secondary" onClick={() => void exportCsv("account")}><Download className="w-3.5 h-3.5" aria-hidden="true" /> Daily metrics CSV</Button>}
              {account?.analytics === "supported" && <Button variant="secondary" onClick={() => void exportCsv("posts")}><Download className="w-3.5 h-3.5" aria-hidden="true" /> Posts CSV</Button>}
            </div>
          </Card>

          {error ? <ErrorState message={error} /> : loading || !detail || !account ? <LoadingState /> : account.analytics === "unsupported" ? (
            <NotAvailable title="No analytics for this network" reason={account.unsupportedReason ?? "This network provides no analytics to this app."} />
          ) : (
            <>
              <Card className="p-3 text-xs space-y-1" aria-label="Data coverage" style={{ color: "var(--text-secondary)" }}>
                <p>
                  {account.sync.lastSuccessAt ? <>Last updated <strong>{timeAgo(account.sync.lastSuccessAt)}</strong>.</> : <>No snapshot yet: the first one is taken by the daily job (within about 5 minutes of connecting with the Insights permission){canManage ? ", or press Refresh now" : ""}.</>}
                  {detail.coverage.firstDataDate && <> Daily data is available from <strong>{fmtDay(detail.coverage.firstDataDate)}</strong>.</>}
                </p>
                {account.historyDays && <p>{providerLabel(account.provider)} lets this app read back at most <strong>{account.sync.historyLimitDays ?? account.historyDays} days</strong> of daily history, so earlier days cannot be filled in. Follower totals start on the day of the first snapshot.</p>}
                {account.sync.lastError && <p role="alert" style={{ color: "var(--danger)" }}>{account.sync.lastError}</p>}
              </Card>

              <section aria-label="Key numbers" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {kpis.map((k) => <KpiCard key={k.metric} kpi={k} selected={selected?.metric === k.metric} onSelect={() => setMetric(k.metric)} />)}
              </section>

              {selected && (
                <Card className="p-4" aria-label={`${selected.label} trend`}>
                  <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{selected.label} · {fmtDay(detail.range.from)} – {fmtDay(detail.range.to)}</h2>
                  <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>{selected.description}</p>
                  <TrendChart series={selected.series} label={selected.label} emptyReason={selected.unavailableReason ?? undefined} />
                </Card>
              )}

              <div className="grid lg:grid-cols-2 gap-4">
                <Card className="p-4 space-y-3" aria-label="Best posting times">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Best posting times</h2>
                    <Select aria-label="Rank by" value={bestMetric} onChange={(e) => setBestMetric(e.target.value)}>
                      <option value="interactions">Interactions</option><option value="reach">Reach</option><option value="views">Views</option>
                    </Select>
                  </div>
                  {best && (best.enough ? (
                    <>
                      <ol className="space-y-1.5">
                        {best.slots.slice(0, 5).map((s) => (
                          <li key={`${s.weekday}-${s.hour}`} className="flex items-baseline justify-between text-xs gap-3">
                            <span className="font-bold" style={{ color: "var(--text-primary)" }}>{WEEKDAYS[s.weekday] ?? s.weekday} {String(s.hour).padStart(2, "0")}:00</span>
                            <span style={{ color: "var(--text-secondary)" }}>average {fmtNumber(s.average)} · {s.posts} posts</span>
                          </li>
                        ))}
                      </ol>
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{best.note} Times are in {best.timeZone}.</p>
                    </>
                  ) : <NotAvailable reason={best.reason ?? "Not enough data yet."} />)}
                </Card>

                {aiSection(summary.aiAvailable)}
              </div>

              <Card aria-label="Top posts">
                <div className="px-4 py-3 border-b flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: "var(--border)" }}>
                  <div>
                    <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Posts published in this period</h2>
                    {posts && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{posts.total} published through this platform · {posts.withMetrics} with numbers so far. Posts made outside Control Center are not included.</p>}
                  </div>
                  <Select aria-label="Sort posts by" value={sort} onChange={(e) => setSort(e.target.value)}>
                    {POST_COLUMNS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="published">Newest</option>
                  </Select>
                </div>
                {!posts || posts.rows.length === 0 ? <div className="p-4"><NotAvailable title="No posts" reason="No posts were published to this account through Control Center in this period." /></div> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-left" style={{ color: "var(--text-muted)" }}><th className="px-4 py-2 font-bold">Post</th>{POST_COLUMNS.map(([k, l]) => <th key={k} className="px-2 py-2 font-bold text-right">{l}</th>)}</tr></thead>
                      <tbody>
                        {posts.rows.map((p) => (
                          <tr key={p.targetId} className="border-t" style={{ borderColor: "var(--border)" }}>
                            <td className="px-4 py-2 max-w-[18rem]">
                              <button type="button" className="text-left font-semibold underline-offset-2 hover:underline truncate block max-w-full" style={{ color: "var(--text-primary)" }} onClick={() => void openPost(p.targetId)}>{p.title}</button>
                              <span style={{ color: "var(--text-muted)" }}>{p.publishedAt ? new Date(p.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""}{!p.capturedOn && " · no numbers yet"}</span>
                            </td>
                            {POST_COLUMNS.map(([k]) => <td key={k} className="px-2 py-2 text-right tabular-nums" title={p.metrics[k]?.value === null ? (p.metrics[k]?.note ?? "Not provided") : undefined} style={{ color: p.metrics[k]?.value === null ? "var(--text-muted)" : "var(--text-primary)" }}>{fmtNumber(p.metrics[k]?.value)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}
        </>
      )}

      <Modal open={!!drill} onClose={() => setDrill(null)} title={drill?.title ?? "Post"}>
        {drill && (
          <div className="space-y-3 text-xs" style={{ color: "var(--text-secondary)" }}>
            <p>{drill.account.displayName} · published {drill.publishedAt ? new Date(drill.publishedAt).toLocaleString("en-GB") : "—"}</p>
            <p className="whitespace-pre-wrap">{drill.body.slice(0, 400)}</p>
            <div className="flex gap-2 flex-wrap">
              {canCompose && <Button variant="secondary" onClick={() => navigate(`/social/compose?post=${drill.composerPostId}`)}>Open in Composer</Button>}
              {drill.externalUrl && <a href={drill.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline" style={{ color: "var(--accent)" }}>View on {providerLabel(drill.account.provider)} <ExternalLink className="w-3 h-3" aria-hidden="true" /></a>}
            </div>
            {drill.history.length === 0 ? <NotAvailable reason="No snapshot has been captured for this post yet. The daily job captures one per day for 30 days after publishing, then weekly." /> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">Snapshots of this post's numbers over time</caption>
                  <thead><tr className="text-left" style={{ color: "var(--text-muted)" }}><th className="py-1 pr-2 font-bold">Captured</th>{POST_COLUMNS.map(([k, l]) => <th key={k} className="px-1 py-1 font-bold text-right">{l}</th>)}</tr></thead>
                  <tbody>{drill.history.map((h) => (
                    <tr key={h.capturedOn} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="py-1 pr-2">{fmtDay(h.capturedOn)}</td>
                      {POST_COLUMNS.map(([k]) => <td key={k} className="px-1 py-1 text-right tabular-nums" title={h.metrics[k]?.value === null || h.metrics[k] === undefined ? (h.metrics[k]?.note ?? "Not provided") : undefined}>{fmtNumber(h.metrics[k]?.value)}</td>)}
                    </tr>))}</tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );

  function aiSection(available: boolean) {
    if (!available) return null; // no AI provider configured: hidden
    return (
      <Card className="p-4 space-y-3" aria-label="What worked this period">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-bold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}><Sparkles className="w-4 h-4" aria-hidden="true" style={{ color: "var(--accent)" }} /> What worked this period</h2>
          <Button variant="secondary" onClick={() => void summarise()} disabled={aiBusy}>{aiBusy ? "Writing…" : ai ? "Write again" : "Summarise with AI"}</Button>
        </div>
        {aiError && <p role="alert" className="text-xs" style={{ color: "var(--danger)" }}>{aiError}</p>}
        {ai ? (
          <div className="space-y-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <Badge tone="info">AI-generated</Badge>
            <p className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{ai.headline}</p>
            <ul className="list-disc pl-4 space-y-1">{ai.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Written by AI from the numbers stored for {fmtDay(ai.range.from)} – {fmtDay(ai.range.to)} only; every figure was checked against them. Review before sharing.</p>
          </div>
        ) : <p className="text-xs" style={{ color: "var(--text-muted)" }}>Optional. The AI receives only the numbers shown on this page and cannot add figures of its own.</p>}
      </Card>
    );
  }
};
