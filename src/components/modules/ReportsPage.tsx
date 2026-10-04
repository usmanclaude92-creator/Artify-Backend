/**
 * Phase 15 — Reports area (docs/ANALYTICS_ARCHITECTURE.md §9). Reuses the
 * dormant `reports.read`/`reports.export` RBAC keys. Each of the 9 report
 * types comes straight from /reports/:type — real aggregation, never a
 * fabricated figure; CSV export reuses the same endpoint's data.
 */
import React, { useState } from "react";
import { FileBarChart, Download, Printer } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { hasPermission } from "../../lib/permissions";
import { reportsApi, REPORT_TYPES, REPORT_LABELS, type ReportTypeValue } from "../../lib/api";
import { Card, Button, Input, Select, LoadingState, ErrorState, EmptyState } from "../ui/ui";

/** Renders an arbitrary report payload generically — a flat key/value table for an object, a row-per-item table for an array — since each of the 9 report types has its own shape (no dedicated report-builder, per the brief). */
const ReportView: React.FC<{ data: unknown }> = ({ data }) => {
  if (data === null || data === undefined) {
    return <EmptyState title="Not available" description="You don't have permission to view this report, or no data exists for this range." />;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <EmptyState title="No data" description="No records in this range." />;
    const first = data[0];
    if (first && typeof first === "object") {
      const columns = Object.keys(first as Record<string, unknown>);
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {columns.map((c) => (
                  <th key={c} className="text-left px-3 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                  {columns.map((c) => (
                    <td key={c} className="px-3 py-2" style={{ color: "var(--text-primary)" }}>
                      {String((row as Record<string, unknown>)[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <pre className="text-xs p-3">{JSON.stringify(data, null, 2)}</pre>;
  }
  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    return (
      <table className="w-full text-xs">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} style={{ borderBottom: "1px solid var(--border)" }}>
              <td className="px-3 py-2 font-semibold w-1/3" style={{ color: "var(--text-muted)" }}>
                {k}
              </td>
              <td className="px-3 py-2" style={{ color: "var(--text-primary)" }}>
                {typeof v === "object" ? <pre className="whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</pre> : String(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <p className="p-3 text-xs">{String(data)}</p>;
};

export const ReportsPage: React.FC = () => {
  const { user } = useAuth();
  const canExport = hasPermission(user?.role.permissions, "reports.export");
  const [type, setType] = useState<ReportTypeValue>("executive_summary");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const runReport = async (selected: ReportTypeValue = type) => {
    setLoading(true);
    setError(null);
    try {
      const res = await reportsApi.get(selected, { from: from || undefined, to: to || undefined });
      setReport(res.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate report.");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await reportsApi.downloadExport(type, { from: from || undefined, to: to || undefined });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export report.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <FileBarChart className="w-5 h-5" /> Reports
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {user?.role.name} · generate and export real reports for your organization
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="w-3.5 h-3.5" /> Print
          </Button>
          {canExport && (
            <Button variant="secondary" onClick={handleExport} disabled={exporting}>
              <Download className="w-3.5 h-3.5" /> {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          )}
        </div>
      </div>

      <Card className="p-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="block text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>
            Report
          </label>
          <Select value={type} onChange={(e) => setType(e.target.value as ReportTypeValue)}>
            {REPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {REPORT_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>
            From
          </label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>
            To
          </label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button onClick={() => runReport()} disabled={loading}>
          {loading ? "Generating…" : "Run report"}
        </Button>
      </Card>

      <Card>
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            {REPORT_LABELS[type]}
          </h2>
        </div>
        {loading && <LoadingState label="Generating report…" />}
        {!loading && error && <ErrorState message={error} />}
        {!loading && !error && report === undefined && <EmptyState title="No report yet" description="Choose a report type and date range, then click Run report." />}
        {!loading && !error && report !== undefined && <ReportView data={report} />}
      </Card>
    </div>
  );
};
