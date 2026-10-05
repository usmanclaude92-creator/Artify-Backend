/** Phase 5 §21 — CRM dashboard, real counts only via /crm/summary. Cards degrade when a metric's permission is missing. */
import React, { useEffect, useState } from "react";
import { TrendingUp, Briefcase, Building2, Target, ClipboardCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { crmApi, type CrmSummary } from "../../lib/api";
import { Card, Badge, LoadingState, ErrorState } from "../ui/ui";
import { STAGE_LABEL, STAGE_TONE, formatMoney } from "./OpportunitiesPage";

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

export const CrmDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<CrmSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await crmApi.summary();
        if (!cancelled) setSummary(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load CRM dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingState label="Loading CRM dashboard…" />;
  if (error) return <ErrorState message={error} />;

  const leads = summary?.leads;
  const clients = summary?.clients;
  const opportunities = summary?.opportunities;
  const onboarding = summary?.onboarding;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <TrendingUp className="w-5 h-5" /> CRM Dashboard
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {user?.role.name} · leads, clients, and pipeline for your organization
        </p>
      </div>

      {leads && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
            Leads
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={Briefcase} label="Total" value={leads.total} />
            <StatCard icon={Briefcase} label="New" value={leads.new} />
            <StatCard icon={Briefcase} label="Qualified" value={leads.qualified} />
            <StatCard icon={Briefcase} label="Converted" value={leads.converted} />
            <StatCard icon={Briefcase} label="Lost" value={leads.lost} />
          </div>
        </div>
      )}

      {opportunities && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
            Pipeline
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={Target} label="Open deals" value={opportunities.openCount} />
            {/* OMR: the platform's single global currency (server/utils/money.ts DEFAULT_CURRENCY) — no multi-currency arithmetic is performed anywhere in this codebase. */}
            <StatCard icon={Target} label="Open pipeline value" value={formatMoney(opportunities.openValue, "OMR")} />
            <StatCard icon={Target} label="Won" value={opportunities.byStage.CLOSED_WON?.count ?? 0} />
            <StatCard icon={Target} label="Lost" value={opportunities.byStage.CLOSED_LOST?.count ?? 0} />
          </div>
        </div>
      )}

      {clients && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
            Clients
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={Building2} label="Total" value={clients.total} />
            <StatCard icon={Building2} label="Prospect" value={clients.prospect} />
            <StatCard icon={Building2} label="Active" value={clients.active} />
            <StatCard icon={Building2} label="Inactive" value={clients.inactive} />
            <StatCard icon={Building2} label="Archived" value={clients.archived} />
          </div>
        </div>
      )}

      {onboarding && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
            Onboarding
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={ClipboardCheck} label="Active" value={onboarding.active} />
            <StatCard icon={ClipboardCheck} label="In progress" value={onboarding.inProgress} />
            <StatCard icon={ClipboardCheck} label="Overdue" value={onboarding.overdue} />
            <StatCard icon={ClipboardCheck} label="My pending actions" value={onboarding.pendingForCaller} />
            <StatCard icon={ClipboardCheck} label="Documents awaiting" value={onboarding.documentsAwaiting} />
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        {leads && (
          <Card>
            <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                Recent leads
              </h2>
            </div>
            {leads.recent.length === 0 ? (
              <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
                No leads yet.
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {leads.recent.map((l) => (
                  <li key={l.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                    <span style={{ color: "var(--text-primary)" }} className="font-semibold">
                      {l.companyName}
                    </span>
                    <Badge tone={l.status === "CONVERTED" ? "success" : l.status === "LOST" ? "danger" : "info"}>{l.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {clients && (
          <Card>
            <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                Recent clients
              </h2>
            </div>
            {clients.recent.length === 0 ? (
              <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
                No clients yet.
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {clients.recent.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                    <span style={{ color: "var(--text-primary)" }} className="font-semibold">
                      {c.name}
                    </span>
                    <Badge tone={c.status === "ACTIVE" ? "success" : c.status === "ARCHIVED" ? "neutral" : "info"}>{c.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {opportunities && (
          <Card>
            <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
              <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                Recent opportunities
              </h2>
            </div>
            {opportunities.recent.length === 0 ? (
              <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
                No opportunities yet.
              </p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {opportunities.recent.map((o) => (
                  <li key={o.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                    <span style={{ color: "var(--text-primary)" }} className="font-semibold truncate">
                      {o.name}
                    </span>
                    <Badge tone={STAGE_TONE[o.stage]}>{STAGE_LABEL[o.stage]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {summary?.recentActivity && (
        <Card>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Recent activity
            </h2>
          </div>
          {summary.recentActivity.length === 0 ? (
            <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
              No activity yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {summary.recentActivity.map((entry) => (
                <li key={entry.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                  <span style={{ color: "var(--text-primary)" }}>{entry.action.replace(/_/g, " ").toLowerCase()}</span>
                  <span style={{ color: "var(--text-muted)" }}>{new Date(entry.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!leads && !clients && !opportunities && !onboarding && (
        <Card className="p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            You don't have permission to view lead or client metrics.
          </p>
        </Card>
      )}
    </div>
  );
};
