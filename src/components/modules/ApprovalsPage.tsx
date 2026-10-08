/** Global Approvals center — one inbox over AI, automation and content approvals. Decisions go through the existing per-source services on the server. */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, X, ExternalLink, Check } from "lucide-react";
import { approvalsApi, type ApprovalSourceKey, type ApprovalStatusFilter, type CenterApproval } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import { Card, Button, Select, Input, Badge, LoadingState, ErrorState, EmptyState, Pagination } from "../ui/ui";

const TABS: Array<{ id: ApprovalStatusFilter; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];
const SOURCE_LABEL: Record<ApprovalSourceKey, string> = { ai: "AI", automation: "Automation", content: "Content", social: "Social", landing: "Landing page" };

export function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const SourceBadge: React.FC<{ source: ApprovalSourceKey }> = ({ source }) => <Badge tone="neutral">{SOURCE_LABEL[source]}</Badge>;

const Drawer: React.FC<{ item: CenterApproval; onClose: () => void; onDecided: () => void }> = ({ item, onClose, onDecided }) => {
  const { notify } = useToast();
  const { navigate } = useRouter();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const decide = async (decision: "approve" | "reject") => {
    if (decision === "reject" && !comment.trim()) return;
    setBusy(true);
    try {
      await approvalsApi.decide(item.source, item.id, decision, comment.trim() || undefined);
      notify(decision === "approve" ? "Approved." : "Rejected.", "success");
      onDecided();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not record the decision.", "error");
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-[10px] uppercase font-bold" style={{ color: "var(--text-muted)" }}>
        {label}
      </dt>
      <dd className="text-xs" style={{ color: "var(--text-primary)" }}>
        {value}
      </dd>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(2,6,23,0.6)" }} onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-drawer-title"
        className="h-full w-full sm:max-w-md overflow-y-auto p-5 space-y-4"
        style={{ background: "var(--bg-surface)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-pop)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <SourceBadge source={item.source} />
              <Badge tone={item.status === "pending" ? "warning" : item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "neutral"}>{item.status}</Badge>
            </div>
            <h2 id="approval-drawer-title" className="text-base font-bold break-words" style={{ color: "var(--text-primary)" }}>
              {item.title}
            </h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close details" className="cc-ctl p-1.5 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {item.summary}
        </p>

        <dl className="grid grid-cols-2 gap-3">
          {row("Requested by", item.requestedBy?.name ?? "System")}
          {row("Requested", `${timeAgo(item.requestedAt)} · ${new Date(item.requestedAt).toLocaleString()}`)}
          {item.dueAt && row(item.source === "ai" ? "Expires" : "Due", new Date(item.dueAt).toLocaleString())}
          {item.decidedBy && row("Decided by", item.decidedBy.name)}
          {item.decidedAt && row("Decided", new Date(item.decidedAt).toLocaleString())}
          {item.decisionComment && row("Comment", item.decisionComment)}
        </dl>

        <Button
          variant="secondary"
          onClick={() => {
            onClose();
            navigate(item.link);
          }}
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open source item
        </Button>

        {item.status === "pending" && (
          <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
            {item.canDecide ? (
              <>
                <label className="block text-xs font-semibold" htmlFor="approval-comment" style={{ color: "var(--text-secondary)" }}>
                  Comment <span style={{ color: "var(--text-muted)" }}>(required to reject)</span>
                </label>
                <textarea
                  id="approval-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="cc-field w-full px-3 py-2 text-sm focus:outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
                <div className="flex gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => void decide("approve")}>
                    <Check className="w-3.5 h-3.5" /> Approve
                  </Button>
                  <Button variant="danger" disabled={busy || !comment.trim()} onClick={() => void decide("reject")}>
                    <X className="w-3.5 h-3.5" /> Reject
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                You can view this request but do not have permission to decide it.
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
  );
};

export const ApprovalsPage: React.FC = () => {
  const [status, setStatus] = useState<ApprovalStatusFilter>("pending");
  const [source, setSource] = useState<ApprovalSourceKey | "">("");
  const [assignee, setAssignee] = useState<"me" | "all">("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CenterApproval[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CenterApproval | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [status, source, assignee, debounced]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await approvalsApi.list({ status, source: source || undefined, assignee, search: debounced || undefined, page, limit: 20 });
      setItems(res.items);
      setSources(res.sources);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load approvals.");
    } finally {
      setLoading(false);
    }
  }, [status, source, assignee, debounced, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <BadgeCheck className="w-5 h-5" /> Approvals
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Everything waiting on a decision, across AI actions, workflows and content. Decisions here use the same rules as each source&apos;s own page.
        </p>
      </div>

      <Card className="p-3 space-y-3">
        <div role="tablist" aria-label="Approval status" className="flex gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={status === t.id}
              onClick={() => setStatus(t.id)}
              className="cc-nav-item !w-auto !px-3 !py-1.5"
              aria-current={status === t.id ? "page" : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Source" value={source} onChange={(e) => setSource(e.target.value as ApprovalSourceKey | "")}>
            <option value="">All sources</option>
            {(["ai", "automation", "content", "social", "landing"] as const)
              .filter((s) => sources.includes(s))
              .map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
          </Select>
          <Select aria-label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value as "me" | "all")}>
            <option value="all">Everyone</option>
            <option value="me">Mine</option>
          </Select>
          <Input aria-label="Search approvals" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1 min-w-[10rem]" />
        </div>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title={status === "pending" ? "Nothing waiting on you" : `No ${status} approvals`} description="Requests from AI actions, workflows and content will appear here." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((item) => (
              <li key={`${item.source}:${item.id}`}>
                <button type="button" onClick={() => setSelected(item)} className="cc-row w-full px-4 py-3 flex items-center justify-between gap-3 text-left">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                      <SourceBadge source={item.source} />
                      <span className="truncate">{item.title}</span>
                    </span>
                    <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                      {item.requestedBy?.name ?? "System"} · {timeAgo(item.requestedAt)} · {item.summary}
                    </span>
                  </span>
                  <Badge tone={item.status === "pending" ? "warning" : item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "neutral"}>{item.status}</Badge>
                </button>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </Card>
      )}

      {selected && (
        <Drawer
          item={selected}
          onClose={() => setSelected(null)}
          onDecided={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
    </div>
  );
};
