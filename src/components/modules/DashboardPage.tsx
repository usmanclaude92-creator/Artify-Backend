/** Step 14 — role-aware Dashboard. Stored data only (docs/DASHBOARD.md): every card shows its source and an "as of" time; widgets the role cannot read are not shown. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Download, FileText, RefreshCw } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import { auditLogsApi, dashboardApi, type AuditLogEntry, type DashboardCompare, type DashboardResponse, type DashboardView, type DashboardWidget, type DashboardWidgetKey, type ReportInboxItem } from "../../lib/api";
import { Button, Card, Badge, Input, LoadingState, ErrorState, Select } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const ATTENTION: DashboardWidgetKey[] = ["attention_approvals", "attention_posts", "attention_sla", "attention_health", "attention_accounts"];
const MODULES: Array<{ id: string; title: string; keys: DashboardWidgetKey[] }> = [
  { id: "website", title: "Website", keys: ["website"] },
  { id: "crm", title: "CRM", keys: ["crm"] },
  { id: "social", title: "Social", keys: ["social_accounts", "social_analytics"] },
  { id: "marketing", title: "Marketing & landing pages", keys: ["landing", "funnel"] },
  { id: "operations", title: "Operations", keys: ["operations"] },
];

export const asOfLabel = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : "—");

const Change: React.FC<{ c: DashboardCompare }> = ({ c }) =>
  c.changePct !== null ? (
    <span className="text-[11px] ml-1" style={{ color: c.changePct >= 0 ? "var(--success, #059669)" : "var(--danger, #e11d48)" }}>{c.changePct > 0 ? "+" : ""}{c.changePct}% vs previous ({c.previous})</span>
  ) : c.note ? (
    <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>{c.note}</span>
  ) : null;

const Num: React.FC<{ label: string; c: DashboardCompare }> = ({ label, c }) => (
  <div>
    <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{c.current.toLocaleString()}<Change c={c} /></p>
    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{label}</p>
  </div>
);

const Meta: React.FC<{ w: DashboardWidget }> = ({ w }) => (
  <p className="text-[10px] mt-3" style={{ color: "var(--text-muted)" }}>
    As of {asOfLabel(w.asOf)}{w.sourceAsOf ? ` · data refreshed ${asOfLabel(w.sourceAsOf)}` : ""} · Source: {w.source}
  </p>
);

function WidgetBody({ w }: { w: DashboardWidget }) {
  const d = w.data ?? {};
  switch (w.key) {
    case "website":
      return (<div className="grid grid-cols-2 gap-3"><Num label="Page views" c={d.views} /><Num label="Sessions" c={d.sessions} />
        {d.topPages?.length > 0 && <ul className="col-span-2 text-xs space-y-0.5">{d.topPages.map((p: { path: string; views: number }) => <li key={p.path} className="flex justify-between"><span className="truncate">{p.path}</span><span>{p.views}</span></li>)}</ul>}
        <p className="col-span-2 text-[11px]" style={{ color: "var(--text-muted)" }}>{d.note}</p></div>);
    case "crm":
      return (<div className="space-y-3">
        {d.leads && <div><div className="grid grid-cols-2 gap-3"><div><p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{d.leads.total}</p><p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Leads in total</p></div><Num label="New leads in period" c={d.leads.createdInPeriod} /></div>
          <p className="text-xs mt-1">{Object.entries(d.leads.byStatus).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(" · ")}</p></div>}
        {d.pipeline && <div><p className="text-xs">Open pipeline: {d.pipeline.open.length ? d.pipeline.open.map((o: { currency: string; count: number; value: number }) => `${o.count} deals, ${o.value.toLocaleString()} ${o.currency}`).join("; ") : "none"}</p><Num label="Deals won in period" c={d.pipeline.wonInPeriod} /></div>}
      </div>);
    case "social_accounts":
      return <ul className="text-xs space-y-1">{d.accounts.map((a: { id: string; name: string; status: string }) => <li key={a.id} className="flex justify-between gap-2"><span>{a.name}</span><Badge tone={a.status === "CONNECTED" ? "success" : "warning"}>{a.status.toLowerCase().replace("_", " ")}</Badge></li>)}</ul>;
    case "social_analytics":
      return (<div className="space-y-3">{d.accounts.map((a: { id: string; name: string; headline: Array<{ metric: string; label: string; current: number | null; changePct: number | null; compareNote: string | null }> }) => (
        <div key={a.id}><p className="text-xs font-semibold">{a.name}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">{a.headline.map((k) => <p key={k.metric} className="text-xs"><span className="font-bold">{k.current === null ? "—" : k.current.toLocaleString()}</span> {k.label}{k.changePct !== null ? ` (${k.changePct > 0 ? "+" : ""}${k.changePct}%)` : ""}</p>)}</div>
          {a.headline.some((k) => k.compareNote) && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{a.headline.find((k) => k.compareNote)?.compareNote}</p>}</div>))}
        {d.topPosts?.some((t: { posts: unknown[] }) => t.posts.length > 0) && <div><p className="text-xs font-semibold">Top posts</p><ul className="text-xs">{d.topPosts.flatMap((t: { posts: Array<{ title: string; interactions: number | null }> }) => t.posts).map((p: { title: string; interactions: number | null }, i: number) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{p.title}</span><span>{p.interactions ?? "—"}</span></li>)}</ul></div>}</div>);
    case "landing":
      return (<div className="grid grid-cols-2 gap-3"><div><p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{d.publishedPages}</p><p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Published pages</p></div><Num label="Views" c={d.views} /><Num label="Form submissions" c={d.submissions} />
        <div><p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>{d.conversionRate === null ? "—" : `${d.conversionRate}%`}</p><p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Submissions per session{d.conversionRate === null ? " (no sessions yet)" : ""}</p></div>
        <p className="col-span-2 text-[11px]" style={{ color: "var(--text-muted)" }}>{d.note}</p></div>);
    case "funnel":
      return (<div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr className="text-left"><th className="pr-3">Source</th>{d.stages.map((s: string) => <th key={s} className="pr-3 capitalize">{s}</th>)}</tr></thead>
        <tbody>{d.rows.map((r: Record<string, string | number>) => <tr key={String(r.source)}><td className="pr-3">{r.source}</td>{d.stages.map((s: string) => <td key={s} className="pr-3">{r[s]}</td>)}</tr>)}
          <tr className="font-bold border-t"><td className="pr-3">Total</td>{d.stages.map((s: string) => <td key={s} className="pr-3">{d.totals[s]}</td>)}</tr></tbody></table>
        <p className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>{d.note}</p></div>);
    case "operations":
      return (<div className="space-y-2"><p className="text-xs">{Object.entries(d.checks ?? {}).map(([k, v]) => `${k} ${v}`).join(" · ") || "No health results stored."}</p>
        <ul className="text-xs space-y-0.5">{(d.jobs ?? []).map((j: { key: string; label: string; lastFinishedAt: string | null; lastStatus: string | null }) => <li key={j.key} className="flex justify-between gap-2"><span>{j.label}</span><span style={{ color: "var(--text-muted)" }}>{j.lastStatus ?? "—"} · {asOfLabel(j.lastFinishedAt)}</span></li>)}</ul></div>);
    default:
      return null;
  }
}

function AttentionLine({ w }: { w: DashboardWidget }) {
  const d = w.data ?? {};
  const detail = w.key === "attention_approvals" ? Object.entries(d.counts ?? {}).filter(([, n]) => (n as number) > 0).map(([k, n]) => `${k} ${n}`).join(", ")
    : w.key === "attention_posts" ? Object.entries(d.counts ?? {}).map(([k, n]) => `${String(k).toLowerCase()} ${n}`).join(", ")
    : w.key === "attention_health" ? (d.red ?? []).map((r: { key: string }) => r.key).join(", ")
    : w.key === "attention_accounts" ? (d.accounts ?? []).map((a: { name: string; status: string }) => `${a.name} (${a.status.toLowerCase().replace("_", " ")})`).join(", ")
    : "";
  return <span><span className="font-bold">{d.total}</span> {w.title.toLowerCase()}{detail ? ` — ${detail}` : ""}</span>;
}

const PortalWelcome: React.FC<{ name?: string }> = ({ name }) => {
  const { navigate } = useRouter();
  return (
    <Card className="p-6 space-y-3">
      <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Welcome back, {name}</h1>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>The workspace dashboard is for the Artify team. Your contracts, invoices and requests are in the Client Portal.</p>
      <Button variant="primary" onClick={() => navigate("/portal")}>Open Client Portal <ArrowRight className="w-3.5 h-3.5" /></Button>
    </Card>
  );
};

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  if (user?.role.key === "CLIENT_PORTAL") return <PortalWelcome name={user.firstName} />;
  return <InternalDashboard />;
};

const InternalDashboard: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { navigate } = useRouter();
  const canReadAudit = hasPermission(user?.role.permissions, "audit.read");
  const [period, setPeriod] = useState(28);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [views, setViews] = useState<DashboardView[]>([]);
  const [viewName, setViewName] = useState("");
  const [audit, setAudit] = useState<AuditLogEntry[]>([]);
  const [inbox, setInbox] = useState<ReportInboxItem[]>([]);

  const load = useCallback(() => {
    setBusy(true);
    dashboardApi.get(period).then((r) => { setData(r); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : "Could not load the dashboard.")).finally(() => setBusy(false));
  }, [period]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    dashboardApi.views().then((r) => setViews(r.views)).catch(() => undefined);
    dashboardApi.inbox().then((r) => setInbox(r.reports)).catch(() => undefined);
    if (canReadAudit) auditLogsApi.list({ page: 1, limit: 5 }).then((r) => setAudit(r.items)).catch(() => undefined);
  }, [canReadAudit]);

  const byKey = useMemo(() => new Map((data?.widgets ?? []).map((w) => [w.key, w])), [data]);
  if (error && !data) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading dashboard…" />;

  const attention = ATTENTION.map((k) => byKey.get(k)).filter((w): w is DashboardWidget => !!w && w.state !== "forbidden");
  const attentionItems = attention.filter((w) => w.state === "ok");
  const exportCsv = (w: DashboardWidget) => dashboardApi.exportCsv(w.key, period).catch(() => notify("Export failed.", "error"));
  const saveView = async () => {
    if (!viewName.trim()) return;
    try { const r = await dashboardApi.saveView(viewName.trim(), period); setViews((v) => [...v, r.view]); setViewName(""); notify("View saved.", "success"); } catch (e) { notify(e instanceof Error ? e.message : "Could not save the view.", "error"); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Welcome back, {user?.firstName}</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{user?.role.name} · last {data.period.days} completed days ({data.period.from} to {data.period.to}, UTC) · computed {asOfLabel(data.asOf)}. Stored data only — nothing here calls Meta or Google.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="sr-only" htmlFor="dash-period">Period</label>
          <Select id="dash-period" value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
            <option value={7}>Last 7 days</option><option value={28}>Last 28 days</option><option value={90}>Last 90 days</option>
          </Select>
          <Button onClick={load} disabled={busy} aria-label="Refresh dashboard"><RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {views.map((v) => (<span key={v.id} className="inline-flex items-center gap-1"><Button variant="secondary" onClick={() => setPeriod(v.period)}>{v.name} · {v.period}d</Button>
          <button type="button" aria-label={`Delete view ${v.name}`} className="px-1" onClick={() => dashboardApi.deleteView(v.id).then(() => setViews((x) => x.filter((y) => y.id !== v.id))).catch(() => notify("Could not delete the view.", "error"))}>×</button></span>))}
        <Input aria-label="Name for the saved view" placeholder="Save this period as…" value={viewName} onChange={(e) => setViewName(e.target.value)} className="max-w-[12rem]" />
        <Button variant="secondary" onClick={saveView} disabled={!viewName.trim()}>Save view</Button>
      </div>

      {attention.length > 0 && (
        <section aria-labelledby="attn-h">
          <Card className="p-4" style={{ borderColor: attentionItems.length ? "var(--warning, #d97706)" : undefined }}>
            <h2 id="attn-h" className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><AlertTriangle className="w-4 h-4" /> Attention needed</h2>
            {attentionItems.length === 0 ? (
              <p className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>Nothing needs attention right now. {attention.map((w) => w.emptyText).join(" ")}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">{attentionItems.map((w) => (
                <li key={w.key} className="text-xs flex items-center justify-between gap-2 flex-wrap"><AttentionLine w={w} />
                  <Button variant="secondary" onClick={() => navigate(w.link)}>Open <ArrowRight className="w-3 h-3" /></Button></li>))}</ul>
            )}
            <p className="text-[10px] mt-3" style={{ color: "var(--text-muted)" }}>As of {asOfLabel(data.asOf)}. Sources: {attention.map((w) => w.source).join("; ")}.</p>
          </Card>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {MODULES.map((m) => {
          const ws = m.keys.map((k) => byKey.get(k)).filter((w): w is DashboardWidget => !!w && w.state !== "forbidden");
          if (ws.length === 0) return null;
          return (
            <Card key={m.id} className={`p-4 ${m.id === "marketing" ? "lg:col-span-2" : ""}`} aria-label={m.title}>
              <h2 className="text-sm font-bold mb-3" style={{ color: "var(--text-primary)" }}>{m.title}</h2>
              <div className="space-y-5">
                {ws.map((w) => (
                  <div key={w.key}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      {ws.length === 1 && w.title === m.title ? <span /> : <h3 className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>{w.title}</h3>}
                      <div className="flex gap-1">
                        {w.state === "ok" && <Button variant="secondary" onClick={() => exportCsv(w)} aria-label={`Download ${w.title} as CSV`}><Download className="w-3 h-3" /> CSV</Button>}
                        <Button variant="secondary" onClick={() => navigate(w.link)} aria-label={`Open ${w.title}`}>Open <ArrowRight className="w-3 h-3" /></Button>
                      </div>
                    </div>
                    {w.state === "empty" ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>{w.emptyText}</p> : <WidgetBody w={w} />}
                    <Meta w={w} />
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      {inbox.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><FileText className="w-4 h-4" /> Reports sent to you</h2>
          <ul className="mt-2 text-xs space-y-1">{inbox.slice(0, 5).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2"><span>{r.name} · {r.periodFrom} to {r.periodTo} · {new Date(r.createdAt).toLocaleDateString()}</span>
              <Button variant="secondary" onClick={() => dashboardApi.downloadReport(r.id, r.name).catch(() => notify("Download failed.", "error"))}><Download className="w-3 h-3" /> HTML</Button></li>))}</ul>
        </Card>
      )}

      {canReadAudit && audit.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}><h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Recent activity</h2></div>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>{audit.map((e) => (
            <li key={e.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3"><span style={{ color: "var(--text-primary)" }}><span className="font-semibold">{e.actorName ?? "System"}</span> · {e.action}</span><span style={{ color: "var(--text-muted)" }}>{new Date(e.createdAt).toLocaleString()}</span></li>))}</ul>
        </Card>
      )}
    </div>
  );
};
