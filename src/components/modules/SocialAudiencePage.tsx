/**
 * Social Media → Audience: follower count over time, net change and demographics. Demographics appear only where the network returns them;
 * otherwise "not available yet" with the reason (for example Instagram's 100-follower threshold) — never an empty chart.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { socialAnalyticsApi, type AnalyticsAudience, type AnalyticsSummary } from "../../lib/api";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { Badge, Card, EmptyState, ErrorState, LoadingState, Select } from "../ui/ui";
import { NotAvailable, TrendChart, fmtDay, fmtNumber, providerLabel } from "./socialAnalyticsShared";

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export const SocialAudiencePage: React.FC = () => {
  const { current } = useActiveWorkspace();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [accountId, setAccountId] = useState("");
  const [data, setData] = useState<AnalyticsAudience | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSummary(null); setError(null);
    socialAnalyticsApi.summary().then((s) => {
      if (cancelled) return;
      setSummary(s);
      setAccountId((id) => (id && s.accounts.some((a) => a.id === id) ? id : (s.accounts.find((a) => a.analytics === "supported") ?? s.accounts[0])?.id ?? ""));
    }).catch((e) => !cancelled && setError(errText(e, "Could not load the audience.")));
    return () => { cancelled = true; };
  }, [current?.organizationId]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true); setError(null);
    try { setData(await socialAnalyticsApi.audience(accountId)); }
    catch (e) { setError(errText(e, "Could not load the audience.")); }
    finally { setLoading(false); }
  }, [accountId]);
  useEffect(() => { void load(); }, [load]);

  const f = data?.followers;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><Users className="w-5 h-5" style={{ color: "var(--accent)" }} aria-hidden="true" /> Audience</h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Followers over time and who they are, as reported by the network. Anything the network does not provide is explained, not estimated.</p>
      </div>

      {error && !summary ? <ErrorState message={error} /> : summary === null ? <LoadingState /> : summary.accounts.length === 0 ? (
        <Card><EmptyState title="No social accounts connected" description="Connect Facebook or Instagram under Connected Accounts to see audience data." /></Card>
      ) : (
        <>
          <Card className="p-4">
            <label className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
              Account
              <Select aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {summary.accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName} · {providerLabel(a.provider)}</option>)}
              </Select>
            </label>
          </Card>
          {error ? <ErrorState message={error} /> : loading || !data || !f ? <LoadingState /> : data.account.analytics === "unsupported" ? (
            <NotAvailable title="No audience data for this network" reason={data.account.unsupportedReason ?? "This network provides no audience data to this app."} />
          ) : (
            <>
              <section aria-label="Followers" className="grid sm:grid-cols-3 gap-3">
                <Card className="p-4">
                  <p className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>Followers now</p>
                  <p className="text-2xl font-bold" style={{ color: f.current ? "var(--text-primary)" : "var(--text-muted)" }}>{fmtNumber(f.current?.value)}</p>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{f.current ? `as of ${fmtDay(f.current.date)}` : "No follower total has been captured yet."}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>Net change</p>
                  <p className="text-2xl font-bold" style={{ color: f.netChange ? (f.netChange.value >= 0 ? "var(--success)" : "var(--danger)") : "var(--text-muted)" }}>{f.netChange ? `${f.netChange.value >= 0 ? "+" : "−"}${fmtNumber(Math.abs(f.netChange.value))}` : "—"}</p>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{f.netChange ? `${fmtDay(f.netChange.fromDate)} → ${fmtDay(f.netChange.toDate)}` : "Needs two daily snapshots on different days."}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>New followers reported</p>
                  <p className="text-2xl font-bold" style={{ color: f.newFollows ? "var(--text-primary)" : "var(--text-muted)" }}>{fmtNumber(f.newFollows?.total)}</p>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{f.newFollows ? `over ${f.newFollows.days} day${f.newFollows.days === 1 ? "" : "s"} with data${f.unfollows ? `; ${fmtNumber(f.unfollows.total)} unfollows` : ""}` : "Not provided for this period."}</p>
                </Card>
              </section>
              <Card className="p-4">
                <h2 className="text-sm font-bold mb-1" style={{ color: "var(--text-primary)" }}>Followers over time</h2>
                <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>{f.historyNote}</p>
                <TrendChart series={f.series} label="Followers" emptyReason="No follower total has been captured yet. The first snapshot is taken by the daily job." />
              </Card>

              <section aria-label="Demographics" className="space-y-3">
                <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Who they are</h2>
                {!data.demographicsSupported ? <NotAvailable reason={data.demographicsReason ?? "This network provides no demographics to this app."} /> : (
                  <div className="grid md:grid-cols-2 gap-3">
                    {data.demographics.map((d) => (
                      <Card key={d.dimension} className="p-4 space-y-2" aria-label={d.label}>
                        <div className="flex items-center justify-between gap-2"><h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>{d.label}</h3>{d.capturedOn && d.status === "OK" && <Badge tone="neutral">as of {fmtDay(d.capturedOn)}</Badge>}</div>
                        {d.status === "OK" && d.buckets.length > 0 ? (
                          <ul className="space-y-1.5">
                            {d.buckets.slice(0, 10).map((b) => {
                              const max = Math.max(...d.buckets.map((x) => x.value));
                              return (
                                <li key={b.key} className="text-xs">
                                  <div className="flex justify-between gap-2"><span>{b.key}</span><span className="tabular-nums">{fmtNumber(b.value)}</span></div>
                                  <div className="h-1.5 rounded-full" style={{ background: "var(--bg-hover)" }} aria-hidden="true"><div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, (b.value / max) * 100)}%`, background: "var(--accent)" }} /></div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : <NotAvailable reason={d.reason ?? "No data has been returned yet."} />}
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
};
