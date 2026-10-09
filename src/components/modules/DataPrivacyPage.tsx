/** Administration → Data Privacy (Step 13): person lookup/export/erasure, requests, retention policy and consent register. */
import React, { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { opsApi, privacyApi, type ConsentRow, type ErasurePreview, type PrivacyLookup, type PrivacyRequestRow, type RetentionPolicyRow, type RetentionPreviewRow } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { hasPermission } from "../../lib/permissions";
import { Card, Button, Input, Badge, LoadingState, EmptyState, Pagination, Field } from "../ui/ui";

type Tab = "person" | "requests" | "retention" | "consent";
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "");

const PersonTab: React.FC<{ canExport: boolean; canErase: boolean }> = ({ canExport, canErase }) => {
  const { notify } = useToast();
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<PrivacyLookup | null>(null);
  const [preview, setPreview] = useState<ErasurePreview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const err = (e: unknown) => notify(e instanceof ApiClientError ? e.message : "That did not work.", "error");

  const search = async (ev: React.FormEvent) => { ev.preventDefault(); setBusy(true); setPreview(null); try { setResult(await privacyApi.lookup(email)); } catch (e) { setResult(null); err(e); } finally { setBusy(false); } };
  const runPreview = async () => { setBusy(true); try { setPreview(await privacyApi.preview(email)); } catch (e) { err(e); } finally { setBusy(false); } };
  const request = async () => { setBusy(true); try { await privacyApi.requestErasure(email, reason); notify("Erasure requested. A second SUPER_ADMIN must approve it in the Approvals center.", "success"); setPreview(null); setReason(""); } catch (e) { err(e); } finally { setBusy(false); } };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form onSubmit={search} className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[16rem]"><Field label="Person's email address"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field></div>
          <Button type="submit" variant="primary" disabled={busy || !email.trim()}>Find everything held</Button>
        </form>
        <p className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>Every lookup is written to the audit log (pseudonym and counts only, never the email).</p>
      </Card>
      {result && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{result.found ? "Held about this person" : "Nothing found for this email"}</h3>
            <Badge tone="neutral">ref {result.subjectRef.slice(0, 8)}</Badge>
            {result.staffAccount && <Badge tone="warning">Staff account</Badge>}
          </div>
          {result.found && (
            <>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {Object.entries(result.counts).map(([k, v]) => <div key={k} className="rounded-xl border p-2" style={{ borderColor: "var(--border)" }}><dt style={{ color: "var(--text-muted)" }}>{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt><dd className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{v}</dd></div>)}
              </dl>
              {result.auditSnapshotsContainingEmail > 0 && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{result.auditSnapshotsContainingEmail} audit entr{result.auditSnapshotsContainingEmail === 1 ? "y holds" : "ies hold"} this email inside a change snapshot. The audit log is immutable and is not rewritten by an erasure.</p>}
              <div className="flex flex-wrap gap-2">
                {canExport && <Button disabled={busy} onClick={() => void privacyApi.download(email, "json", `subject-export-${result.subjectRef}.json`).catch(err)}>Export JSON</Button>}
                {canExport && <Button disabled={busy} onClick={() => void privacyApi.download(email, "csv", `subject-export-${result.subjectRef}.csv`).catch(err)}>Export CSV</Button>}
                <Button disabled={busy || result.staffAccount} onClick={() => void runPreview()}>Preview erasure</Button>
              </div>
            </>
          )}
        </Card>
      )}
      {preview && (
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>What an erasure would change</h3>
          {preview.blocker && <p className="text-xs text-rose-500" role="alert">{preview.blocker}</p>}
          <table className="w-full text-xs">
            <thead><tr style={{ color: "var(--text-muted)" }}><th className="text-left py-1">Table</th><th className="text-left">Rows</th><th className="text-left">Action</th><th className="text-left">Detail</th></tr></thead>
            <tbody>{preview.changes.map((c) => <tr key={c.table} className="border-t" style={{ borderColor: "var(--border)" }}><td className="py-1 font-mono">{c.table}</td><td>{c.rows}</td><td><Badge tone={c.action === "Keep" ? "neutral" : c.action === "Delete" ? "danger" : "warning"}>{c.action}</Badge></td><td style={{ color: "var(--text-secondary)" }}>{c.detail}</td></tr>)}</tbody>
          </table>
          {preview.erasable && canErase && (
            <div className="space-y-2">
              <Field label="Reason (required, 10 to 500 characters; do not include the person's details)"><Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
              <Button variant="danger" disabled={busy || reason.trim().length < 10} onClick={() => void request()}>Request erasure (needs a second approver)</Button>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Nothing is changed until a different SUPER_ADMIN approves the request in the Approvals center.</p>
            </div>
          )}
          {preview.erasable && !canErase && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Only a SUPER_ADMIN can request an erasure.</p>}
        </Card>
      )}
    </div>
  );
};

const RequestsTab: React.FC = () => {
  const [rows, setRows] = useState<PrivacyRequestRow[] | null>(null);
  useEffect(() => { privacyApi.requests().then((r) => setRows(r.requests)).catch(() => setRows([])); }, []);
  if (!rows) return <LoadingState />;
  if (rows.length === 0) return <EmptyState title="No privacy requests yet" description="Erasure requests appear here and in the Approvals center." />;
  return (
    <Card className="overflow-hidden"><ul>{rows.map((r) => (
      <li key={r.id} className="px-4 py-3 border-b last:border-b-0 text-xs flex flex-wrap gap-3 items-center" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
        <Badge tone={r.status === "EXECUTED" ? "success" : r.status === "REJECTED" ? "danger" : "info"}>{r.status.replace("_", " ")}</Badge>
        <span className="font-mono">ref {r.subjectRef.slice(0, 8)}</span><span>{r.kind}</span><span>{r.reason}</span>
        <span className="ml-auto">{fmt(r.createdAt)}</span>
        {r.resultCounts && <span>changed: {Object.entries(r.resultCounts).map(([k, v]) => `${k} ${v}`).join(", ")}</span>}
      </li>))}</ul></Card>
  );
};

