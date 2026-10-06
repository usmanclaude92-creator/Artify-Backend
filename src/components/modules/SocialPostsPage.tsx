/** Social posts list: filter, search and open any post. */
import React, { useCallback, useEffect, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { socialApi, socialContentApi, type SocialAccountSummary, type SocialPostStatus, type SocialPostView } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "../../lib/router";
import { useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { hasPermission } from "../../lib/permissions";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination } from "../ui/ui";
import { POST_STATUS_LABEL, PostStatusBadge } from "./socialPostShared";

export const SocialPostsPage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const { current } = useActiveWorkspace();
  const canPublish = hasPermission(user?.role.permissions, "social.publish");
  const [status, setStatus] = useState<SocialPostStatus | "">("");
  const [accountId, setAccountId] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [accounts, setAccounts] = useState<SocialAccountSummary[]>([]);
  const [posts, setPosts] = useState<SocialPostView[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [status, accountId, debounced]);
  useEffect(() => {
    void socialApi.list().then((r) => setAccounts(r.accounts)).catch(() => undefined);
  }, [current?.organizationId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await socialContentApi.listPosts({ ...(status ? { status } : {}), ...(accountId ? { accountId } : {}), ...(debounced ? { search: debounced } : {}), page, limit: 20 });
      setPosts(res.posts);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load posts.");
    } finally {
      setLoading(false);
    }
  }, [status, accountId, debounced, page]);
  useEffect(() => {
    void load();
  }, [load, current?.organizationId]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <FileText className="w-5 h-5" /> Posts
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Every social post in this workspace, from draft to approved. Publishing arrives in a later step.
          </p>
        </div>
        {canPublish && (
          <Button variant="primary" onClick={() => navigate("/social/compose")}>
            <Plus className="w-3.5 h-3.5" /> New post
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-wrap gap-2">
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as SocialPostStatus | "")}>
          <option value="">All statuses</option>
          {(Object.keys(POST_STATUS_LABEL) as SocialPostStatus[]).map((s) => (
            <option key={s} value={s}>
              {POST_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </Select>
        <Input aria-label="Search posts" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="flex-1 min-w-[10rem]" />
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : posts.length === 0 ? (
        <Card>
          <EmptyState title="No posts yet" description="Create a post in the Composer, or let AI draft one from a brief." />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {posts.map((p) => (
              <li key={p.id}>
                <button type="button" className="cc-row w-full px-4 py-3 flex items-center justify-between gap-3 text-left" onClick={() => navigate(`/social/compose?post=${p.id}`)}>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                      <span className="truncate">{p.title}</span>
                      {p.aiGenerated && <Badge tone="info">AI</Badge>}
                    </span>
                    <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                      {p.targets.map((t) => t.account.displayName).join(", ") || "No accounts"} · {p.scheduledAt ? new Date(p.scheduledAt).toLocaleString() : "not scheduled"}
                    </span>
                  </span>
                  <PostStatusBadge status={p.status} />
                </button>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </Card>
      )}
    </div>
  );
};
