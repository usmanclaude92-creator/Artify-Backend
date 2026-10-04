/** Phase 14 — Marketing dashboard, real counts only via /marketing/summary. Cards degrade when a metric's permission/configuration is missing (docs/MARKETING_ARCHITECTURE.md). */
import React, { useEffect, useState } from "react";
import { Rocket, Megaphone, Briefcase, Target, FileText, ClipboardList } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { marketingApi, type MarketingSummary } from "../../lib/api";
import { Card, Badge, LoadingState, ErrorState } from "../ui/ui";

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

/** Distinguishes "no permission / not configured" (—) from a real zero, per the brief's explicit requirement. */
const statValue = (v: number | null | undefined): React.ReactNode => (v === null || v === undefined ? "—" : v);

export const MarketingDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [summary, setSummary] = useState<MarketingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await marketingApi.summary();
        if (!cancelled) setSummary(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load marketing dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <LoadingState label="Loading marketing dashboard…" />;
  if (error) return <ErrorState message={error} />;

  const campaigns = summary?.campaigns;
  const leads = summary?.leads;
  const conversions = summary?.conversions;
  const landingPages = summary?.landingPages;
  const forms = summary?.forms;
  const sources = summary?.sources;
  const utmCampaigns = summary?.utmCampaigns;
  const recentActivity = summary?.recentCampaignActivity;

  const nothingVisible = !campaigns && !leads && !conversions && !landingPages && !forms;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Rocket className="w-5 h-5" /> Marketing Dashboard
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {user?.role.name} · campaigns, attribution, and conversion for your organization
        </p>
      </div>

      {campaigns && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
            Campaigns
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard icon={Megaphone} label="Total" value={campaigns.total} />
            <StatCard icon={Megaphone} label="Active" value={campaigns.active} />
            <StatCard icon={Megaphone} label="Paused" value={campaigns.paused} />
            <StatCard icon={Megaphone} label="Draft" value={campaigns.draft} />
            <StatCard icon={Megaphone} label="Archived" value={campaigns.archived} />
          </div>
        </div>
      )}

      <div>
        <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
          Leads &amp; conversions
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard icon={Briefcase} label="Total leads" value={statValue(leads?.total)} />
          <StatCard icon={Briefcase} label="Campaign-attributed" value={statValue(leads?.attributed)} />
          <StatCard icon={Briefcase} label="Unattributed" value={statValue(leads?.unattributed)} />
          <StatCard icon={Target} label="Opportunities won" value={statValue(conversions?.opportunitiesWon)} />
          <StatCard icon={Target} label="Clients created" value={statValue(conversions?.clientsCreated)} />
        </div>
      </div>

      <div>
        <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
          Content &amp; intake
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={FileText} label="Landing pages" value={statValue(landingPages?.total)} />
          <StatCard icon={FileText} label="Published landing pages" value={statValue(landingPages?.published)} />
          <StatCard icon={ClipboardList} label="Forms" value={statValue(forms?.total)} />
          <StatCard icon={ClipboardList} label="Active forms" value={statValue(forms?.active)} />
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Sources
            </h2>
          </div>
          {!sources ? (
            <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
              You don't have permission to view lead sources.
            </p>
          ) : sources.length === 0 ? (
            <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
              No lead sources recorded yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {sources.map((s) => (
                <li key={s.source} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                  <span className="truncate" style={{ color: "var(--text-primary)" }}>
                    {s.source}
                  </span>
                  <Badge tone="info">{s.count}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              UTM campaigns
            </h2>
          </div>
          {!utmCampaigns ? (
            <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
              You don't have permission to view UTM attribution.
            </p>
          ) : utmCampaigns.length === 0 ? (
            <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
              No UTM-tagged traffic recorded yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {utmCampaigns.map((u) => (
                <li key={u.utmCampaign} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                  <span className="truncate" style={{ color: "var(--text-primary)" }}>
                    {u.utmCampaign}
                  </span>
                  <Badge tone="info">{u.count}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Recent campaign activity
            </h2>
          </div>
          {!recentActivity ? (
            <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
              You don't have permission to view campaign activity.
            </p>
          ) : recentActivity.length === 0 ? (
            <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
              No campaign activity yet.
            </p>
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {recentActivity.map((entry) => (
                <li key={entry.id} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                  <span style={{ color: "var(--text-primary)" }}>{entry.action.replace(/_/g, " ").toLowerCase()}</span>
                  <span style={{ color: "var(--text-muted)" }}>{new Date(entry.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {nothingVisible && (
        <Card className="p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            You don't have permission to view marketing metrics.
          </p>
        </Card>
      )}
    </div>
  );
};
