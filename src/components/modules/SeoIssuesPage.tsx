/**
 * Phase 5 (extended Phase 8 — Advanced SEO Control Center) — SEO Dashboard:
 * a rule-based issue list plus the real, already-available counts that
 * make it a dashboard rather than just a list (content audited, redirects
 * active/inactive). Every number here comes from a real API response —
 * never a fabricated "SEO score," traffic estimate, or search ranking,
 * which this system has no real data source for and will not simulate.
 */
import React, { useEffect, useState } from "react";
import { AlertTriangle, AlertCircle, FileText, Newspaper, ExternalLink, ArrowRightLeft } from "lucide-react";
import { useRouter } from "../../lib/router";
import { seoApi, postsApi, pagesApi, redirectsApi, type SeoIssue } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Badge, LoadingState, ErrorState, EmptyState, Select } from "../ui/ui";

interface DashboardCounts {
  totalPosts: number;
  totalPages: number;
  totalRedirects: number;
  activeRedirects: number;
}

export const SeoIssuesPage: React.FC = () => {
  const { navigate } = useRouter();
  const [issues, setIssues] = useState<SeoIssue[]>([]);
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"" | "critical" | "warning">("");
  const [typeFilter, setTypeFilter] = useState<"" | "post" | "page">("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      seoApi.issues(),
      postsApi.list({ limit: 1 }),
      pagesApi.list({ limit: 1 }),
      redirectsApi.list({ limit: 1 }),
      redirectsApi.list({ limit: 1, isActive: true }),
    ])
      .then(([issuesRes, posts, pages, redirects, activeRedirects]) => {
        if (cancelled) return;
        setIssues(issuesRes.issues);
        setCounts({ totalPosts: posts.total, totalPages: pages.total, totalRedirects: redirects.total, activeRedirects: activeRedirects.total });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not load the SEO dashboard.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = issues.filter((i) => (!severityFilter || i.severity === severityFilter) && (!typeFilter || i.resourceType === typeFilter));
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const auditedResourceIds = new Set(issues.map((i) => `${i.resourceType}:${i.resourceId}`));
  const cleanCount = counts ? Math.max(counts.totalPosts + counts.totalPages - auditedResourceIds.size, 0) : null;

  const openRecord = (issue: SeoIssue) => {
    navigate(issue.resourceType === "post" ? `/cms/posts?q=${encodeURIComponent(issue.resourceTitle)}` : `/cms/pages?q=${encodeURIComponent(issue.resourceTitle)}`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
          SEO Dashboard
        </h1>
        <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Deterministic, rule-based checks against your Posts and Pages — missing/oversized meta fields, missing image alt
          text, duplicate titles/descriptions, invalid slugs, missing social images — plus real counts from your content
          and redirects. This is not a Google ranking score, traffic estimate, or search-visibility prediction; this
          system has no real data source for those and will not simulate one. It flags things you can fix directly.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {issues.length}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Total issues
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-bold text-rose-500">{criticalCount}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Critical (live content)
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-bold text-amber-500">{warningCount}</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Warnings
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {cleanCount ?? "—"}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Posts/pages with no flagged issues
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {counts ? `${counts.activeRedirects} / ${counts.totalRedirects}` : "—"}
          </p>
          <p className="text-xs flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
            <ArrowRightLeft className="w-3 h-3" /> Active redirects
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            {counts ? counts.totalPosts + counts.totalPages : "—"}
          </p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Total posts + pages audited
          </p>
        </Card>
      </div>

      <Card>
        <div className="p-3 border-b flex items-center gap-2" style={{ borderColor: "var(--border)" }}>
          <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}>
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
          </Select>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
            <option value="">All types</option>
            <option value="post">Posts</option>
            <option value="page">Pages</option>
          </Select>
        </div>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No issues found" description="Nothing matches the current filters — or your content is fully clean." />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {filtered.map((issue, idx) => {
              const Icon = issue.resourceType === "post" ? Newspaper : FileText;
              const SeverityIcon = issue.severity === "critical" ? AlertCircle : AlertTriangle;
              return (
                <li key={`${issue.resourceId}-${issue.code}-${idx}`} className="px-4 py-3 flex items-start gap-3 text-xs">
                  <SeverityIcon className={`w-4 h-4 shrink-0 mt-0.5 ${issue.severity === "critical" ? "text-rose-500" : "text-amber-500"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />
                      <button onClick={() => openRecord(issue)} className="font-semibold hover:underline truncate" style={{ color: "var(--text-primary)" }}>
                        {issue.resourceTitle}
                      </button>
                      <Badge tone={issue.severity === "critical" ? "danger" : "warning"}>{issue.severity}</Badge>
                      <Badge tone="neutral">{issue.status}</Badge>
                    </div>
                    <p className="mt-1" style={{ color: "var(--text-secondary)" }}>
                      {issue.message}
                    </p>
                  </div>
                  <button onClick={() => openRecord(issue)} aria-label="Open record" className="shrink-0" style={{ color: "var(--text-muted)" }}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
};
