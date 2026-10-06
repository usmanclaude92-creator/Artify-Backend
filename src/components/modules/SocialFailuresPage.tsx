/** Publishing Failures: failed / uncertain / missed publishes with a redacted error, attempt timeline and recovery actions; plus publishing controls. */
import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, ShieldAlert } from "lucide-react";
import { socialPublishingApi, type PublishingSettingsView, type PublishingTarget, type PublishingTargetDetail } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { hasPermission } from "../../lib/permissions";
import { Card, Button, Input, Modal, LoadingState, ErrorState, EmptyState } from "../ui/ui";
import { ProviderAvatar } from "./socialShared";
import { zonedLocalToUtc } from "./socialPostShared";
import { OUTCOME_LABEL, PROVIDER_LABEL, TargetStatusBadge, splitError } from "./socialPublishingShared";
import { ModeBanner } from "./SocialQueuePage";

type Filter = "ALL" | "FAILED" | "UNCERTAIN" | "MISSED";
type Dialog = { kind: "retry" | "reschedule" | "manual" | "cancel"; target: PublishingTarget } | null;
const errMsg = (e: unknown) => (e instanceof ApiClientError || e instanceof Error ? e.message : "Something went wrong.");

const Toggle: React.FC<{ label: string; hint: string; checked: boolean; disabled?: boolean; danger?: boolean; onChange: (v: boolean) => void }> = ({ label, hint, checked, disabled, danger, onChange }) => (
  <label className="flex items-start gap-3 py-2 cursor-pointer">
    <input type="checkbox" className="mt-0.5 w-4 h-4" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
    <span className="min-w-0">
      <span className="block text-xs font-bold" style={{ color: danger && checked ? "#e11d48" : "var(--text-primary)" }}>{label}</span>
      <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>{hint}</span>
    </span>
  </label>
);

const SettingsPanel: React.FC<{ settings: PublishingSettingsView; canEdit: boolean; isSuper: boolean; onChanged: (s: PublishingSettingsView) => void }> = ({ settings, canEdit, isSuper, onChanged }) => {
  const { notify } = useToast();
  const [busy, setBusy] = useState(false);
  const [grace, setGrace] = useState(String(settings.workspace.graceMinutes));
  useEffect(() => setGrace(String(settings.workspace.graceMinutes)), [settings.workspace.graceMinutes]);
  const w = settings.workspace;

  const save = async (input: Parameters<typeof socialPublishingApi.saveSettings>[0], confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try { onChanged(await socialPublishingApi.saveSettings(input)); notify("Publishing settings saved.", "success"); } catch (e) { notify(errMsg(e), "error"); } finally { setBusy(false); }
  };
  const saveGlobal = async (input: Parameters<typeof socialPublishingApi.saveGlobal>[0], confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try { onChanged(await socialPublishingApi.saveGlobal(input)); notify("Global publishing settings saved.", "success"); } catch (e) { notify(errMsg(e), "error"); } finally { setBusy(false); }
  };

  return (
    <Card className="p-4 space-y-2" aria-label="Publishing settings">
      <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><ShieldAlert className="w-4 h-4" style={{ color: "var(--accent)" }} /> Publishing controls</h2>
      {!canEdit && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Only workspace administrators can change these.</p>}
      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        <Toggle label="Publishing enabled" hint="Off by default. When off, nothing is ever sent for this workspace." checked={w.enabled} disabled={!canEdit || busy}
          onChange={(v) => save({ enabled: v }, v && !w.dryRun ? "Publishing is not in dry-run mode: due posts will be sent to the real network. Enable?" : undefined)} />
        <Toggle label="Dry-run mode" hint="Runs everything except the final send; attempts are logged as “Dry run”. Recommended for the first tests." checked={w.dryRun} disabled={!canEdit || busy}
          onChange={(v) => save({ dryRun: v }, !v && w.enabled ? "Turn dry-run OFF? Due posts will be sent to the real network." : undefined)} />
        <Toggle label="Kill switch" hint="Stops all publishing for this workspace immediately — checked before every attempt." checked={w.killSwitch} danger disabled={!canEdit || busy} onChange={(v) => save({ killSwitch: v })} />
      </div>
      <div className="flex items-end gap-2 pt-2 flex-wrap">
        <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
          Grace window (minutes)
          <Input type="number" min={5} max={1440} value={grace} disabled={!canEdit || busy} onChange={(e) => setGrace(e.target.value)} className="mt-1 w-28" aria-label="Grace window in minutes" />
        </label>
        <Button variant="secondary" disabled={!canEdit || busy || Number(grace) === w.graceMinutes || !(Number(grace) >= 5)} onClick={() => save({ graceMinutes: Number(grace) })}>Save</Button>
        <p className="text-[11px] flex-1 basis-56" style={{ color: "var(--text-muted)" }}>Posts that miss their slot by more than this are marked “Missed” instead of being sent late.</p>
      </div>
      {isSuper && (
        <div className="pt-3 mt-2 border-t space-y-1" style={{ borderColor: "var(--border)" }}>
          <p className="text-[11px] font-bold uppercase" style={{ color: "var(--text-muted)" }}>Platform-wide (super admin)</p>
          <Toggle label="Publishing enabled (global)" hint="Master switch for every workspace." checked={settings.global.enabled} disabled={busy} onChange={(v) => saveGlobal({ enabled: v })} />
          <Toggle label="Dry-run (global)" hint="Forces dry-run everywhere." checked={settings.global.dryRun} disabled={busy} onChange={(v) => saveGlobal({ dryRun: v })} />
          <Toggle label="Kill switch (global)" hint="Stops publishing for all workspaces." checked={settings.global.killSwitch} danger disabled={busy} onChange={(v) => saveGlobal({ killSwitch: v })} />
        </div>
      )}
    </Card>
  );
};

