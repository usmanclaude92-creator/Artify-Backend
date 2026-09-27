/** Phase 4 §19 — real, paginated, filterable, read-only (no edit/delete affordance anywhere in this component). */
import React, { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { auditLogsApi, type AuditLogEntry } from "../../lib/api";
import { Card, Badge, Input, Select, LoadingState, ErrorState, EmptyState, Pagination, DataTable, type DataTableColumn } from "../ui/ui";

export const AuditLogPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [result, setResult] = useState<"" | "SUCCESS" | "FAILURE">("");
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    auditLogsApi
      .list({ page, limit: 25, action: action || undefined, result: result || undefined })
      .then((res) => {
        if (cancelled) return;
        setEntries(res.items);
        setTotalPages(res.totalPages);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load audit log."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [page, action, result]);

  const auditColumns: DataTableColumn<AuditLogEntry>[] = [
    {
      key: "when",
      header: "When",
      cellClassName: "whitespace-nowrap",
      cellStyle: { color: "var(--text-muted)" },
      render: (entry) => new Date(entry.createdAt).toLocaleString(),
    },
    { key: "actor", header: "Actor", cellStyle: { color: "var(--text-primary)" }, render: (entry) => entry.actorName ?? entry.actorType },
    { key: "action", header: "Action", cellClassName: "font-mono", cellStyle: { color: "var(--text-primary)" }, render: (entry) => entry.action },
    { key: "resource", header: "Resource", cellStyle: { color: "var(--text-muted)" }, render: (entry) => entry.resourceType ?? "—" },
    { key: "result", header: "Result", render: (entry) => <Badge tone={entry.result === "SUCCESS" ? "success" : "danger"}>{entry.result}</Badge> },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <ScrollText className="w-5 h-5" /> Audit Log
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Immutable, append-only security event history for your organization.
        </p>
      </div>

      <Card className="p-3 flex flex-wrap gap-2">
        <Input
          placeholder="Filter by action (e.g. AUTH_LOGIN)"
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
          className="max-w-[220px]"
        />
        <Select
          value={result}
          onChange={(e) => {
            setPage(1);
            setResult(e.target.value as typeof result);
          }}
        >
          <option value="">All results</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILURE">Failure</option>
        </Select>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} />
        ) : entries.length === 0 ? (
          <EmptyState title="No audit events" description="No events match the current filters." />
        ) : (
          <DataTable columns={auditColumns} rows={entries} keyOf={(entry) => entry.id} />
        )}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>
    </div>
  );
};
