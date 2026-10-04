/**
 * Phase 15 — Analytics Dashboard (docs/ANALYTICS_ARCHITECTURE.md). Every
 * number here comes from /analytics/overview; a section is `null` when the
 * caller lacks the underlying permission or there's genuinely no data/
 * provider configured yet — rendered as "—"/a not-configured note, never a
 * fabricated zero or placeholder chart.
 */
import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, Globe2, Users, Briefcase, Target, Megaphone, Search, History, TrendingUp, TrendingDown, ClipboardList } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { analyticsApi, type AnalyticsOverview } from "../../lib/api";
import { Card, Badge, Select, Input, LoadingState, ErrorState } from "../ui/ui";

type RangePreset = "7d" | "30d" | "90d" | "this_month" | "custom";

function presetToRange(preset: RangePreset, customFrom: string, customTo: string): { from?: string; to?: string } {
  const now = new Date();
  if (preset === "custom") {
    return { from: customFrom || undefined, to: customTo || undefined };
  }
  if (preset === "this_month") {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: now.toISOString() };
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
}

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode; changePct?: number | null }> = ({ icon: Icon, label, value, changePct }) => (
  <Card className="p-4 flex items-center gap-3">
    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--accent-soft)" }}>
      <Icon className="w-4.5 h-4.5" style={{ color: "var(--accent)" }} />
    </div>
    <div className="min-w-0">
      <div className="flex items-baseline gap-2">
        <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
          {value}
        </p>
        {changePct !== undefined && changePct !== null && (
          <span className="text-[10px] font-semibold flex items-center gap-0.5" style={{ color: changePct >= 0 ? "var(--success)" : "var(--danger)" }}>
            {changePct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(changePct)}%
          </span>
        )}
      </div>
      <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
    </div>
  </Card>
);

const statValue = (v: number | null | undefined): React.ReactNode => (v === null || v === undefined ? "—" : v);

const SectionCard: React.FC<{ title: string; icon: React.ElementType; children: React.ReactNode }> = ({ title, icon: Icon, children }) => (
  <Card>
    <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
      <Icon className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
      <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
        {title}
      </h2>
    </div>
    {children}
  </Card>
);

const NoPermission: React.FC = () => (
  <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
    You don't have permission to view this data.
  </p>
);

export const AnalyticsDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [compare, setCompare] = useState(false);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => presetToRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await analyticsApi.overview({ from: range.from, to: range.to, compare });
        if (!cancelled) setOverview(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load analytics dashboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, compare]);

  const website = overview?.website;
  const leads = overview?.leads;
  const pipeline = overview?.pipeline;
  const clients = overview?.clients;
  const campaigns = overview?.campaigns;
  const forms = overview?.forms;
  const seo = overview?.seo;
  const recentActivity = overview?.recentActivity;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <BarChart3 className="w-5 h-5" /> Analytics Dashboard
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {user?.role.name} · real traffic, leads, pipeline, and campaign performance for your organization
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)} aria-label="Date range">
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="this_month">This month</option>
            <option value="custom">Custom range</option>
          </Select>
          {preset === "custom" && (
            <>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From date" />
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} aria-label="To date" />
            </>
          )}
          <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            Compare to previous period
          </label>
        </div>
      </div>

      {loading && <LoadingState label="Loading analytics…" />}
      {!loading && error && <ErrorState message={error} />}

      {!loading && !error && overview && (
        <>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
              Website &amp; conversion
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatCard icon={Globe2} label="Page views" value={statValue(website?.pageViews)} changePct={website?.pageViewsChangePct} />
              <StatCard icon={Users} label="Sessions" value={statValue(website?.sessions)} changePct={website?.sessionsChangePct} />
              <StatCard icon={Briefcase} label="Leads" value={statValue(leads?.total)} changePct={leads?.changePct} />
              <StatCard icon={Target} label="Opportunities won" value={pipeline ? pipeline.wonCount : "—"} changePct={pipeline?.wonChangePct} />
              <StatCard icon={TrendingUp} label="Conversion rate" value={overview.conversionRate === null ? "—" : `${overview.conversionRate}%`} />
            </div>
          </div>

          {website && !website.configured && (
            <Card className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
              Website analytics isn't configured for this organization yet — set <code>PUBLIC_WEBSITE_ORGANIZATION_ID</code> so the public site's page-view beacon attributes traffic here. See docs/ANALYTICS_ARCHITECTURE.md.
            </Card>
          )}
          {website && website.configured && !website.hasAnyTraffic && (
            <Card className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
              No traffic has been recorded yet. Page views will appear here once visitors reach the public site.
            </Card>
          )}

          <div className="grid lg:grid-cols-3 gap-4">
            <SectionCard title="Top pages" icon={Globe2}>
              {!website ? (
                <NoPermission />
              ) : !website.topPages || website.topPages.length === 0 ? (
                <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  No page views recorded yet.
                </p>
              ) : (
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {website.topPages.map((p) => (
                    <li key={p.path} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                      <span className="truncate" style={{ color: "var(--text-primary)" }}>
                        {p.path}
                      </span>
                      <Badge tone="info">{p.count}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Traffic sources (UTM)" icon={Megaphone}>
              {!website ? (
                <NoPermission />
              ) : !website.utmSources || website.utmSources.length === 0 ? (
                <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  No UTM-tagged traffic recorded yet.
                </p>
              ) : (
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {website.utmSources.map((s) => (
                    <li key={s.utmSource} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                      <span className="truncate" style={{ color: "var(--text-primary)" }}>
                        {s.utmSource}
                      </span>
                      <Badge tone="info">{s.count}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="Recent activity" icon={History}>
              {!recentActivity ? (
                <NoPermission />
              ) : recentActivity.length === 0 ? (
                <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  No activity yet.
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
            </SectionCard>
          </div>

          <div>
            <h2 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
              CRM &amp; sales
            </h2>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <StatCard icon={Briefcase} label="Leads" value={statValue(leads?.total)} changePct={leads?.changePct} />
              <StatCard icon={Target} label="Won value" value={pipeline ? pipeline.wonValue : "—"} />
              <StatCard icon={Target} label="Lost deals" value={pipeline ? pipeline.lostCount : "—"} />
              <StatCard icon={Users} label="Clients created" value={statValue(clients?.created)} changePct={clients?.changePct} />
              <StatCard icon={ClipboardList} label="Form submissions" value={statValue(forms?.submissions)} />
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <SectionCard title="Campaign performance" icon={Megaphone}>
              {!campaigns ? (
                <NoPermission />
              ) : campaigns.length === 0 ? (
                <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  No campaign activity in this range.
                </p>
              ) : (
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {campaigns.map((c) => (
                    <li key={c.campaignId} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                      <span className="truncate" style={{ color: "var(--text-primary)" }}>
                        {c.name}
                      </span>
                      <span className="flex gap-2 shrink-0">
                        <Badge tone="info">{c.leads} leads</Badge>
                        <Badge tone="success">{c.clients} clients</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard title="SEO health" icon={Search}>
              {!seo ? (
                <NoPermission />
              ) : seo.issueCount === 0 ? (
                <p className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  No SEO issues found.
                </p>
              ) : (
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {seo.topIssues.map((issue) => (
                    <li key={`${issue.resourceId}-${issue.code}`} className="px-4 py-2.5 text-xs flex items-center justify-between gap-3">
                      <span className="truncate" style={{ color: "var(--text-primary)" }}>
                        {issue.resourceTitle}
                      </span>
                      <Badge tone={issue.severity === "critical" ? "danger" : "warning"}>{issue.code}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
};
