/** Phase 8 — CMS blog posts: searchable/filterable/paginated list + master-detail editor with category/tag assignment, workflow actions, and revision history/revert. */
import React, { useEffect, useState } from "react";
import {
  Newspaper,
  Plus,
  Search,
  Send,
  Rocket,
  CalendarClock,
  Archive,
  History,
  RotateCcw,
  Image as ImageIcon,
  X,
  Trash2,
  Undo2,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  postsApi,
  categoriesApi,
  tagsApi,
  mediaApi,
  authorsApi,
  type CmsPost,
  type CmsCategory,
  type CmsTag,
  type CmsMedia,
  type CmsAuthor,
  type ContentRevision,
  type ContentStatusValue,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery, consumeNewFlag } from "../../lib/deepLink";
import { MediaPickerModal } from "../common/MediaPickerModal";
import { RichTextEditor } from "../common/RichTextEditor";

const STATUS_OPTIONS: ContentStatusValue[] = ["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"];
const STATUS_TONE: Record<ContentStatusValue, "success" | "warning" | "danger" | "info" | "neutral"> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  SCHEDULED: "warning",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

const FeaturedImageField: React.FC<{ mediaId: string | undefined; onChange: (mediaId: string | undefined) => void }> = ({ mediaId, onChange }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!mediaId) {
      setPreview(null);
      return;
    }
    void mediaApi.get(mediaId).then((res) => {
      if (cancelled) return;
      void mediaApi.getReadUrl(mediaId).then((urlRes) => {
        if (!cancelled) setPreview({ url: urlRes.url, label: res.media.displayName ?? res.media.originalFilename });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  return (
    <Field label="Featured image">
      <div className="flex items-center gap-3">
        {preview ? (
          <div className="w-16 h-16 rounded-lg overflow-hidden border shrink-0" style={{ borderColor: "var(--border)" }}>
            <img src={preview.url} alt={preview.label} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div
            className="w-16 h-16 rounded-lg border flex items-center justify-center shrink-0"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            <ImageIcon className="w-5 h-5" />
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
            {mediaId ? "Change" : "Choose image"}
          </Button>
          {mediaId && (
            <Button type="button" variant="ghost" onClick={() => onChange(undefined)} aria-label="Remove featured image">
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>
      <MediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(m: CmsMedia) => {
          onChange(m.id);
          setPickerOpen(false);
        }}
      />
    </Field>
  );
};

const PostFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: (post?: CmsPost) => void;
  mode: "create" | "edit";
  post?: CmsPost;
  categories: CmsCategory[];
  tags: CmsTag[];
  authors: CmsAuthor[];
}> = ({ open, onClose, onSaved, mode, post, categories, tags, authors }) => {
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [excerpt, setExcerpt] = useState(post?.currentRevision?.excerpt ?? "");
  const [body, setBody] = useState(post?.currentRevision?.body ?? "");
  const [categoryId, setCategoryId] = useState(post?.categoryId ?? "");
  const [authorId, setAuthorId] = useState(post?.authorId ?? "");
  const [tagIds, setTagIds] = useState<string[]>(post?.tags.map((t) => t.tagId) ?? []);
  const [featuredMediaId, setFeaturedMediaId] = useState<string | undefined>(post?.featuredMediaId ?? undefined);
  const [metaTitle, setMetaTitle] = useState((post?.currentRevision?.metadata?.metaTitle as string) ?? "");
  const [metaDescription, setMetaDescription] = useState((post?.currentRevision?.metadata?.metaDescription as string) ?? "");
  const [ogImage, setOgImage] = useState((post?.currentRevision?.metadata?.ogImage as string) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(post?.title ?? "");
      setSlug(post?.slug ?? "");
      setExcerpt(post?.currentRevision?.excerpt ?? "");
      setBody(post?.currentRevision?.body ?? "");
      setCategoryId(post?.categoryId ?? "");
      setAuthorId(post?.authorId ?? "");
      setTagIds(post?.tags.map((t) => t.tagId) ?? []);
      setFeaturedMediaId(post?.featuredMediaId ?? undefined);
      setMetaTitle((post?.currentRevision?.metadata?.metaTitle as string) ?? "");
      setMetaDescription((post?.currentRevision?.metadata?.metaDescription as string) ?? "");
      setOgImage((post?.currentRevision?.metadata?.ogImage as string) ?? "");
      setError(null);
    }
  }, [open, post]);

  const toggleTag = (id: string) => setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const metadata = {
      ...(metaTitle.trim() ? { metaTitle: metaTitle.trim() } : {}),
      ...(metaDescription.trim() ? { metaDescription: metaDescription.trim() } : {}),
      ...(ogImage.trim() ? { ogImage: ogImage.trim() } : {}),
    };
    try {
      if (mode === "create") {
        const res = await postsApi.create({
          title,
          slug: slug || undefined,
          excerpt: excerpt.trim() || undefined,
          body,
          metadata,
          categoryId: categoryId || undefined,
          authorId: authorId || undefined,
          tagIds,
          featuredMediaId,
        });
        onSaved(res.post);
      } else if (post) {
        const res = await postsApi.update(post.id, {
          title,
          slug,
          excerpt: excerpt.trim() || null,
          body,
          metadata,
          categoryId: categoryId || null,
          authorId: authorId || null,
          tagIds,
          featuredMediaId: featuredMediaId ?? null,
          expectedUpdatedAt: post.updatedAt,
        });
        onSaved(res.post);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save post.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "New post" : `Edit ${post?.title}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Title">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Slug" hint="Leave blank to auto-generate.">
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated" />
          </Field>
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Author">
          <Select value={authorId} onChange={(e) => setAuthorId(e.target.value)}>
            <option value="">Unassigned</option>
            {authors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.user.displayName || `${a.user.firstName} ${a.user.lastName}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Excerpt" hint="A short summary for list views and archive cards. Falls back to an auto-generated one if left blank.">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={2}
            maxLength={500}
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
          />
        </Field>
        <Field label="Tags">
          <div className="flex flex-wrap gap-1.5">
            {tags.length === 0 && <span style={{ color: "var(--text-muted)" }}>No tags yet.</span>}
            {tags.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => toggleTag(t.id)}
                className="px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                style={
                  tagIds.includes(t.id)
                    ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent)" }
                    : { color: "var(--text-secondary)", borderColor: "var(--border)" }
                }
              >
                {t.name}
              </button>
            ))}
          </div>
        </Field>
        <FeaturedImageField mediaId={featuredMediaId} onChange={setFeaturedMediaId} />
        <Field label="Body">
          <RichTextEditor value={body} onChange={setBody} placeholder="Write the post…" />
        </Field>
        <div className="pt-3 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            SEO
          </p>
          <Field label="Meta title" hint="Shown in search results and social previews. Falls back to the post title if left blank.">
            <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} maxLength={70} />
          </Field>
          <Field label="Meta description" hint="Falls back to an auto-generated excerpt if left blank.">
            <textarea
              className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none"
              style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
              rows={2}
              maxLength={200}
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
            />
          </Field>
          <Field label="Open Graph image URL" hint="Falls back to the featured image if left blank.">
            <Input value={ogImage} onChange={(e) => setOgImage(e.target.value)} placeholder="https://..." />
          </Field>
        </div>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create post" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const ScheduleModal: React.FC<{ open: boolean; onClose: () => void; onSchedule: (scheduledAt: string) => void }> = ({ open, onClose, onSchedule }) => {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (open) setValue("");
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Schedule publish">
      <div className="space-y-3">
        <Field label="Publish at">
          <Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!value} onClick={() => value && onSchedule(new Date(value).toISOString())}>
            Schedule
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const PostDetail: React.FC<{ post: CmsPost; categories: CmsCategory[]; tags: CmsTag[]; authors: CmsAuthor[]; onChanged: (p?: CmsPost) => void }> = ({
  post,
  categories,
  tags,
  authors,
  onChanged,
}) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "content.update");
  const canPublish = hasPermission(user?.role.permissions, "content.publish");
  const canDelete = hasPermission(user?.role.permissions, "content.delete");

  const [editOpen, setEditOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<ContentRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRevisions = async () => {
    setRevisionsLoading(true);
    try {
      const res = await postsApi.revisions(post.id);
      setRevisions(res.revisions);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const run = async (action: () => Promise<{ post: CmsPost }>, successMsg: string) => {
    setBusy(true);
    try {
      const res = await action();
      notify(successMsg, "success");
      onChanged(res.post);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = () => run(() => postsApi.update(post.id, { status: "DRAFT" }), "Post restored to draft.");
  const handleSubmitReview = () => run(() => postsApi.submitForReview(post.id), "Submitted for review.");
  const handlePublish = () => run(() => postsApi.publish(post.id), "Post published.");
  const handleArchive = async () => {
    setArchiveOpen(false);
    await run(() => postsApi.archive(post.id), "Post archived.");
  };
  const handleSchedule = async (scheduledAt: string) => {
    setScheduleOpen(false);
    await run(() => postsApi.schedule(post.id, scheduledAt), "Post scheduled.");
  };
  const handleRevert = async (revisionId: string) => {
    await run(() => postsApi.revert(post.id, revisionId), "Reverted to prior revision.");
    void loadRevisions();
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {post.title}
            <Badge tone={STATUS_TONE[post.status]}>{post.status}</Badge>
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            /{post.slug} · v{post.currentRevision?.version ?? "—"}
            {post.category && <> · {post.category.name}</>}
            {post.scheduledAt && post.status === "SCHEDULED" && <> · scheduled for {new Date(post.scheduledAt).toLocaleString()}</>}
          </p>
          {post.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {post.tags.map((t) => (
                <Badge key={t.tagId} tone="neutral">
                  {t.tag.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end shrink-0">
          <Button
            variant="ghost"
            onClick={() => {
              setRevisionsOpen(true);
              void loadRevisions();
            }}
          >
            <History className="w-3.5 h-3.5" /> Revisions
          </Button>
          {canUpdate && (post.status === "DRAFT" || post.status === "IN_REVIEW" || post.status === "SCHEDULED") && (
            <Button variant="secondary" onClick={() => setEditOpen(true)} disabled={busy}>
              Edit
            </Button>
          )}
          {canUpdate && post.status === "DRAFT" && (
            <Button variant="secondary" onClick={() => void handleSubmitReview()} disabled={busy}>
              <Send className="w-3.5 h-3.5" /> Submit for review
            </Button>
          )}
          {canPublish && post.status !== "PUBLISHED" && post.status !== "ARCHIVED" && (
            <Button variant="primary" onClick={() => void handlePublish()} disabled={busy}>
              <Rocket className="w-3.5 h-3.5" /> Publish
            </Button>
          )}
          {canPublish && post.status !== "PUBLISHED" && post.status !== "ARCHIVED" && (
            <Button variant="secondary" onClick={() => setScheduleOpen(true)} disabled={busy}>
              <CalendarClock className="w-3.5 h-3.5" /> Schedule
            </Button>
          )}
          {canUpdate && (post.status === "PUBLISHED" || post.status === "SCHEDULED" || post.status === "IN_REVIEW") && (
            <Button variant="secondary" onClick={() => void handleRestore()} disabled={busy}>
              Move to draft
            </Button>
          )}
          {canUpdate && post.status === "ARCHIVED" && (
            <Button variant="secondary" onClick={() => void handleRestore()} disabled={busy}>
              Restore
            </Button>
          )}
          {canDelete && post.status !== "ARCHIVED" && (
            <Button variant="danger" onClick={() => setArchiveOpen(true)} disabled={busy}>
              <Archive className="w-3.5 h-3.5" /> Archive
            </Button>
          )}
        </div>
      </div>

      {post.currentRevision?.body ? (
        <div className="p-4 cms-rendered-body" dangerouslySetInnerHTML={{ __html: post.currentRevision.body }} />
      ) : (
        <div className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>
          No body content yet.
        </div>
      )}

      <PostFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(updated) => onChanged(updated)}
        mode="edit"
        post={post}
        categories={categories}
        tags={tags}
        authors={authors}
      />
      <ScheduleModal open={scheduleOpen} onClose={() => setScheduleOpen(false)} onSchedule={handleSchedule} />
      <ConfirmDialog
        open={archiveOpen}
        title="Archive post"
        message={`Archive "${post.title}"? It will be hidden from active use but preserved for history.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setArchiveOpen(false)}
      />
      <Modal open={revisionsOpen} onClose={() => setRevisionsOpen(false)} title="Revision history">
        {revisionsLoading ? (
          <LoadingState />
        ) : revisions.length === 0 ? (
          <EmptyState title="No revisions yet" description="" />
        ) : (
          <ul className="space-y-2">
            {revisions.map((r) => (
              <li key={r.id} className="p-2.5 rounded-lg border text-xs flex items-center justify-between gap-3" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                    v{r.version} <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>{new Date(r.createdAt).toLocaleString()}</p>
                </div>
                {canUpdate && r.id !== post.currentRevisionId && (
                  <Button variant="secondary" onClick={() => void handleRevert(r.id)} disabled={busy || post.status === "ARCHIVED"}>
                    <RotateCcw className="w-3.5 h-3.5" /> Revert to this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </Card>
  );
};

export const PostsPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "content.create");

  const [pageNum, setPageNum] = useState(1);
  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [status, setStatus] = useState<ContentStatusValue | "">("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [posts, setPosts] = useState<CmsPost[]>([]);
  const [categories, setCategories] = useState<CmsCategory[]>([]);
  const [tags, setTags] = useState<CmsTag[]>([]);
  const [selected, setSelected] = useState<CmsPost | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [authors, setAuthors] = useState<CmsAuthor[]>([]);

  // Phase 7 — Content Dashboard: date range filter, Trash view, bulk actions.
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [view, setView] = useState<"active" | "trash">("active");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<"archive" | "trash" | null>(null);
  const { notify } = useToast();
  const canDeleteBulk = hasPermission(user?.role.permissions, "content.delete");

  // Command Center "New Post" deep link (?new=1)
  useEffect(() => {
    if (consumeNewFlag()) setCreateOpen(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPageNum(1);
    setCheckedIds(new Set());
  }, [debouncedSearch, status, categoryFilter, fromDate, toDate, view]);

  useEffect(() => {
    void categoriesApi.list().then((res) => setCategories(res.categories));
    void tagsApi.list().then((res) => setTags(res.tags));
    void authorsApi.list().then((res) => setAuthors(res.authors));
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res =
        view === "trash"
          ? await postsApi.trash({ page: pageNum, limit: 20 })
          : await postsApi.list({
              page: pageNum,
              limit: 20,
              search: debouncedSearch || undefined,
              status: status || undefined,
              categoryId: categoryFilter || undefined,
              fromDate: fromDate ? new Date(fromDate).toISOString() : undefined,
              toDate: toDate ? new Date(toDate).toISOString() : undefined,
            });
      setPosts(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((p) => p.id === prev.id) ? res.items.find((p) => p.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load posts.");
    } finally {
      setLoading(false);
    }
  }, [pageNum, debouncedSearch, status, categoryFilter, fromDate, toDate, view]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleChecked = (id: string) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const runBulk = async (action: "archive" | "trash" | "restore") => {
    const ids = Array.from(checkedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    setBulkConfirm(null);
    try {
      const res = action === "archive" ? await postsApi.bulkArchive(ids) : action === "trash" ? await postsApi.bulkTrash(ids) : await postsApi.bulkRestore(ids);
      const verb = action === "archive" ? "archived" : action === "trash" ? "moved to trash" : "restored";
      if (res.failed.length === 0) {
        notify(`${res.succeeded.length} post(s) ${verb}.`, "success");
      } else {
        notify(`${res.succeeded.length} ${verb}, ${res.failed.length} failed: ${res.failed[0]!.error}`, "error");
      }
      setCheckedIds(new Set());
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Bulk action failed.", "error");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Newspaper className="w-5 h-5" /> Blog Posts
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Blog content for this organization.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5" style={{ borderColor: "var(--border)" }}>
            <button
              onClick={() => setView("active")}
              className="px-3 py-1 rounded-md text-xs font-semibold"
              style={view === "active" ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
            >
              Active
            </button>
            <button
              onClick={() => setView("trash")}
              className="px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1"
              style={view === "trash" ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
            >
              <Trash2 className="w-3 h-3" /> Trash
            </button>
          </div>
          {canCreate && view === "active" && (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4" /> New post
            </Button>
          )}
        </div>
      </div>

      {view === "active" && (
        <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
            <Input placeholder="Search posts…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as ContentStatusValue | "")}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input type="date" aria-label="From date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-auto" />
          <Input type="date" aria-label="To date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-auto" />
        </Card>
      )}

      {canDeleteBulk && checkedIds.size > 0 && (
        <Card className="p-2.5 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            {checkedIds.size} selected
          </span>
          <div className="flex gap-2">
            {view === "active" ? (
              <>
                <Button variant="secondary" disabled={bulkBusy} onClick={() => setBulkConfirm("archive")}>
                  <Archive className="w-3.5 h-3.5" /> Archive selected
                </Button>
                <Button variant="danger" disabled={bulkBusy} onClick={() => setBulkConfirm("trash")}>
                  <Trash2 className="w-3.5 h-3.5" /> Trash selected
                </Button>
              </>
            ) : (
              <Button variant="secondary" disabled={bulkBusy} onClick={() => void runBulk("restore")}>
                <Undo2 className="w-3.5 h-3.5" /> Restore selected
              </Button>
            )}
          </div>
        </Card>
      )}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : posts.length === 0 ? (
        <Card>
          <EmptyState
            title={view === "trash" ? "Trash is empty" : "No posts found"}
            description={view === "trash" ? "" : "Create a post or adjust your filters."}
          />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {posts.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5 mb-0.5">
                {canDeleteBulk && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.title}`}
                    checked={checkedIds.has(p.id)}
                    onChange={() => toggleChecked(p.id)}
                    className="shrink-0"
                  />
                )}
                <button
                  onClick={() => setSelected(p)}
                  className="flex-1 text-left px-2 py-2 rounded-lg text-xs font-semibold flex items-center justify-between gap-2"
                  style={selected?.id === p.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
                >
                  <span className="truncate">{p.title}</span>
                  {view === "active" && <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>}
                </button>
                {view === "trash" && (
                  <Button variant="ghost" onClick={() => void postsApi.restore(p.id).then(() => load())} aria-label={`Restore ${p.title}`}>
                    <Undo2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <Pagination page={pageNum} totalPages={totalPages} onChange={setPageNum} />
          </Card>

          {view === "active" && selected && (
            <PostDetail
              post={selected}
              categories={categories}
              tags={tags}
              authors={authors}
              onChanged={(updated) => (updated ? setSelected(updated) : void load())}
            />
          )}
        </div>
      )}

      <PostFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => load()} mode="create" categories={categories} tags={tags} authors={authors} />

      <ConfirmDialog
        open={bulkConfirm !== null}
        title={bulkConfirm === "archive" ? "Archive selected posts" : "Move selected posts to trash"}
        message={
          bulkConfirm === "archive"
            ? `Archive ${checkedIds.size} post(s)? They'll be hidden from active use but preserved for history.`
            : `Move ${checkedIds.size} post(s) to trash? You can restore them later from the Trash tab.`
        }
        confirmLabel={bulkConfirm === "archive" ? "Archive" : "Trash"}
        destructive
        onConfirm={() => void runBulk(bulkConfirm === "archive" ? "archive" : "trash")}
        onCancel={() => setBulkConfirm(null)}
      />
    </div>
  );
};
