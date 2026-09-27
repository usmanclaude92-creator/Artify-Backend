/** Phase 5 — SEO Control Center: rule-based issue list. Every check is a plain, explainable rule against real content — never a fabricated "SEO score." */
import React, { useEffect, useState } from "react";
import { AlertTriangle, AlertCircle, FileText, Newspaper, ExternalLink } from "lucide-react";
import { useRouter } from "../../lib/router";
import { seoApi, type SeoIssue } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Badge, LoadingState, ErrorState, EmptyState, Select } from "../ui/ui";

export const SeoIssuesPage: React.FC = () => {
  const { navigate } = useRouter();
  const [issues, setIssues] = useState<SeoIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<"" | "critical" | "warning">("");
  const [typeFilter, setTypeFilter] = useState<"" | "post" | "page">("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    seoApi
      .issues()
      .then((res) => {
        if (!cancelled) setIssues(res.issues);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Could not load SEO issues.");
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

  const openRecord = (issue: SeoIssue) => {
    navigate(issue.resourceType === "post" ? `/cms/posts?q=${encodeURIComponent(issue.resourceTitle)}` : `/cms/pages?q=${encodeURIComponent(issue.resourceTitle)}`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
          SEO Issues
        </h1>
        <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Deterministic, rule-based checks against your Posts and Pages — missing/oversized meta fields, missing image alt
          text, duplicate titles. This is not a Google ranking score; it flags things you can fix directly.
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
