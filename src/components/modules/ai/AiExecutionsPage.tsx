/** Phase 12 — AI execution history: every governed tool call/workflow run, audit-trail style (docs/AI_ARCHITECTURE.md §19). */
import React, { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { aiExecutionsApi, type AiExecution, type AiExecutionStatusValue } from "../../../lib/aiApi";
import { Card, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination } from "../../ui/ui";

const STATUS_OPTIONS: AiExecutionStatusValue[] = ["PENDING", "RUNNING", "AWAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"];
const STATUS_TONE: Record<AiExecutionStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "neutral",
  RUNNING: "info",
  AWAITING_APPROVAL: "warning",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export const AiExecutionsPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<AiExecutionStatusValue | "">("");
  const [executions, setExecutions] = useState<AiExecution[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<AiExecution | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPage(1), [status]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await aiExecutionsApi.list({ page, limit: 20, status: status || undefined });
      setExecutions(res.items);
      setTotalPages(res.totalPages);
      setSelectedId((prev) => (prev && res.items.some((e) => e.id === prev) ? prev : (res.items[0]?.id ?? null)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load executions.");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    void aiExecutionsApi.get(selectedId).then((res) => setSelectedDetail(res.execution)).catch(() => setSelectedDetail(null));
  }, [selectedId]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <History className="w-5 h-5" /> AI Executions
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Every direct tool call and workflow run this organization's AI coworker has made.
        </p>
      </div>

      <Card className="p-3 flex gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value as AiExecutionStatusValue | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : executions.length === 0 ? (
        <Card>
          <EmptyState title="No executions yet" description="Run a workflow or an AI tool call to see it here." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[340px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {executions.map((exec) => (
              <button
                key={exec.id}
                onClick={() => setSelectedId(exec.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selectedId === exec.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{exec.kind === "WORKFLOW" ? (exec.workflow?.name ?? "Workflow") : (exec.toolCode ?? "Tool call")}</span>
                <Badge tone={STATUS_TONE[exec.status]}>{exec.status}</Badge>
              </button>
            ))}
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </Card>

          {selectedDetail && (
            <Card>
              <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: "var(--border)" }}>
                <div>
                  <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                    {selectedDetail.kind === "WORKFLOW" ? (selectedDetail.workflow?.name ?? "Workflow") : selectedDetail.toolCode}
                    <Badge tone={STATUS_TONE[selectedDetail.status]}>{selectedDetail.status}</Badge>
                  </h2>
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Started {new Date(selectedDetail.startedAt).toLocaleString()}
                    {selectedDetail.durationMs != null ? ` · ${selectedDetail.durationMs}ms` : ""}
                  </p>
                </div>
              </div>

              {selectedDetail.errorMessage && (
                <div className="mx-4 mt-3 text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{selectedDetail.errorMessage}</div>
              )}

              {selectedDetail.toolExecutions && selectedDetail.toolExecutions.length > 0 && (
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {selectedDetail.toolExecutions.map((te) => (
                    <li key={te.id} className="px-4 py-2.5 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                          {te.stepOrder != null ? `${te.stepOrder + 1}. ` : ""}
                          {te.toolCode}
                          <Badge tone={STATUS_TONE[te.status]}>{te.status}</Badge>
                        </p>
                        {te.durationMs != null && <span style={{ color: "var(--text-muted)" }}>{te.durationMs}ms</span>}
                      </div>
                      {te.errorMessage && <p className="mt-1 text-rose-500">{te.errorMessage}</p>}
                    </li>
                  ))}
                </ul>
              )}

              <div className="p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>
                  Output
                </p>
                <pre className="text-[11px] rounded-lg p-3 overflow-auto max-h-64" style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  {JSON.stringify(selectedDetail.output, null, 2)}
                </pre>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};
