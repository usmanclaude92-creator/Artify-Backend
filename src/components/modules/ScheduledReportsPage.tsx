/** Administration → Scheduled Reports (Step 14). Dry run is the default; the kill switch stops everything; delivery is in-app (+ email only when a provider is configured). */
import React, { useCallback, useEffect, useState } from "react";
import { FileText, Plus, Power } from "lucide-react";
import { dashboardApi, type ReportRecipient, type ReportRun, type ReportSchedule, type ReportSettings } from "../../lib/api";
import { useToast } from "../../context/ToastContext";
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, Input, LoadingState, Modal, Select } from "../ui/ui";

export const SECTION_LABELS: Record<string, string> = { attention: "Attention needed", website: "Website", crm: "CRM", social: "Social", marketing: "Marketing & landing pages", operations: "Operations" };

export const ScheduledReportsPage: React.FC = () => {
  const { notify } = useToast();
  const [schedules, setSchedules] = useState<ReportSchedule[] | null>(null);
  const [settings, setSettings] = useState<ReportSettings | null>(null);
  const [recipients, setRecipients] = useState<ReportRecipient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<ReportSchedule | null>(null);
  const [runs, setRuns] = useState<{ id: string; rows: ReportRun[] } | null>(null);
  const [form, setForm] = useState({ name: "Weekly dashboard summary", cadence: "WEEKLY" as "WEEKLY" | "MONTHLY", periodDays: 7, sections: ["attention", "website", "crm"] as string[], recipientIds: [] as string[], dryRun: true });
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    dashboardApi.schedules().then((r) => { setSchedules(r.schedules); setSettings(r.settings); setError(null); }).catch((e) => setError(e instanceof Error ? e.message : "Could not load report schedules."));
  }, []);
  useEffect(() => { load(); dashboardApi.recipients().then((r) => setRecipients(r.recipients)).catch(() => undefined); }, [load]);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); notify(ok, "success"); load(); } catch (e) { notify(e instanceof Error ? e.message : "Something went wrong.", "error"); } };

  if (error && !schedules) return <ErrorState message={error} />;
  if (!schedules || !settings) return <LoadingState />;

  const create = async () => {
    setFormError(null);
    try { await dashboardApi.createSchedule({ ...form, enabled: true }); setOpen(false); notify("Schedule created" + (form.dryRun ? " in dry-run mode." : "."), "success"); load(); } catch (e) { setFormError(e instanceof Error ? e.message : "Could not create the schedule."); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><FileText className="w-5 h-5" /> Scheduled reports</h1>
          <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>Weekly or monthly summaries of the dashboard. Each recipient gets only the sections their role may read. New schedules start in dry-run mode: reports are rendered and stored, nothing is delivered until you switch dry run off.</p>
        </div>
        <Button variant="primary" onClick={() => { setForm((f) => ({ ...f, recipientIds: [] })); setFormError(null); setOpen(true); }}><Plus className="w-3.5 h-3.5" /> New schedule</Button>
      </div>

      <Card className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><Power className="w-4 h-4" /> Kill switch: <Badge tone={settings.killSwitch ? "danger" : "success"}>{settings.killSwitch ? "ON — nothing is sent" : "off"}</Badge></p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Delivery channels: in-app notification with a downloadable HTML file{settings.emailConfigured ? " and email" : ". Email is not available because no outbound email provider is configured (EMAIL_PROVIDER)"}.</p>
        </div>
        <Button variant={settings.killSwitch ? "secondary" : "danger"} onClick={() => act(() => dashboardApi.setKillSwitch(!settings.killSwitch), settings.killSwitch ? "Kill switch turned off." : "Kill switch turned on.")}>{settings.killSwitch ? "Turn kill switch off" : "Turn kill switch on"}</Button>
      </Card>

      {schedules.length === 0 ? (
        <Card className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>No schedules yet. Create one to receive a weekly summary.</Card>
      ) : schedules.map((s) => (
        <Card key={s.id} className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{s.name} <Badge tone={s.dryRun ? "warning" : "success"}>{s.dryRun ? "dry run" : "live"}</Badge> {!s.enabled && <Badge>paused</Badge>}</p>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{s.cadence === "WEEKLY" ? "Mondays 07:00 UTC" : "1st of the month 07:00 UTC"} · last {s.periodDays} days · {s.sections.map((x) => SECTION_LABELS[x] ?? x).join(", ")} · {s.recipientIds.length} recipient(s)</p>
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Next run {s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : "—"} · last run {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "never"}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <Button onClick={() => act(() => dashboardApi.sendTest(s.id), "Test report sent to you only (see Notifications).")} disabled={settings.killSwitch}>Send test to me</Button>
              <Button onClick={() => act(() => dashboardApi.runSchedule(s.id), s.dryRun ? "Dry run complete — nothing was delivered." : "Report run complete.")}>Run now</Button>
              <Button onClick={() => act(() => dashboardApi.updateSchedule(s.id, { dryRun: !s.dryRun }), s.dryRun ? "Dry run switched off — the next run delivers." : "Dry run switched on.")}>{s.dryRun ? "Switch dry run off" : "Switch dry run on"}</Button>
              <Button onClick={() => act(() => dashboardApi.updateSchedule(s.id, { enabled: !s.enabled }), s.enabled ? "Paused." : "Resumed.")}>{s.enabled ? "Pause" : "Resume"}</Button>
              <Button onClick={() => dashboardApi.runs(s.id).then((r) => setRuns({ id: s.id, rows: r.runs })).catch(() => notify("Could not load run history.", "error"))}>History</Button>
              <Button variant="danger" onClick={() => setDel(s)}>Delete</Button>
            </div>
          </div>
          {runs?.id === s.id && (runs.rows.length === 0 ? <p className="text-xs" style={{ color: "var(--text-muted)" }}>No runs yet.</p> : (
            <ul className="text-xs space-y-0.5">{runs.rows.map((r) => <li key={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.trigger.toLowerCase()} · <Badge tone={r.status === "SENT" ? "success" : r.status === "KILLED" || r.status === "PARTIAL" ? "danger" : "neutral"}>{r.status.toLowerCase().replace("_", " ")}</Badge> · {r.periodFrom} to {r.periodTo} · {(r.summary?.outcomes ?? []).length} recipient(s)</li>)}</ul>
          ))}
        </Card>
      ))}

      <Modal open={open} onClose={() => setOpen(false)} title="New report schedule">
        <div className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cadence"><Select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value as "WEEKLY" | "MONTHLY", periodDays: e.target.value === "MONTHLY" ? 28 : 7 })}><option value="WEEKLY">Weekly (Monday)</option><option value="MONTHLY">Monthly (1st)</option></Select></Field>
            <Field label="Period covered"><Select value={form.periodDays} onChange={(e) => setForm({ ...form, periodDays: Number(e.target.value) })}><option value={7}>Last 7 days</option><option value={28}>Last 28 days</option><option value={90}>Last 90 days</option></Select></Field>
          </div>
          <fieldset><legend className="text-xs font-semibold mb-1">Sections</legend>
            {Object.entries(SECTION_LABELS).map(([k, label]) => <label key={k} className="flex items-center gap-2 text-xs py-0.5"><input type="checkbox" checked={form.sections.includes(k)} onChange={() => setForm({ ...form, sections: toggle(form.sections, k) })} /> {label}</label>)}</fieldset>
          <fieldset><legend className="text-xs font-semibold mb-1">Recipients (internal users who can read every chosen section)</legend>
            <div className="max-h-40 overflow-auto">{recipients.map((r) => <label key={r.id} className="flex items-center gap-2 text-xs py-0.5"><input type="checkbox" checked={form.recipientIds.includes(r.id)} onChange={() => setForm({ ...form, recipientIds: toggle(form.recipientIds, r.id) })} /> {r.name} · {r.email} · {r.role}</label>)}</div></fieldset>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.dryRun} onChange={() => setForm({ ...form, dryRun: !form.dryRun })} /> Dry run (render and store only, deliver nothing) — recommended until you have checked a test report</label>
          {formError && <p className="text-xs text-rose-500" role="alert">{formError}</p>}
          <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" onClick={create} disabled={!form.name.trim() || form.sections.length === 0 || form.recipientIds.length === 0}>Create</Button></div>
        </div>
      </Modal>
      <ConfirmDialog open={!!del} title="Delete schedule" message={`Delete "${del?.name ?? ""}" and its run history? Reports already delivered stay with their recipients.`} confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => { const d = del!; setDel(null); void act(() => dashboardApi.deleteSchedule(d.id), "Schedule deleted."); }} />
    </div>
  );
};

export default ScheduledReportsPage;