const Timeline: React.FC<{ id: string }> = ({ id }) => {
  const [detail, setDetail] = useState<PublishingTargetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { socialPublishingApi.target(id).then(setDetail).catch((e) => setError(errMsg(e))); }, [id]);
  if (error) return <p className="text-[11px] text-rose-500">{error}</p>;
  if (!detail) return <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Loading attempts…</p>;
  if (detail.attemptLog.length === 0) return <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>No attempts were made.</p>;
  return (
    <ol className="space-y-1.5" aria-label="Attempt timeline">
      {detail.attemptLog.map((a) => (
        <li key={a.id} className="text-[11px] rounded-lg p-2" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>
          <span className="font-bold" style={{ color: "var(--text-primary)" }}>#{a.attemptNumber} · {a.outcome ? OUTCOME_LABEL[a.outcome] : "In progress"}</span>
          <span> · {new Date(a.startedAt).toLocaleString()}{a.durationMs !== null ? ` · ${a.durationMs} ms` : ""}{a.httpStatus ? ` · HTTP ${a.httpStatus}` : ""}</span>
          {a.error && <span className="block break-words">{a.error}</span>}
          {a.externalUrl && <a href={a.externalUrl} target="_blank" rel="noopener noreferrer" className="underline break-all">{a.externalUrl}</a>}
        </li>
      ))}
    </ol>
  );
};

