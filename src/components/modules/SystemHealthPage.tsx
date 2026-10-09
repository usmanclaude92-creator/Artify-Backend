/** Administration → System Health (Step 13): live checks with status, plain reason and last-checked time; env checklist shows present/missing only. */
import React, { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { opsApi, type HealthCheckView, type HealthReport, type HealthStatus } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Badge, LoadingState, ErrorState } from "../ui/ui";

const TONE: Record<HealthStatus, "success" | "warning" | "danger" | "info" | "neutral"> = { ok: "success", warn: "warning", red: "danger", unknown: "neutral", disabled: "neutral" };
const LABEL: Record<HealthStatus, string> = { ok: "OK", warn: "Warning", red: "Red", unknown: "Unknown", disabled: "Off" };
const GROUPS = ["Platform", "Scheduler", "Connectors", "Queues", "Storage", "Logs", "Configuration"];

export function timeAgoShort(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

export const SystemHealthPage: React.FC = () => {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    opsApi.health().then((r) => { setReport(r); setError(null); }).catch((e) => setError(e instanceof ApiClientError ? e.message : "Could not load system health.")).finally(() => setBusy(false));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  if (error && !report) return <ErrorState message={error} />;
  if (!report) return <LoadingState />;
  const byGroup = (g: string) => report.checks.filter((c) => c.group === g);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><Activity className="w-5 h-5" /> System health</h1>
          <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>Every check shows when it ran and why it has its status. A signal the app cannot measure is shown as Unknown, never as a green. Checks that stay red for 15 minutes raise one grouped alert in the notification bell.</p>
        </div>
        <Button onClick={load} disabled={busy}><RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3" role="list" aria-label="Summary">
        {(["red", "warn", "ok", "unknown", "disabled"] as HealthStatus[]).map((s) => (
          <Card key={s} className="p-3" role="listitem"><p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{LABEL[s]}</p><p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{report.summary[s]}</p></Card>
        ))}
      </div>
      {error && <p className="text-xs text-rose-500" role="alert">Last refresh failed: {error}</p>}
      {GROUPS.filter((g) => g !== "Configuration").map((g) => byGroup(g).length > 0 && (
        <Card key={g} className="overflow-hidden">
          <h3 className="px-4 py-2 text-xs font-bold uppercase tracking-wide border-b" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>{g}</h3>
          <ul>
            {byGroup(g).map((c: HealthCheckView) => (
              <li key={c.key} className="px-4 py-3 border-b last:border-b-0 flex flex-wrap items-start gap-3" style={{ borderColor: "var(--border)" }}>
                <Badge tone={TONE[c.status]}>{LABEL[c.status]}</Badge>
                <div className="flex-1 min-w-[14rem]">
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{c.label}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{c.reason}</p>
                </div>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }} title={new Date(c.checkedAt).toLocaleString()}>checked {timeAgoShort(c.checkedAt)}{c.redSince ? ` · red since ${timeAgoShort(c.redSince)}` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <Card className="overflow-hidden">
        <h3 className="px-4 py-2 text-xs font-bold uppercase tracking-wide border-b" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>Configuration checklist (names only, values are never shown)</h3>
        <table className="w-full text-xs">
          <thead><tr style={{ color: "var(--text-muted)" }}><th className="text-left px-4 py-2">Variable</th><th className="text-left px-2">Purpose</th><th className="text-left px-2">Needed</th><th className="text-left px-2">State</th></tr></thead>
          <tbody>
            {report.env.map((e) => (
              <tr key={e.name} className="border-t" style={{ borderColor: "var(--border)" }}>
                <td className="px-4 py-2 font-mono" style={{ color: "var(--text-primary)" }}>{e.name}</td>
                <td className="px-2" style={{ color: "var(--text-secondary)" }}>{e.purpose}</td>
                <td className="px-2">{e.required ? "Required" : "Optional"}</td>
                <td className="px-2"><Badge tone={e.present ? "success" : e.required ? "danger" : "neutral"}>{e.present ? "Present" : "Missing"}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};
