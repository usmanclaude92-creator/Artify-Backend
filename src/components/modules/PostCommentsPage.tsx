/** Moderation queue for reader comments on public blog posts. A comment is private until it is approved here. */
import React, { useCallback, useEffect, useState } from "react";
import { MessageSquare, Check, X } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { postCommentsApi, type PostCommentRow, type PostCommentStatus } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, LoadingState, EmptyState, Badge } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const TABS: Array<{ status: PostCommentStatus; label: string }> = [
  { status: "PENDING", label: "Pending" },
  { status: "APPROVED", label: "Approved" },
  { status: "REJECTED", label: "Rejected" },
];

export const PostCommentsPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canModerate = hasPermission(user?.role.permissions, "content.update");
  const [status, setStatus] = useState<PostCommentStatus>("PENDING");
  const [rows, setRows] = useState<PostCommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await postCommentsApi.list(status);
      setRows(res.comments);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not load comments.", "error");
    } finally {
      setLoading(false);
    }
  }, [status, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const moderate = async (id: string, next: "APPROVED" | "REJECTED") => {
    setBusyId(id);
    try {
      await postCommentsApi.moderate(id, next);
      notify(next === "APPROVED" ? "Comment approved and now public." : "Comment rejected.", "success");
      await load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update the comment.", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <MessageSquare className="w-5 h-5" /> Blog comments
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Reader comments stay private until you approve them. Approved comments appear on the post within a few minutes.
        </p>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Comment status">
        {TABS.map((t) => (
          <Button key={t.status} variant={status === t.status ? "primary" : "ghost"} onClick={() => setStatus(t.status)} role="tab" aria-selected={status === t.status}>
            {t.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title={`No ${status.toLowerCase()} comments`} description="Comments left by readers on your blog posts will show up here." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {rows.map((c) => (
              <li key={c.id} className="px-4 py-3 text-xs flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5 flex-wrap" style={{ color: "var(--text-primary)" }}>
                    {c.authorName}
                    {c.authorRole && <span style={{ color: "var(--text-muted)" }}>· {c.authorRole}</span>}
                    <Badge tone={c.status === "APPROVED" ? "success" : c.status === "REJECTED" ? "danger" : "warning"}>{c.status}</Badge>
                  </p>
                  <p style={{ color: "var(--text-secondary)" }} className="whitespace-pre-wrap break-words">
                    {c.body}
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>
                    On <a className="underline" href={`https://artifysols.com/blog/${c.post.slug}`} target="_blank" rel="noreferrer">{c.post.title}</a> · {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
                {canModerate && (
                  <div className="flex gap-1.5 shrink-0">
                    {c.status !== "APPROVED" && (
                      <Button variant="primary" disabled={busyId === c.id} onClick={() => moderate(c.id, "APPROVED")} aria-label="Approve comment">
                        <Check className="w-3.5 h-3.5" /> Approve
                      </Button>
                    )}
                    {c.status !== "REJECTED" && (
                      <Button variant="ghost" disabled={busyId === c.id} onClick={() => moderate(c.id, "REJECTED")} aria-label="Reject comment">
                        <X className="w-3.5 h-3.5" /> Reject
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};
