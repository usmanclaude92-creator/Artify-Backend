/**
 * Audit log — read-only. Search, filters (severity, actor type, result, action,
 * resource, date range), pagination and a drill-down detail view. No edit or
 * delete affordance exists anywhere here, and none exists in the API.
 */
import React, { useEffect, useState } from "react";
import { ScrollText, Search } from "lucide-react";
import { auditLogsApi, type AuditLogEntry } from "../../lib/api";
import { Card, Badge, Input, Select, Button, Modal, LoadingState, ErrorState, EmptyState, Pagination, DataTable, type DataTableColumn } from "../ui/ui";

const SEVERITY_TONE = { info: "neutral", warning: "warning", critical: "danger" } as const;

const Json: React.FC<{ label: string; value: unknown }> = ({ label, value }) =>
  value === null || value === undefined ? null : (
    <div>
      <p className="text-[10px] uppercase font-bold mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
      <pre className="text-[11px] p-2 rounded-lg overflow-x-auto max-h-48" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );

const DetailModal: React.FC<{ id: string | null; onClose: () => void }> = ({ id, onClose }) => {
  const [entry, setEntry] = useState<AuditLogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setEntry(null);
    setError(null);
    if (!id) return;
    auditLogsApi.get(id).then((r) => setEntry(r.auditLog)).catch((e) => setError(e instanceof Error ? e.message : "Could not load event."));
  }, [id]);
  return (
    <Modal open={!!id} onClose={onClose} title="Audit event">
      {error ? <ErrorState message={error} /> : !entry ? <LoadingState /> : (
        <div className="space-y-3 text-xs">
          <dl className="grid grid-cols-2 gap-2">
            {([
              ["Action", entry.action], ["When", new Date(entry.createdAt).toLocaleString()],
              ["Actor", entry.actorName ?? entry.actorType], ["Actor type", entry.actorType],
              ["Resource", entry.resourceType ? `${entry.resourceType}${entry.resourceId ? ` · ${entry.resourceId}` : ""}` : "—"],
              ["Result", entry.result], ["IP address", entry.ipAddress ?? "—"], ["Request ID", entry.requestId ?? "—"],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k}><dt className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>{k}</dt><dd className="break-all" style={{ color: "var(--text-primary)" }}>{v}</dd></div>
            ))}
          </dl>
          {entry.userAgent && <p className="break-all" style={{ color: "var(--text-muted)" }}>{entry.userAgent}</p>}
          <Json label="Before" value={entry.beforeData} />
          <Json label="After" value={entry.afterData} />
          <Json label="Metadata" value={entry.metadata} />
        </div>
      )}
    </Modal>
  );
};

export const AuditLogPage: React.FC = () => {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [severity, setSeverity] = useState<"" | "info" | "warning" | "critical">("");
  const [result, setResult] = useState<"" | "SUCCESS" | "FAILURE">("");
  const [actorType, setActorType] = useState<"" | AuditLogEntry["actorType"]>("");
  const [resourceType, setResourceType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actions, setActions] = useState<string[]>([]);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => { auditLogsApi.actions().then((r) => setActions(r.actions)).catch(() => setActions([])); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    auditLogsApi
      .list({
        page, limit: 25, q: query || undefined, action: action || undefined, severity: severity || undefined, result: result || undefined,
        actorType: actorType || undefined, resourceType: resourceType || undefined,
        dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
        dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : undefined,
      })
      .then((res) => { if (!cancelled) { setEntries(res.items); setTotalPages(res.totalPages); setTotal(res.total); } })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load audit log."))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [page, query, action, severity, result, actorType, resourceType, dateFrom, dateTo]);

  const reset = () => { setQ(""); setQuery(""); setAction(""); setSeverity(""); setResult(""); setActorType(""); setResourceType(""); setDateFrom(""); setDateTo(""); setPage(1); };
  const filter = <T,>(set: (v: T) => void) => (v: T) => { setPage(1); set(v); };

  const columns: DataTableColumn<AuditLogEntry>[] = [
    { key: "when", header: "When", cellClassName: "whitespace-nowrap", cellStyle: { color: "var(--text-muted)" }, render: (e) => new Date(e.createdAt).toLocaleString() },
    { key: "sev", header: "Severity", render: (e) => <Badge tone={SEVERITY_TONE[e.severity ?? "info"]}>{e.severity ?? "info"}</Badge> },
    { key: "actor", header: "Actor", cellStyle: { color: "var(--text-primary)" }, render: (e) => e.actorName ?? e.actorType },
    { key: "action", header: "Action", cellClassName: "font-mono", cellStyle: { color: "var(--text-primary)" }, render: (e) => e.action },
    { key: "resource", header: "Resource", cellStyle: { color: "var(--text-muted)" }, render: (e) => e.resourceType ?? "—" },
    { key: "result", header: "Result", render: (e) => <Badge tone={e.result === "SUCCESS" ? "success" : "danger"}>{e.result}</Badge> },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <ScrollText className="w-5 h-5" /> Audit Log
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Append-only history of security and administrative events for your organization. {total > 0 && `${total.toLocaleString()} matching event${total === 1 ? "" : "s"}.`}
        </p>
      </div>

      <Card className="p-3 space-y-2">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(q); }}>
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
            <Input placeholder="Search action, actor or resource…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" aria-label="Search audit log" />
          </div>
          <Button type="submit" variant="secondary">Search</Button>
          <Button type="button" variant="secondary" onClick={reset}>Reset</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Select value={action} onChange={(e) => filter(setAction)(e.target.value)} aria-label="Action">
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Select value={severity} onChange={(e) => filter(setSeverity)(e.target.value as typeof severity)} aria-label="Severity">
            <option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option>
          </Select>
          <Select value={result} onChange={(e) => filter(setResult)(e.target.value as typeof result)} aria-label="Result">
            <option value="">All results</option><option value="SUCCESS">Success</option><option value="FAILURE">Failure</option>
          </Select>
          <Select value={actorType} onChange={(e) => filter(setActorType)(e.target.value as typeof actorType)} aria-label="Actor type">
            <option value="">All actors</option><option value="USER">Users</option><option value="SYSTEM">System</option><option value="AI_COWORKER">AI</option><option value="API_KEY">API keys</option>
          </Select>
          <Input placeholder="Resource type (e.g. user)" value={resourceType} onChange={(e) => filter(setResourceType)(e.target.value)} className="max-w-[170px]" aria-label="Resource type" />
          <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>From <Input type="date" value={dateFrom} onChange={(e) => filter(setDateFrom)(e.target.value)} aria-label="From date" /></label>
          <label className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>To <Input type="date" value={dateTo} onChange={(e) => filter(setDateTo)(e.target.value)} aria-label="To date" /></label>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? <LoadingState /> : error ? <ErrorState message={error} /> : entries.length === 0 ? <EmptyState title="No audit events" description="No events match the current filters." /> : <DataTable columns={columns} rows={entries} keyOf={(e) => e.id} onRowClick={(e) => setDetailId(e.id)} />}
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </Card>
      <DetailModal id={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
};
