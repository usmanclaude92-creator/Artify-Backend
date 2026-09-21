/** Phase 12 — AI usage/cost read surface (docs/AI_USAGE_AND_COSTS.md). Operational metric only — never Phase 10 billing data. */
import React, { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { aiUsageApi, type AiUsageSummary } from "../../../lib/aiApi";
import { Card, LoadingState, ErrorState, EmptyState } from "../../ui/ui";

function formatCost(cost: string | null): string {
  if (!cost) return "$0.00";
  return `$${Number(cost).toFixed(2)}`;
}

export const AiUsagePage: React.FC = () => {
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await aiUsageApi.summary();
      setSummary(res.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Gauge className="w-5 h-5" /> Usage & Costs
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          AI provider token usage and estimated cost — an operational metric, not authoritative billing data.
        </p>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : !summary || summary.totals._count === 0 ? (
        <Card>
          <EmptyState title="No usage recorded yet" description="Usage records appear here once AI calls that report token counts run." />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Requests
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                {summary.totals._count}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Input tokens
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                {(summary.totals._sum.inputTokens ?? 0).toLocaleString()}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Output tokens
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                {(summary.totals._sum.outputTokens ?? 0).toLocaleString()}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Estimated cost
              </p>
              <p className="text-xl font-bold mt-1" style={{ color: "var(--text-primary)" }}>
                {formatCost(summary.totals._sum.estimatedCost)}
              </p>
            </Card>
          </div>

          {summary.byModel.length > 0 && (
            <Card>
              <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  By model
                </h2>
              </div>
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {summary.byModel.map((row) => (
                  <li key={row.modelId ?? "unknown"} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                    <span style={{ color: "var(--text-primary)" }}>{row.modelId ?? "Unknown model"}</span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {row._count} calls · {(row._sum.totalTokens ?? 0).toLocaleString()} tokens · {formatCost(row._sum.estimatedCost)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
};
