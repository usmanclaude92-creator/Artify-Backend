/** Social Listening: what Meta sends or lists for OUR accounts (@mentions, photo tags, posts that tag the Page, visitor posts). Not a search over public posts. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ear, ExternalLink } from "lucide-react";
import { socialApi, socialInboxApi, socialListeningApi, type InboxCannedReply, type InboxStatus, type ListeningItem, type ListeningParams, type ListeningSummary, type SocialAccountSummary } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { hasPermission } from "../../lib/permissions";
import { Badge, Card, EmptyState, ErrorState, Input, LoadingState, Select } from "../ui/ui";
import { ProviderAvatar } from "./socialShared";
import { PRIORITY_LABEL, STATUS_LABEL, shortAgo } from "./socialInboxShared";
import { providerLabel } from "./socialAnalyticsShared";
import { ConversationView } from "./SocialInboxPage";

const STATUSES: InboxStatus[] = ["OPEN", "PENDING", "RESOLVED", "SPAM"];
const errMsg = (e: unknown) => (e instanceof ApiClientError || e instanceof Error ? e.message : "Something went wrong.");

const Stat: React.FC<{ label: string; value: number; tone?: "danger" | "warning" }> = ({ label, value, tone }) => (
  <div>
    <p className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>{label}</p>
    <p className="text-lg font-bold" style={{ color: tone === "danger" && value ? "#f43f5e" : tone === "warning" && value ? "#f59e0b" : "var(--text-primary)" }}>{value}</p>
  </div>
);

export const ListeningBadges: React.FC<{ item: ListeningItem }> = ({ item }) => (
  <span className="flex gap-1 flex-wrap items-center">
    {item.crisis && <Badge tone="danger">Crisis words</Badge>}
    {item.sentiment === "negative" && <Badge tone="danger">Negative</Badge>}
    {item.sentiment === "positive" && <Badge tone="success">Positive</Badge>}
    {item.topic && <Badge tone="info">{item.topic}</Badge>}
    {(item.priority === "HIGH" || item.priority === "URGENT") && <Badge tone="warning">{PRIORITY_LABEL[item.priority]}</Badge>}
    {item.status !== "OPEN" && <Badge tone="neutral">{STATUS_LABEL[item.status]}</Badge>}
    {item.status === "OPEN" && !item.assigneeId && <Badge tone="info">Unassigned</Badge>}
    {item.replyMode === "platform" && <Badge tone="neutral">Reply on the platform</Badge>}
    {!item.triaged && <Badge tone="neutral">Not analysed yet</Badge>}
    {(item.leadId || item.contactId) && <Badge tone="success">In CRM</Badge>}
  </span>
);

export const SocialListeningPage: React.FC = () => {
  const { user } = useAuth();
  const { current } = useActiveWorkspace();
  const canWork = hasPermission(user?.role.permissions, "social.reply");
  const [filters, setFilters] = useState<ListeningParams>({ status: "OPEN" });
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<ListeningItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ListeningSummary | null>(null);
  const [topics, setTopics] = useState<Array<{ topic: string; count: number }>>([]);
  const [accounts, setAccounts] = useState<SocialAccountSummary[]>([]);
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [canned, setCanned] = useState<InboxCannedReply[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = useCallback(() => {
    socialListeningApi.list({ ...filters, search: search.trim() || undefined, limit: 50 }).then((r) => { setItems(r.items); setTotal(r.total); setError(null); }).catch((e) => setError(errMsg(e)));
    socialListeningApi.summary().then(setSummary).catch(() => setSummary(null));
    socialListeningApi.topics().then(setTopics).catch(() => setTopics([]));
  }, [filters, search]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { const t = setTimeout(load, search ? 300 : 0); return () => clearTimeout(t); }, [load, search, current?.organizationId]);
  useEffect(() => { const t = setInterval(() => loadRef.current(), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    socialApi.list().then((r) => setAccounts(r.accounts)).catch(() => undefined);
    if (canWork) { socialInboxApi.assignees().then(setPeople).catch(() => undefined); socialInboxApi.canned().then(setCanned).catch(() => undefined); }
  }, [current?.organizationId, canWork]);

  const set = (patch: Partial<ListeningParams>) => setFilters((f) => ({ ...f, ...patch }));
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const showList = !narrow || !selected;
  const showDetail = !narrow || !!selected;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}><Ear className="w-5 h-5" style={{ color: "var(--accent)" }} /> Listening</h1>
          <p className="text-xs max-w-2xl" style={{ color: "var(--text-muted)" }}>@mentions, photo tags, posts that tag your Page and visitor posts, as sent by Facebook and Instagram. This is not a search over public posts: networks do not offer that to apps. AI suggests; people reply.</p>
        </div>
        {summary && (
          <div className="flex gap-4 items-center flex-wrap" aria-label="Listening summary">
            <Stat label="Open" value={summary.mentionsOpen} /><Stat label="Negative" value={summary.negativeOpen} tone="danger" /><Stat label="Crisis words" value={summary.crisisOpen} tone="danger" />
            <Stat label="Unassigned" value={summary.unassigned} tone="warning" /><Stat label="Last 7 days" value={summary.mentionsLast7d} />
          </div>
        )}
      </div>

      <Card className="p-3 grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-7 gap-2" aria-label="Filters">
        <Select aria-label="Filter by status" value={filters.status ?? ""} onChange={(e) => set({ status: (e.target.value || undefined) as InboxStatus | undefined })}><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
        <Select aria-label="Filter by sentiment" value={filters.sentiment ?? ""} onChange={(e) => set({ sentiment: e.target.value || undefined })}><option value="">Any sentiment</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option></Select>
        <Select aria-label="Filter by topic" value={filters.topic ?? ""} onChange={(e) => set({ topic: e.target.value || undefined })}><option value="">Any topic</option>{topics.map((t) => <option key={t.topic} value={t.topic}>{t.topic} ({t.count})</option>)}</Select>
        <Select aria-label="Filter by account" value={filters.accountId ?? ""} onChange={(e) => set({ accountId: e.target.value || undefined })}><option value="">All accounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}</Select>
        <Select aria-label="Filter by assignee" value={filters.assignee ?? ""} onChange={(e) => set({ assignee: e.target.value || undefined })}><option value="">Anyone</option><option value="me">Assigned to me</option><option value="unassigned">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Input aria-label="Search mentions" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-secondary)" }}><input type="checkbox" checked={!!filters.crisis} onChange={(e) => set({ crisis: e.target.checked || undefined })} aria-label="Crisis words only" /> Crisis words only</label>
      </Card>

      {error ? <ErrorState message={error} /> : items === null ? <LoadingState /> : (
        <div className={`grid gap-3 ${narrow ? "grid-cols-1" : "grid-cols-[minmax(320px,2fr)_3fr]"}`}>
          {showList && (
            <Card className="overflow-hidden" aria-label="Mentions">
              {items.length === 0 ? (
                <EmptyState title="No mentions yet" description="When someone @mentions or tags one of your connected accounts, or posts on your Page, it appears here. Instagram caption and comment mentions arrive by webhook only (subscribe the “mentions” field in the Meta app). Stories mentions and mentions on private accounts are never sent." />
              ) : (
                <ul className="divide-y max-h-[70vh] overflow-y-auto" style={{ borderColor: "var(--border)" }}>
                  {items.map((c) => (
                    <li key={c.id} style={{ background: selected === c.id ? "var(--accent-soft)" : undefined }}>
                      <button type="button" className="cc-row w-full text-left p-2 flex items-start gap-2" onClick={() => setSelected(c.id)} aria-current={selected === c.id}>
                        <ProviderAvatar account={{ displayName: c.participant.name || c.participant.handle || "?", avatarUrl: null }} />
                        <span className="flex-1 min-w-0 space-y-1">
                          <span className="flex items-center gap-2">
                            <span className={`text-xs truncate ${c.isRead ? "font-semibold" : "font-bold"}`} style={{ color: "var(--text-primary)" }}>{c.participant.name || c.participant.handle || "Unknown"}</span>
                            <span className="text-[10px] shrink-0" style={{ color: "var(--text-muted)" }}>on {providerLabel(c.account.provider)} · {shortAgo(c.lastMessageAt)}</span>
                          </span>
                          <span className="block text-[11px] line-clamp-2" style={{ color: "var(--text-muted)" }}>{c.preview}</span>
                          <ListeningBadges item={c} />
                          {c.assigneeId && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>→ {peopleById.get(c.assigneeId) ?? "assigned"}</span>}
                        </span>
                        {c.permalink && <ExternalLink className="w-3 h-3 mt-1 shrink-0" aria-label="Has a link" style={{ color: "var(--text-muted)" }} />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="p-2 text-[10px]" style={{ color: "var(--text-muted)" }}>{total} item{total === 1 ? "" : "s"}</p>
            </Card>
          )}
          {showDetail && (
            <div>
              {selected ? <ConversationView id={selected} canReply={canWork} people={people} canned={canned} onChanged={load} onBack={() => setSelected(null)} narrow={narrow} /> : (
                <Card><EmptyState title="Select an item" description="Pick a mention to read it, assign it, create a CRM lead, or reply where the network allows it." /></Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