export const SocialFailuresPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { current } = useActiveWorkspace();
  const canPublish = hasPermission(user?.role.permissions, "social.publish");
  const canManage = hasPermission(user?.role.permissions, "social.accounts.manage") && (user?.role.key === "ADMIN" || user?.role.key === "SUPER_ADMIN");
  const isSuper = user?.role.key === "SUPER_ADMIN";

  const [items, setItems] = useState<PublishingTarget[] | null>(null);
  const [settings, setSettings] = useState<PublishingSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [confirmNotPosted, setConfirmNotPosted] = useState(false);
  const [when, setWhen] = useState("");
  const [url, setUrl] = useState("");

  const load = useCallback(() => {
    Promise.all([socialPublishingApi.failures(), socialPublishingApi.settings()])
      .then(([f, s]) => { setItems(f); setSettings(s); setError(null); })
      .catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(() => { setItems(null); load(); }, [load, current?.organizationId]);

  const openDialog = (kind: NonNullable<Dialog>["kind"], target: PublishingTarget) => { setConfirmNotPosted(false); setWhen(""); setUrl(""); setDialog({ kind, target }); };
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); notify(done, "success"); setDialog(null); load(); } catch (e) { notify(errMsg(e), "error"); } finally { setBusy(false); }
  };

  const visible = (items ?? []).filter((t) => filter === "ALL" || t.status === filter);
  const count = (s: Filter) => (items ?? []).filter((t) => s === "ALL" || t.status === s).length;
  const d = dialog?.target;
  const uncertain = d?.status === "UNCERTAIN";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <AlertTriangle className="w-5 h-5" style={{ color: "var(--accent)" }} /> Publishing Failures
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>Posts that failed, missed their slot or have an unknown outcome. Nothing here is retried automatically except temporary errors.</p>
      </div>

      {error ? <ErrorState message={error} /> : items === null || !settings ? <LoadingState /> : (
        <>
          <ModeBanner settings={settings} />
          <SettingsPanel settings={settings} canEdit={canManage} isSuper={isSuper} onChanged={setSettings} />

          <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Filter failures">
            {(["ALL", "FAILED", "UNCERTAIN", "MISSED"] as Filter[]).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className="px-3 py-1.5 rounded-full text-[11px] font-semibold border"
                style={{ background: filter === f ? "var(--accent)" : "var(--bg-hover)", color: filter === f ? "#fff" : "var(--text-secondary)", borderColor: "var(--border)" }}>
                {f === "ALL" ? "All" : f === "UNCERTAIN" ? "Needs a check" : f.charAt(0) + f.slice(1).toLowerCase()} ({count(f)})
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <Card><EmptyState title="No failures" description="Failed, missed and uncertain publishes appear here." /></Card>
          ) : (
            <div className="space-y-3">
              {visible.map((t) => {
                const { category, message } = splitError(t.error);
                const isDry = category === "dry_run";
                const expanded = open === t.id;
                return (
                  <Card key={t.id} className="p-3 space-y-2">
                    <div className="flex items-start gap-3 flex-wrap">
                      <ProviderAvatar account={t.account} />
                      <div className="min-w-0 flex-1 basis-52">
                        <p className="text-xs font-bold truncate" style={{ color: "var(--text-primary)" }}>{t.post.title}</p>
                        <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                          {t.account.displayName} · {PROVIDER_LABEL[t.account.provider] ?? t.account.provider} · was due {t.scheduledAt ? new Date(t.scheduledAt).toLocaleString() : "—"} · {t.attempts} attempt{t.attempts === 1 ? "" : "s"}
                        </p>
                      </div>
                      <TargetStatusBadge status={t.status} dryRun={isDry} />
                    </div>
                    {message && <p className="text-[11px] break-words rounded-lg p-2" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }}>{message}</p>}
                    {t.account.status !== "CONNECTED" && <p className="text-[11px]" style={{ color: "#b45309" }}>This account is {t.account.status.toLowerCase().replace("_", " ")} — reconnect it under Connected Accounts first.</p>}
                    <div className="flex gap-2 flex-wrap items-center">
                      <button type="button" onClick={() => setOpen(expanded ? null : t.id)} aria-expanded={expanded} className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: "var(--text-secondary)" }}>
                        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Attempt timeline
                      </button>
                      <span className="flex-1" />
                      {canPublish && (
                        <>
                          <Button variant="primary" onClick={() => openDialog("retry", t)}>Retry now</Button>
                          <Button onClick={() => openDialog("reschedule", t)}>Reschedule</Button>
                          <Button onClick={() => openDialog("manual", t)}>Mark as published</Button>
                          <Button variant="ghost" onClick={() => openDialog("cancel", t)}>Cancel</Button>
                        </>
                      )}
                    </div>
                    {expanded && <Timeline id={t.id} />}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal open={dialog?.kind === "retry"} onClose={() => setDialog(null)} title="Retry now">
        <div className="space-y-3 text-xs" style={{ color: "var(--text-secondary)" }}>
          <p>Try publishing “{d?.post.title}” to {d?.account.displayName} again. The safety switches still apply.</p>
          {uncertain && (
            <label className="flex items-start gap-2 font-semibold"><input type="checkbox" checked={confirmNotPosted} onChange={(e) => setConfirmNotPosted(e.target.checked)} className="mt-0.5" aria-label="Confirm the post is not on the network" />
              I checked {d?.account.displayName}: the post is NOT there. (Otherwise it could be published twice.)</label>
          )}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDialog(null)}>Close</Button><Button variant="primary" disabled={busy || (uncertain && !confirmNotPosted)} onClick={() => run(() => socialPublishingApi.retry(d!.id, uncertain ? confirmNotPosted : undefined), "Retry started.")}>Retry now</Button></div>
        </div>
      </Modal>

      <Modal open={dialog?.kind === "reschedule"} onClose={() => setDialog(null)} title="Reschedule">
        <div className="space-y-3 text-xs" style={{ color: "var(--text-secondary)" }}>
          <label className="block font-semibold">New date and time ({d?.post.timezone})
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1" aria-label="New publish time" /></label>
          {uncertain && (
            <label className="flex items-start gap-2 font-semibold"><input type="checkbox" checked={confirmNotPosted} onChange={(e) => setConfirmNotPosted(e.target.checked)} className="mt-0.5" aria-label="Confirm the post is not on the network" />
              I checked {d?.account.displayName}: the post is NOT there.</label>
          )}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDialog(null)}>Close</Button>
            <Button variant="primary" disabled={busy || !when || (uncertain && !confirmNotPosted)} onClick={() => run(() => socialPublishingApi.reschedule(d!.id, zonedLocalToUtc(when, d!.post.timezone).toISOString(), uncertain ? confirmNotPosted : undefined), "Rescheduled.")}>Reschedule</Button></div>
        </div>
      </Modal>

      <Modal open={dialog?.kind === "manual"} onClose={() => setDialog(null)} title="Mark as published manually">
        <div className="space-y-3 text-xs" style={{ color: "var(--text-secondary)" }}>
          <p>If you posted this yourself, or confirmed it is live, paste the link to the post.</p>
          <label className="block font-semibold">Link to the live post
            <Input type="url" placeholder="https://www.linkedin.com/feed/update/…" value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1" aria-label="Link to the live post" /></label>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDialog(null)}>Close</Button>
            <Button variant="primary" disabled={busy || !/^https:\/\//.test(url.trim())} onClick={() => run(() => socialPublishingApi.markPublished(d!.id, url.trim()), "Marked as published.")}>Mark as published</Button></div>
        </div>
      </Modal>

      <Modal open={dialog?.kind === "cancel"} onClose={() => setDialog(null)} title="Cancel this publish">
        <div className="space-y-3 text-xs" style={{ color: "var(--text-secondary)" }}>
          <p>“{d?.post.title}” will not be published to {d?.account.displayName}. This cannot be undone from here.</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDialog(null)}>Keep it</Button>
            <Button variant="danger" disabled={busy} onClick={() => run(() => socialPublishingApi.cancel(d!.id), "Cancelled.")}>Cancel publish</Button></div>
        </div>
      </Modal>
    </div>
  );
};

export const LiveLink: React.FC<{ url: string }> = ({ url }) => (
  <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold underline" style={{ color: "var(--accent)" }}>View live post <ExternalLink className="w-3 h-3" aria-hidden="true" /></a>
);
