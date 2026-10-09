/** Administration → Backups (Step 13): read-only provider view, scheduled logical export status and the restore runbook. */
import React, { useCallback, useEffect, useState } from "react";
import { DatabaseBackup } from "lucide-react";
import { opsApi, type BackupsReport } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Card, Button, Badge, LoadingState, ErrorState, EmptyState } from "../ui/ui";

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "not reported");

export const BackupsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const [data, setData] = useState<BackupsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [verify, setVerify] = useState<Record<string, Array<{ name: string; ok: boolean; detail?: string }>>>({});
  const isSuper = user?.role.key === "SUPER_ADMIN";

  const load = useCallback(() => { opsApi.backups().then(setData).catch((e) => setError(e instanceof ApiClientError ? e.message : "Could not load backups.")); }, []);
  useEffect(load, [load]);
  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;
  const p = data.provider;

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); try { await fn(); } catch (e) { notify(e instanceof ApiClientError ? e.message : "That did not work.", "error"); } finally { setBusy(null); } };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><DatabaseBackup className="w-5 h-5" /> Backups</h2>
        <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>Read-only. Restores are done in the Supabase Dashboard following the runbook below; nothing on this page changes the database.</p>
      </div>

      <Card className="p-4 space-y-2">
        <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Provider backups (Supabase)</h3>
        {!p.available ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }} role="status">{p.reason}</p>
        ) : (
          <dl className="grid md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <div><dt style={{ color: "var(--text-muted)" }}>Last backup</dt><dd style={{ color: "var(--text-primary)" }}>{fmt(p.lastBackupAt)}</dd></div>
            <div><dt style={{ color: "var(--text-muted)" }}>Point-in-time recovery</dt><dd style={{ color: "var(--text-primary)" }}>{p.pitrEnabled === null ? "not reported" : p.pitrEnabled ? "enabled" : "not enabled"}</dd></div>
            <div><dt style={{ color: "var(--text-muted)" }}>Earliest recovery point</dt><dd style={{ color: "var(--text-primary)" }}>{fmt(p.earliestRecoveryAt)}</dd></div>
            <div><dt style={{ color: "var(--text-muted)" }}>Latest recovery point</dt><dd style={{ color: "var(--text-primary)" }}>{fmt(p.latestRecoveryAt)}</dd></div>
            <div className="md:col-span-2"><dt style={{ color: "var(--text-muted)" }}>Backups listed ({p.backups?.length ?? 0})</dt><dd style={{ color: "var(--text-primary)" }}>{(p.backups ?? []).slice(0, 8).map((b) => `${fmt(b.at)} (${b.status ?? "?"})`).join(" · ") || "none reported"}</dd></div>
          </dl>
        )}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Scheduled critical-data export</h3>
          <Badge tone={data.exportConfig.enabled && data.exportConfig.keyConfigured ? "success" : "warning"}>{data.exportConfig.enabled && data.exportConfig.keyConfigured ? "Active" : "Not active"}</Badge>
          {isSuper && <Button className="ml-auto" disabled={busy !== null || !data.exportConfig.keyConfigured} onClick={() => void run("export", async () => { await opsApi.runExport(); notify("Export created", "success"); load(); })}>Run export now</Button>}
        </div>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Settings, CRM, content and social account metadata, encrypted (AES-256-GCM) into private storage and kept {data.exportConfig.retentionDays} days (newest three always kept). Credentials, tokens, sessions and the credential vault are never included.</p>
        {data.exportConfig.problems.length > 0 && <ul className="text-xs list-disc pl-4" style={{ color: "var(--text-secondary)" }}>{data.exportConfig.problems.map((x) => <li key={x}>{x}</li>)}</ul>}
        {data.exports.length === 0 ? <EmptyState title="No export yet" description="Nothing has been exported." /> : (
          <ul>
            {data.exports.map((e) => (
              <li key={e.id} className="py-2 border-t text-xs flex flex-wrap items-center gap-3" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
                <span style={{ color: "var(--text-primary)" }}>{fmt(e.createdAt)}</span>
                <Badge tone={e.status === "SUCCEEDED" ? "success" : e.status === "FAILED" ? "danger" : "info"}>{e.status}</Badge>
                {e.sizeBytes !== null && <span>{Math.round(e.sizeBytes / 1024)} KB</span>}
                {e.verifiedAt ? <Badge tone="success">Verified {fmt(e.verifiedAt)}</Badge> : e.status === "SUCCEEDED" ? <span>not verified yet</span> : null}
                {e.error && <span className="text-rose-500">{e.error}</span>}
                {e.status === "SUCCEEDED" && <Button className="ml-auto" disabled={busy !== null} onClick={() => void run(e.id, async () => { const r = await opsApi.verifyExport(e.id); setVerify((v) => ({ ...v, [e.id]: r.checks })); notify(r.ok ? "Export verified" : "Verification failed", r.ok ? "success" : "error"); load(); })}>Verify (restore test)</Button>}
                {verify[e.id] && <ul className="w-full pl-4 list-disc">{verify[e.id]!.map((c) => <li key={c.name} style={{ color: c.ok ? undefined : "#e11d48" }}>{c.ok ? "Passed" : "Failed"}: {c.name}{c.detail ? ` (${c.detail})` : ""}</li>)}</ul>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>Restore runbook (summary)</h3>
        <ol className="text-xs list-decimal pl-4 space-y-1" style={{ color: "var(--text-secondary)" }}>
          <li>Decide the restore point (the closest backup before the problem; with PITR, the exact second).</li>
          <li>Tell users: the project is unreachable while a restore runs, for longer on bigger databases.</li>
          <li>Supabase Dashboard → Database → Backups (or Point in Time) → restore. Prefer restoring into a new project first to inspect the data.</li>
          <li>Re-apply custom role passwords (backups do not store them) and check the scheduled jobs in <code>cron.job</code> still exist.</li>
          <li>Storage files are not part of database backups; check the media bucket separately.</li>
          <li>Run the Verify button above on a recent export and open System Health to confirm every check recovers.</li>
        </ol>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Full steps, the restore-test checklist and what each Supabase plan includes are in docs/OPERATIONS.md.</p>
      </Card>
    </div>
  );
};
