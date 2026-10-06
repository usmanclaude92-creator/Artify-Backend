/** Inbox settings: automation toggles (auto-reply OFF by default), SLA, retention, routing rules and canned replies. Editing needs an administrator. */
import React, { useCallback, useEffect, useState } from "react";
import { ShieldAlert, Trash2 } from "lucide-react";
import { socialInboxApi, type InboxCannedReply, type InboxPriority, type InboxRuleView, type InboxSettingsView } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { hasPermission } from "../../lib/permissions";
import { Badge, Button, Card, Input, LoadingState, Select } from "../ui/ui";

const errMsg = (e: unknown) => (e instanceof ApiClientError || e instanceof Error ? e.message : "Something went wrong.");
const csv = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

const Toggle: React.FC<{ label: string; hint: string; checked: boolean; disabled?: boolean; warn?: boolean; onChange: (v: boolean) => void }> = ({ label, hint, checked, disabled, warn, onChange }) => (
  <label className="flex items-start gap-3 py-2 cursor-pointer">
    <input type="checkbox" className="mt-0.5 w-4 h-4" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
    <span className="min-w-0">
      <span className="block text-xs font-bold" style={{ color: warn && checked ? "#b45309" : "var(--text-primary)" }}>{label}</span>
      <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>{hint}</span>
    </span>
  </label>
);

