/** Unified Inbox: comments, DMs, mentions and reviews. Two panes on desktop, one column on phones. AI drafts are always reviewed and sent by a person. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, EyeOff, Inbox, Send, Settings2, ShieldAlert, Sparkles, UserPlus } from "lucide-react";
import { socialApi, socialInboxApi, type InboxConversation, type InboxListParams, type InboxMessage, type InboxMetrics, type InboxPriority, type InboxStatus, type InboxTriage, type InboxCannedReply, type SocialAccountSummary } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { hasPermission } from "../../lib/permissions";
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Select } from "../ui/ui";
import { ProviderAvatar } from "./socialShared";
import { ConversationBadges, PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL, displayName, formatDuration, shortAgo } from "./socialInboxShared";
import { InboxSettingsPanel } from "./SocialInboxSettings";

const errMsg = (e: unknown) => (e instanceof ApiClientError || e instanceof Error ? e.message : "Something went wrong.");
const PRIORITIES: InboxPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
const STATUSES: InboxStatus[] = ["OPEN", "PENDING", "RESOLVED", "SPAM"];

const Stat: React.FC<{ label: string; value: string | number; tone?: "danger" | "warning" }> = ({ label, value, tone }) => (
  <div>
    <p className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>{label}</p>
    <p className="text-lg font-bold" style={{ color: tone === "danger" ? "#f43f5e" : tone === "warning" ? "#f59e0b" : "var(--text-primary)" }}>{value}</p>
  </div>
);

const Thread: React.FC<{ messages: InboxMessage[]; canReply: boolean; isComment: boolean; onHide: (m: InboxMessage) => void; onRetry: (m: InboxMessage) => void }> = ({ messages, canReply, isComment, onHide, onRetry }) => (
  <ol className="space-y-2" aria-label="Conversation thread">
    {messages.filter((m) => !(m.authorKind === "AI_DRAFT" && m.sendStatus === "DRAFT")).map((m) => {
      const mine = m.direction === "OUTBOUND";
      const note = m.authorKind === "NOTE";
      return (
        <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
          <div className="max-w-[85%] rounded-2xl px-3 py-2 text-xs space-y-1" style={{ background: note ? "rgba(245,158,11,0.15)" : mine ? "var(--accent-soft)" : "var(--bg-hover)", color: "var(--text-primary)", border: m.sendStatus === "FAILED" || m.sendStatus === "UNCERTAIN" ? "1px solid #e11d48" : "1px solid transparent", opacity: m.hidden ? 0.6 : 1 }}>
            {note && <p className="text-[10px] font-bold uppercase" style={{ color: "#b45309" }}>Internal note — not sent</p>}
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <p className="text-[10px] flex gap-2 flex-wrap items-center" style={{ color: "var(--text-muted)" }}>
              <span>{new Date(m.createdAt).toLocaleString()}</span>
              {m.autoSent && <Badge tone="info">Auto-reply</Badge>}
              {m.hidden && <Badge tone="neutral">Hidden</Badge>}
              {m.sendStatus === "FAILED" && <Badge tone="danger">Not sent</Badge>}
              {m.sendStatus === "UNCERTAIN" && <Badge tone="warning">Unknown outcome</Badge>}
            </p>
            {(m.sendStatus === "FAILED" || m.sendStatus === "UNCERTAIN") && m.sendError && <p className="text-[11px] text-rose-500 break-words">{m.sendError.replace(/^[a-z_]+: /, "")}</p>}
            <div className="flex gap-2">
              {canReply && !mine && isComment && <button type="button" className="text-[11px] underline inline-flex items-center gap-1" onClick={() => onHide(m)}><EyeOff className="w-3 h-3" aria-hidden="true" />{m.hidden ? "Unhide" : "Hide comment"}</button>}
              {canReply && (m.sendStatus === "FAILED" || m.sendStatus === "UNCERTAIN") && <button type="button" className="text-[11px] underline" onClick={() => onRetry(m)}>Retry sending</button>}
            </div>
          </div>
        </li>
      );
    })}
  </ol>
);

const TriageSummary: React.FC<{ t: InboxTriage }> = ({ t }) => (
  <div className="rounded-xl p-2 text-[11px] flex gap-2 flex-wrap items-center" style={{ background: "var(--bg-hover)", color: "var(--text-secondary)" }} aria-label="AI triage">
    <Bot className="w-3.5 h-3.5" aria-hidden="true" />
    <span>Intent <strong>{t.intent.replace("_", " ")}</strong></span>
    <span>· Sentiment <strong>{t.sentiment}</strong></span>
    {t.language && <span>· {t.language.toUpperCase()}</span>}
    {t.confidence !== null && <span>· confidence {Math.round(t.confidence * 100)}%</span>}
    {t.source === "FALLBACK" && <Badge tone="warning">AI unavailable — review manually</Badge>}
    {t.source === "RULE_PREFILTER" && <Badge tone="neutral">Caught by spam filter</Badge>}
    {t.flaggedForHuman && <Badge tone="warning"><span className="inline-flex items-center gap-1"><ShieldAlert className="w-3 h-3" aria-hidden="true" />Needs a human</span></Badge>}
  </div>
);

interface DetailProps { id: string; canReply: boolean; people: Array<{ id: string; name: string }>; canned: InboxCannedReply[]; onChanged: () => void; onBack: () => void; narrow: boolean }

const ConversationView: React.FC<DetailProps> = ({ id, canReply, people, canned, onChanged, onBack, narrow }) => {
  const { notify } = useToast();
  const [data, setData] = useState<Awaited<ReturnType<typeof socialInboxApi.get>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftInfo, setDraftInfo] = useState<{ confidence: number | null; issues: Array<{ severity: string; message: string }>; passed: boolean } | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmNotSent, setConfirmNotSent] = useState(false);

  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const load = useCallback(() => {
    socialInboxApi.get(id).then((d) => {
      setData(d); setError(null);
      const draft = d.messages.find((m) => m.authorKind === "AI_DRAFT" && m.sendStatus === "DRAFT");
      if (draft) { setDraftId(draft.id); setText((cur) => cur || draft.body); setDraftInfo({ confidence: draft.aiConfidence, issues: draft.guardrailResult?.issues ?? [], passed: draft.guardrailResult?.passed ?? true }); }
      if (!d.conversation.isRead) socialInboxApi.markRead(id, true).then(() => onChangedRef.current()).catch(() => undefined);
    }).catch((e) => setError(errMsg(e)));
  }, [id]);
  useEffect(() => { setData(null); setText(""); setDraftId(null); setDraftInfo(null); setNoteMode(false); setConfirmNotSent(false); load(); }, [id, load]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); if (done) notify(done, "success"); load(); onChangedRef.current(); } catch (e) { notify(errMsg(e), "error"); } finally { setBusy(false); }
  };

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;
  const c = data.conversation;
  const uncertain = data.messages.find((m) => m.sendStatus === "UNCERTAIN");

  const generate = () => act(async () => {
    const d = await socialInboxApi.draft(id);
    setDraftId(d.messageId); setText(d.body); setDraftInfo({ confidence: d.confidence, issues: d.guardrail.issues, passed: d.guardrail.passed });
  }, "Draft ready — review it before sending.");
  const send = (resolve: boolean) => act(async () => {
    if (noteMode) { await socialInboxApi.note(id, text); setText(""); setNoteMode(false); return; }
    if (draftId) await socialInboxApi.editDraft(draftId, text);
    const m = await socialInboxApi.reply(id, { ...(draftId ? { messageId: draftId } : { body: text }), resolve });
    if (m.sendStatus === "SENT") { setText(""); setDraftId(null); setDraftInfo(null); } else throw new Error(m.sendError?.replace(/^[a-z_]+: /, "") ?? "The reply was not sent.");
  }, noteMode ? "Note added." : "Reply sent.");
  const retry = (m: InboxMessage) => act(async () => {
    const res = await socialInboxApi.reply(id, { messageId: m.id, confirmNotSent: m.sendStatus === "UNCERTAIN" ? confirmNotSent : undefined });
    if (res.sendStatus !== "SENT") throw new Error(res.sendError?.replace(/^[a-z_]+: /, "") ?? "The reply was not sent.");
  }, "Reply sent.");
  const lead = () => act(async () => {
    const h = await socialInboxApi.createLead(id);
    notify(h.outcome === "created" ? "Lead created." : h.outcome === "linked_lead" ? "Linked to an existing lead." : "Linked to an existing contact.", "success");
  });

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 flex-wrap">
        {narrow && <Button variant="ghost" onClick={onBack} aria-label="Back to the list"><ArrowLeft className="w-4 h-4" /></Button>}
        <ProviderAvatar account={{ displayName: displayName(c), avatarUrl: null }} />
        <div className="min-w-0 flex-1 basis-40">
          <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{displayName(c)}</p>
          <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{c.participant.handle ?? ""} · {TYPE_LABEL[c.type]} on {c.account.displayName}</p>
          <ConversationBadges c={c} />
        </div>
      </div>

      {canReply && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Select aria-label="Status" value={c.status} disabled={busy} onChange={(e) => act(() => socialInboxApi.setStatus(id, e.target.value as InboxStatus))}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
          <Select aria-label="Priority" value={c.priority} disabled={busy} onChange={(e) => act(() => socialInboxApi.setPriority(id, e.target.value as InboxPriority))}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select>
          <Select aria-label="Assignee" value={c.assigneeId ?? ""} disabled={busy} onChange={(e) => act(() => socialInboxApi.assign(id, e.target.value || null))}><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          {c.leadId || c.contactId ? <Badge tone="success">{c.leadId ? "Lead linked" : "Contact linked"}</Badge> : <Button disabled={busy} onClick={lead}><UserPlus className="w-3.5 h-3.5" aria-hidden="true" /> Create lead</Button>}
        </div>
      )}
      {data.triage && <TriageSummary t={data.triage} />}
      <Card className="p-3 max-h-[46vh] overflow-y-auto"><Thread messages={data.messages} canReply={canReply} isComment={c.type === "COMMENT"} onHide={(m) => act(() => socialInboxApi.hide(m.id, !m.hidden))} onRetry={retry} /></Card>
      {uncertain && canReply && (
        <label className="flex items-start gap-2 text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={confirmNotSent} onChange={(e) => setConfirmNotSent(e.target.checked)} className="mt-0.5" aria-label="Confirm the reply is not on the network" />
          I checked the account: the unsent reply is NOT visible there. (Required to retry an unknown outcome.)
        </label>
      )}

      {canReply && c.status !== "SPAM" && (
        <Card className="p-3 space-y-2" aria-label="Reply">
          {draftInfo && !noteMode && (
            <div className="text-[11px] space-y-1" style={{ color: "var(--text-secondary)" }}>
              <p className="flex items-center gap-2 flex-wrap"><Sparkles className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} aria-hidden="true" /> AI draft — a person must send it.
                {draftInfo.confidence !== null && <Badge tone={draftInfo.confidence >= 0.8 ? "success" : "warning"}>Confidence {Math.round(draftInfo.confidence * 100)}%</Badge>}
                <Badge tone={draftInfo.passed ? "success" : "danger"}>{draftInfo.passed ? "Guardrails passed" : "Guardrails failed"}</Badge></p>
              {draftInfo.issues.map((i, k) => <p key={k} style={{ color: i.severity === "block" ? "#e11d48" : "#b45309" }}>{i.message}</p>)}
            </div>
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label={noteMode ? "Internal note" : "Reply text"} placeholder={noteMode ? "Internal note (never sent to the customer)…" : "Write a reply…"}
            className="w-full rounded-xl p-2 text-xs" style={{ background: noteMode ? "rgba(245,158,11,0.12)" : "var(--bg-hover)", color: "var(--text-primary)", border: "1px solid var(--border)" }} />
          <div className="flex gap-2 flex-wrap items-center">
            <Button disabled={busy} onClick={generate}><Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> {draftId ? "Regenerate draft" : "AI draft"}</Button>
            <Select aria-label="Insert canned reply" value="" onChange={(e) => { const r = canned.find((x) => x.id === e.target.value); if (r) { setText(r.body); setDraftId(null); setDraftInfo(null); setNoteMode(false); } }} className="max-w-[11rem]">
              <option value="">Canned reply…</option>{canned.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select>
            <label className="text-[11px] inline-flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}><input type="checkbox" checked={noteMode} onChange={(e) => setNoteMode(e.target.checked)} aria-label="Internal note" /> Internal note</label>
            <span className="flex-1" />
            {noteMode ? <Button variant="primary" disabled={busy || !text.trim()} onClick={() => send(false)}>Add note</Button> : (
              <>
                <Button disabled={busy || !text.trim()} onClick={() => send(true)}>Send &amp; resolve</Button>
                <Button variant="primary" disabled={busy || !text.trim()} onClick={() => send(false)}><Send className="w-3.5 h-3.5" aria-hidden="true" /> Send</Button>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
};

export const SocialInboxPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { current } = useActiveWorkspace();
  const canReply = hasPermission(user?.role.permissions, "social.reply");
  const [filters, setFilters] = useState<InboxListParams>({ status: "OPEN" });
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<InboxConversation[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<InboxMetrics | null>(null);
  const [accounts, setAccounts] = useState<SocialAccountSummary[]>([]);
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [canned, setCanned] = useState<InboxCannedReply[]>([]);
  const [selected, setSelected] = useState<string | null>(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("conversation") : null));
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = useCallback(() => {
    socialInboxApi.list({ ...filters, search: search.trim() || undefined, limit: 50 }).then((r) => { setItems(r.conversations); setTotal(r.total); setError(null); }).catch((e) => setError(errMsg(e)));
    socialInboxApi.metrics().then(setMetrics).catch(() => setMetrics(null));
  }, [filters, search]);
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search, current?.organizationId]);
  useEffect(() => { const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    socialApi.list().then((r) => setAccounts(r.accounts)).catch(() => undefined);
    socialInboxApi.assignees().then(setPeople).catch(() => undefined);
    socialInboxApi.canned().then(setCanned).catch(() => undefined);
  }, [current?.organizationId]);

  const open = (id: string | null) => { setSelected(id); try { window.history.replaceState({}, "", id ? `/social/inbox?conversation=${id}` : "/social/inbox"); } catch { /* ignore */ } };
  const set = (patch: Partial<InboxListParams>) => setFilters((f) => ({ ...f, ...patch }));
  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = async (patch: Parameters<typeof socialInboxApi.bulk>[1]) => {
    try { const r = await socialInboxApi.bulk([...checked], patch); notify(`${r.updated} updated.`, "success"); setChecked(new Set()); load(); } catch (e) { notify(errMsg(e), "error"); }
  };
  const showList = !narrow || !selected;
  const showDetail = !narrow || !!selected;
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><Inbox className="w-5 h-5" style={{ color: "var(--accent)" }} /> Inbox</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Comments, messages and mentions from your connected accounts. AI suggests; people reply.</p>
        </div>
        <div className="flex gap-4 items-center flex-wrap">
          {metrics && <><Stat label="Open" value={metrics.open} /><Stat label="Overdue" value={metrics.overdue} tone={metrics.overdue ? "danger" : undefined} /><Stat label="Unassigned" value={metrics.unassigned} tone={metrics.unassigned ? "warning" : undefined} /><Stat label="Median first reply" value={formatDuration(metrics.medianFirstResponseMs)} /></>}
          <Button variant="secondary" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}><Settings2 className="w-3.5 h-3.5" aria-hidden="true" /> Settings</Button>
        </div>
      </div>

      {showSettings && <InboxSettingsPanel people={people} onChanged={() => { socialInboxApi.canned().then(setCanned).catch(() => undefined); load(); }} />}

      <Card className="p-3 grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-2" aria-label="Filters">
        <Select aria-label="Filter by status" value={filters.status ?? ""} onChange={(e) => set({ status: (e.target.value || undefined) as InboxStatus | undefined })}><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
        <Select aria-label="Filter by account" value={filters.accountId ?? ""} onChange={(e) => set({ accountId: e.target.value || undefined })}><option value="">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}</Select>
        <Select aria-label="Filter by type" value={filters.type ?? ""} onChange={(e) => set({ type: (e.target.value || undefined) as InboxListParams["type"] })}><option value="">All types</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select aria-label="Filter by assignee" value={filters.assignee ?? ""} onChange={(e) => set({ assignee: e.target.value || undefined })}><option value="">Anyone</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select aria-label="Filter by priority" value={filters.priority ?? ""} onChange={(e) => set({ priority: (e.target.value || undefined) as InboxPriority | undefined })}><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select>
        <Select aria-label="Filter by sentiment" value={filters.sentiment ?? ""} onChange={(e) => set({ sentiment: e.target.value || undefined })}><option value="">Any sentiment</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></Select>
        <Input aria-label="Search the inbox" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="col-span-2 md:col-span-1" />
        <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--text-secondary)" }}>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!filters.unread} onChange={(e) => set({ unread: e.target.checked || undefined })} aria-label="Unread only" /> Unread</label>
          <label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!filters.overdue} onChange={(e) => set({ overdue: e.target.checked || undefined })} aria-label="Overdue only" /> Overdue</label>
        </div>
      </Card>

      {error ? <ErrorState message={error} /> : items === null ? <LoadingState /> : (
        <div className={`grid gap-3 ${narrow ? "grid-cols-1" : "grid-cols-[minmax(320px,2fr)_3fr]"}`}>
          {showList && (
            <Card className="overflow-hidden" aria-label="Conversations">
              {canReply && checked.size > 0 && (
                <div className="p-2 flex gap-2 flex-wrap items-center border-b" style={{ borderColor: "var(--border)", background: "var(--bg-hover)" }} role="toolbar" aria-label="Bulk actions">
                  <span className="text-[11px] font-bold">{checked.size} selected</span>
                  <Button onClick={() => bulk({ status: "RESOLVED" })}>Resolve</Button>
                  <Button onClick={() => bulk({ status: "SPAM" })}>Spam</Button>
                  <Button onClick={() => bulk({ markRead: true })}>Mark read</Button>
                  <Select aria-label="Assign selected to" value="" onChange={(e) => e.target.value && bulk({ assigneeId: e.target.value === "none" ? null : e.target.value })} className="max-w-[10rem]"><option value="">Assign to…</option><option value="none">Unassign</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                </div>
              )}
              {items.length === 0 ? <EmptyState title="Nothing here" description="New comments and messages from your connected accounts appear here." /> : (
                <ul className="divide-y max-h-[70vh] overflow-y-auto" style={{ borderColor: "var(--border)" }}>
                  {items.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 p-2" style={{ background: selected === c.id ? "var(--accent-soft)" : undefined }}>
                      {canReply && <input type="checkbox" className="mt-3" checked={checked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${displayName(c)}`} />}
                      <button type="button" className="cc-row flex-1 min-w-0 text-left py-1 space-y-1" onClick={() => open(c.id)} aria-current={selected === c.id}>
                        <span className="flex items-center gap-2">
                          <span className={`text-xs truncate ${c.isRead ? "font-semibold" : "font-bold"}`} style={{ color: "var(--text-primary)" }}>{!c.isRead && <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: "var(--accent)" }} aria-label="Unread" />}{displayName(c)}</span>
                          <span className="ml-auto text-[10px] shrink-0" style={{ color: c.overdue ? "#f43f5e" : "var(--text-muted)" }}>{shortAgo(c.lastMessageAt)}</span>
                        </span>
                        <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{c.preview}</span>
                        <span className="flex items-center gap-1 flex-wrap"><ConversationBadges c={c} />{c.assigneeId && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>→ {peopleById.get(c.assigneeId) ?? "assigned"}</span>}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="p-2 text-[10px]" style={{ color: "var(--text-muted)" }}>{total} conversation{total === 1 ? "" : "s"}</p>
            </Card>
          )}
          {showDetail && (
            <div>
              {selected ? <ConversationView id={selected} canReply={canReply} people={people} canned={canned} onChanged={load} onBack={() => open(null)} narrow={narrow} /> : (
                <Card><EmptyState title="Select a conversation" description="Pick one from the list to read the thread, review the AI draft and reply." /></Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
