/** Phase 12 — AI Control Center overview. Real data only, degrading per-permission (same convention as CrmDashboardPage) — never a fabricated metric. */
import React, { useEffect, useState } from "react";
import { Sparkles, History, ShieldAlert, Gauge } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { aiExecutionsApi, aiApprovalsApi, aiUsageApi, type AiExecution, type AiApprovalRequest, type AiUsageSummary } from "../../../lib/aiApi";
import { Card, Badge, LoadingState } from "../../ui/ui";
import { hasPermission } from "../../../lib/permissions";

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode }> = ({ icon: Icon, label, value }) => (
  <Card className="p-4 flex items-center gap-3">
    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--accent-soft)" }}>
      <Icon className="w-4.5 h-4.5" style={{ color: "var(--accent)" }} />
    </div>
    <div>
      <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  </Card>
);

export const AiOverviewPage: React.FC = () => {
  const { user } = useAuth();
  const canReadExecutions = hasPermission(user?.role.permissions, "ai.executions.read");
  const canReadApprovals = hasPermission(user?.role.permissions, "ai.approvals.read");
  const canReadUsage = hasPermission(user?.role.permissions, "ai.usage.read");

  const [recentExecutions, setRecentExecutions] = useState<AiExecution[] | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<AiApprovalRequest[] | null>(null);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [executionsRes, approvalsRes, usageRes] = await Promise.all([
        canReadExecutions ? aiExecutionsApi.list({ limit: 5 }).catch(() => null) : Promise.resolve(null),
        canReadApprovals ? aiApprovalsApi.list({ status: "PENDING", limit: 5 }).catch(() => null) : Promise.resolve(null),
        canReadUsage ? aiUsageApi.summary().catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setRecentExecutions(executionsRes?.items ?? null);
      setPendingApprovals(approvalsRes?.items ?? null);
      setUsage(usageRes?.summary ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [canReadExecutions, canReadApprovals, canReadUsage]);

  if (loading) return <LoadingState label="Loading AI Control Center…" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Sparkles className="w-5 h-5" /> AI Control Center
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Governed AI automation for this organization — every action is permission-checked, audited, and HIGH-risk actions always wait for human approval.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {canReadApprovals && <StatCard icon={ShieldAlert} label="Pending approvals" value={pendingApprovals?.length ?? "—"} />}
        {canReadExecutions && <StatCard icon={History} label="Recent executions" value={recentExecutions?.length ?? "—"} />}
        {canReadUsage && <StatCard icon={Gauge} label="Total AI requests" value={usage?.totals._count ?? "—"} />}
      </div>

      {canReadApprovals && pendingApprovals && pendingApprovals.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Waiting on you
            </h2>
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {pendingApprovals.map((approval) => (
              <li key={approval.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                <span style={{ color: "var(--text-primary)" }}>{approval.action}</span>
                <Badge tone="warning">PENDING</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canReadExecutions && recentExecutions && recentExecutions.length > 0 && (
        <Card>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              Recent activity
            </h2>
          </div>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {recentExecutions.map((exec) => (
              <li key={exec.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                <span style={{ color: "var(--text-primary)" }}>{exec.kind === "WORKFLOW" ? (exec.workflow?.name ?? "Workflow") : exec.toolCode}</span>
                <Badge tone={exec.status === "COMPLETED" ? "success" : exec.status === "FAILED" ? "danger" : "neutral"}>{exec.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};