export const InboxSettingsPanel: React.FC<{ people: Array<{ id: string; name: string }>; onChanged: () => void }> = ({ people, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const isAdmin = user?.role.key === "ADMIN" || user?.role.key === "SUPER_ADMIN";
  const canManage = hasPermission(user?.role.permissions, "social.accounts.manage") && isAdmin;
  const canReply = hasPermission(user?.role.permissions, "social.reply");
  const [settings, setSettings] = useState<InboxSettingsView | null>(null);
  const [rules, setRules] = useState<InboxRuleView[]>([]);
  const [canned, setCanned] = useState<InboxCannedReply[]>([]);
  const [sla, setSla] = useState("60");
  const [retention, setRetention] = useState("180");
  const [rule, setRule] = useState({ name: "", keywords: "", intent: "", assignee: "", priority: "", tags: "" });
  const [reply, setReply] = useState({ title: "", body: "", keywords: "", auto: false });

  const load = useCallback(() => {
    socialInboxApi.settings().then((s) => { setSettings(s); setSla(String(s.firstResponseMinutes)); setRetention(String(s.retentionDays)); }).catch((e) => notify(errMsg(e), "error"));
    socialInboxApi.rules().then(setRules).catch(() => undefined);
    socialInboxApi.canned().then(setCanned).catch(() => undefined);
  }, [notify]);
  useEffect(load, [load]);

  const save = async (input: Partial<InboxSettingsView>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try { setSettings(await socialInboxApi.saveSettings(input)); notify("Inbox settings saved.", "success"); onChanged(); } catch (e) { notify(errMsg(e), "error"); }
  };
  const addRule = async () => {
    try {
      await socialInboxApi.saveRule(null, { name: rule.name, matchKeywords: csv(rule.keywords), matchIntents: rule.intent ? [rule.intent] : [], assigneeId: rule.assignee || null, setPriority: (rule.priority || null) as InboxPriority | null, addTags: csv(rule.tags) });
      setRule({ name: "", keywords: "", intent: "", assignee: "", priority: "", tags: "" }); notify("Rule added.", "success"); load();
    } catch (e) { notify(errMsg(e), "error"); }
  };
  const addCanned = async () => {
    try { await socialInboxApi.saveCanned(null, { title: reply.title, body: reply.body, matchKeywords: csv(reply.keywords), approvedForAuto: reply.auto }); setReply({ title: "", body: "", keywords: "", auto: false }); notify("Canned reply saved.", "success"); load(); onChanged(); } catch (e) { notify(errMsg(e), "error"); }
  };

  if (!settings) return <LoadingState />;
  return (
    <Card className="p-4 space-y-4" aria-label="Inbox settings">
      <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><ShieldAlert className="w-4 h-4" style={{ color: "var(--accent)" }} /> Inbox settings</h2>
      {!canManage && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Only workspace administrators can change these.</p>}
      <div className="divide-y" style={{ borderColor: "var(--border)" }}>
        <Toggle label="Auto-triage" hint="Classify new messages (intent, sentiment, priority) with AI." checked={settings.autoTriage} disabled={!canManage} onChange={(v) => save({ autoTriage: v })} />
        <Toggle label="Auto-draft replies" hint="Prepare an AI draft for new open items. Drafts are never sent without a person." checked={settings.autoDraft} disabled={!canManage} onChange={(v) => save({ autoDraft: v })} />
        <Toggle label="Auto-reply (low-risk only)" hint="OFF by default. Sends thank-yous and answers matched to approved canned replies — never complaints, leads or negative messages. Needs live publishing and respects the kill switch." checked={settings.autoReply} warn disabled={!canManage}
          onChange={(v) => save({ autoReply: v }, v ? "Turn on auto-reply? The system will reply on its own to thank-yous and approved FAQ questions." : undefined)} />
        <Toggle label="Auto-create leads" hint="Create (or link) a CRM lead when a message is classified as a lead." checked={settings.autoLead} disabled={!canManage} onChange={(v) => save({ autoLead: v })} />
      </div>
      <div className="flex gap-3 flex-wrap items-end">
        <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>First-response target (minutes)
          <Input type="number" min={5} value={sla} disabled={!canManage} onChange={(e) => setSla(e.target.value)} className="mt-1 w-32" aria-label="First-response target in minutes" /></label>
        <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>Keep messages for (days)
          <Input type="number" min={7} value={retention} disabled={!canManage} onChange={(e) => setRetention(e.target.value)} className="mt-1 w-32" aria-label="Retention in days" /></label>
        <Button disabled={!canManage || (Number(sla) === settings.firstResponseMinutes && Number(retention) === settings.retentionDays)} onClick={() => save({ firstResponseMinutes: Number(sla), retentionDays: Number(retention) })}>Save</Button>
        <p className="text-[11px] flex-1 basis-56" style={{ color: "var(--text-muted)" }}>Older messages (and empty conversations) are deleted automatically every day.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>Routing rules</h3>
        {rules.length === 0 && <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>No rules yet.</p>}
        {rules.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-[11px] flex-wrap" style={{ color: "var(--text-secondary)" }}>
            <strong>{r.name}</strong>
            <span>{[...r.matchKeywords.map((k) => `“${k}”`), ...r.matchIntents, ...r.matchSentiments].join(" · ")}</span>
            <span>→ {r.assigneeId ? (people.find((p) => p.id === r.assigneeId)?.name ?? "assignee") : "no assignee"}{r.setPriority ? ` · ${r.setPriority}` : ""}{r.addTags.length ? ` · #${r.addTags.join(" #")}` : ""}</span>
            {canManage && <button type="button" aria-label={`Delete rule ${r.name}`} onClick={() => socialInboxApi.deleteRule(r.id).then(load).catch((e) => notify(errMsg(e), "error"))}><Trash2 className="w-3.5 h-3.5" /></button>}
          </div>
        ))}
        {canManage && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <Input aria-label="Rule name" placeholder="Rule name" value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} />
            <Input aria-label="Rule keywords" placeholder="Keywords, comma separated" value={rule.keywords} onChange={(e) => setRule({ ...rule, keywords: e.target.value })} />
            <Select aria-label="Rule intent" value={rule.intent} onChange={(e) => setRule({ ...rule, intent: e.target.value })}><option value="">Any intent</option>{["question", "lead", "complaint", "praise", "support_request"].map((i) => <option key={i} value={i}>{i.replace("_", " ")}</option>)}</Select>
            <Select aria-label="Rule assignee" value={rule.assignee} onChange={(e) => setRule({ ...rule, assignee: e.target.value })}><option value="">No assignee</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <Select aria-label="Rule priority" value={rule.priority} onChange={(e) => setRule({ ...rule, priority: e.target.value })}><option value="">Keep priority</option>{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p}</option>)}</Select>
            <Button disabled={!rule.name.trim() || (!rule.keywords.trim() && !rule.intent)} onClick={addRule}>Add rule</Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>Canned replies</h3>
        {canned.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-[11px] flex-wrap" style={{ color: "var(--text-secondary)" }}>
            <strong>{r.title}</strong>{r.approvedForAuto && <Badge tone="info">Approved for auto-reply</Badge>}<span className="truncate max-w-[24rem]">{r.body}</span>
            {canReply && (!r.approvedForAuto || isAdmin) && <button type="button" aria-label={`Delete canned reply ${r.title}`} onClick={() => socialInboxApi.deleteCanned(r.id).then(() => { load(); onChanged(); }).catch((e) => notify(errMsg(e), "error"))}><Trash2 className="w-3.5 h-3.5" /></button>}
          </div>
        ))}
        {canReply && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Input aria-label="Canned reply title" placeholder="Title" value={reply.title} onChange={(e) => setReply({ ...reply, title: e.target.value })} />
            <Input aria-label="Canned reply text" placeholder="Reply text" value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} className="md:col-span-2" />
            <Input aria-label="Canned reply keywords" placeholder="Match keywords (auto-reply)" value={reply.keywords} onChange={(e) => setReply({ ...reply, keywords: e.target.value })} />
            <div className="flex items-center gap-2">
              {isAdmin && <label className="text-[11px] inline-flex items-center gap-1"><input type="checkbox" checked={reply.auto} onChange={(e) => setReply({ ...reply, auto: e.target.checked })} aria-label="Approve for auto-reply" /> Auto-reply</label>}
              <Button disabled={!reply.title.trim() || !reply.body.trim()} onClick={addCanned}>Save</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