const RetentionTab: React.FC = () => {
  const [data, setData] = useState<{ policy: RetentionPolicyRow[]; purgeEnabled: boolean; preview: RetentionPreviewRow[] } | null>(null);
  useEffect(() => { opsApi.retention().then(setData).catch(() => undefined); }, []);
  if (!data) return <LoadingState />;
  const prev = new Map(data.preview.map((p) => [p.key, p]));
  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: "var(--text-secondary)" }} role="status">Automatic deletion is <strong>{data.purgeEnabled ? "ON" : "OFF"}</strong> (RETENTION_PURGE_ENABLED). The "eligible now" column shows what would be deleted today; nothing is deleted while it is off, except the social inbox job, which runs on its own setting.</p>
      <Card className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr style={{ color: "var(--text-muted)" }}><th className="text-left px-4 py-2">Data class</th><th className="text-left">Kept for</th><th className="text-left">Eligible now</th><th className="text-left">Basis</th></tr></thead>
          <tbody>{data.policy.map((e) => (
            <tr key={e.key} className="border-t align-top" style={{ borderColor: "var(--border)" }}>
              <td className="px-4 py-2" style={{ color: "var(--text-primary)" }}>{e.dataClass}<br /><span className="font-mono" style={{ color: "var(--text-muted)" }}>{e.tables.join(", ")}</span></td>
              <td>{e.retentionDays === null ? "Until erased or reviewed" : `${e.retentionDays} days`}<br /><span style={{ color: "var(--text-muted)" }}>{e.setBy}</span></td>
              <td>{prev.get(e.key)?.eligible ?? "n/a"}</td>
              <td className="pr-4" style={{ color: "var(--text-secondary)" }}>{e.basis}</td>
            </tr>))}</tbody>
        </table>
      </Card>
    </div>
  );
};

const ConsentTab: React.FC = () => {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ records: ConsentRow[]; summary: Array<{ source: string; status: string; count: number }>; totalPages: number } | null>(null);
  useEffect(() => { opsApi.consent({ page, limit: 25 }).then(setData).catch(() => undefined); }, [page]);
  if (!data) return <LoadingState />;
  return (
    <div className="space-y-3">
      <Card className="p-3"><p className="text-xs font-bold mb-1" style={{ color: "var(--text-primary)" }}>By capture path</p>
        <ul className="text-xs grid md:grid-cols-2 gap-x-6" style={{ color: "var(--text-secondary)" }}>{data.summary.map((s) => <li key={`${s.source}${s.status}`}>{s.source}: {s.count} {s.status.toLowerCase().replace("_", " ")}</li>)}</ul>
        <p className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>"Not collected" means that path has no consent checkbox (manual entry, automation, social auto-lead). The register holds IDs, source and time only.</p>
      </Card>
      {data.records.length === 0 ? <EmptyState title="No consent events yet" /> : (
        <Card className="overflow-x-auto"><table className="w-full text-xs"><thead><tr style={{ color: "var(--text-muted)" }}><th className="text-left px-4 py-2">When</th><th className="text-left">Source</th><th className="text-left">Status</th></tr></thead>
          <tbody>{data.records.map((r) => <tr key={r.id} className="border-t" style={{ borderColor: "var(--border)" }}><td className="px-4 py-2">{fmt(r.capturedAt)}</td><td>{r.source}</td><td><Badge tone={r.status === "GIVEN" ? "success" : r.status === "DECLINED" ? "danger" : "neutral"}>{r.status.replace("_", " ")}</Badge></td></tr>)}</tbody></table></Card>
      )}
      <Pagination page={page} totalPages={data.totalPages} onChange={setPage} />
    </div>
  );
};

export const DataPrivacyPage: React.FC = () => {
  const { user } = useAuth();
  const perms = user?.role.permissions;
  const [tab, setTab] = useState<Tab>("person");
  const canExport = hasPermission(perms, "privacy.export");
  const canErase = hasPermission(perms, "privacy.erase");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><ShieldCheck className="w-5 h-5" /> Data privacy</h2>
        <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>Find what is held about a person, export it, or erase it with a second person's approval. See docs/OPERATIONS.md for the procedure and the obligations this tool supports.</p>
      </div>
      <div role="tablist" className="flex gap-1 border-b" style={{ borderColor: "var(--border)" }}>
        {([["person", "Person"], ["requests", "Requests"], ["retention", "Retention policy"], ["consent", "Consent register"]] as Array<[Tab, string]>).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="px-3 py-2 text-xs font-semibold border-b-2" style={{ borderColor: tab === k ? "var(--accent)" : "transparent", color: tab === k ? "var(--accent)" : "var(--text-secondary)" }}>{l}</button>
        ))}
      </div>
      {tab === "person" && <PersonTab canExport={canExport} canErase={canErase} />}
      {tab === "requests" && <RequestsTab />}
      {tab === "retention" && <RetentionTab />}
      {tab === "consent" && <ConsentTab />}
    </div>
  );
};
