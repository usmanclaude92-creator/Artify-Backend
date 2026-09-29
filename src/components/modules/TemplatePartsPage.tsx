/**
 * Phase 1 (Website module) — Template Parts: searchable/filterable/paginated
 * list + master-detail with publish/revisions/revert/duplicate/archive.
 * Mirrors TemplatesPage.tsx exactly — see that file's header comment.
 */
import React, { useEffect, useState } from "react";
import { PanelsTopLeft, Plus, Search, Rocket, Archive, History, RotateCcw, Copy, Pencil } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { templatePartsApi, type TemplatePart, type TemplatePartRevision, type TemplatePartTypeValue, type TemplateWorkflowStatus } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery, consumeNewFlag } from "../../lib/deepLink";

const TYPE_OPTIONS: TemplatePartTypeValue[] = [
  "HEADER",
  "FOOTER",
  "PRIMARY_NAVIGATION",
  "MOBILE_HEADER",
  "SIDEBAR",
  "ANNOUNCEMENT_BAR",
  "CTA_SECTION",
  "NEWSLETTER_SECTION",
  "CONTACT_SECTION",
  "SOCIAL_SECTION",
];
const STATUS_OPTIONS: TemplateWorkflowStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];
const STATUS_TONE: Record<TemplateWorkflowStatus, "success" | "danger" | "neutral"> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

function formatContent(content: Record<string, unknown> | undefined): string {
  try {
    return JSON.stringify(content ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

const PartFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: (p?: TemplatePart) => void; mode: "create" | "edit"; part?: TemplatePart }> = ({
  open,
  onClose,
  onSaved,
  mode,
  part,
}) => {
  const [type, setType] = useState<TemplatePartTypeValue>(part?.type ?? "HEADER");
  const [name, setName] = useState(part?.name ?? "");
  const [slug, setSlug] = useState(part?.slug ?? "");
  const [contentText, setContentText] = useState(formatContent(part?.currentRevision?.content));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setType(part?.type ?? "HEADER");
      setName(part?.name ?? "");
      setSlug(part?.slug ?? "");
      setContentText(formatContent(part?.currentRevision?.content));
      setError(null);
    }
  }, [open, part]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let content: Record<string, unknown>;
    try {
      content = contentText.trim() ? JSON.parse(contentText) : {};
    } catch {
      setError("Content must be valid JSON.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await templatePartsApi.create({ type, name, slug: slug || undefined, content });
        onSaved(res.templatePart);
      } else if (part) {
        const res = await templatePartsApi.update(part.id, { name, slug, content, expectedUpdatedAt: part.updatedAt });
        onSaved(res.templatePart);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save template part.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "New template part" : `Edit ${part?.name}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        {mode === "create" && (
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as TemplatePartTypeValue)}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Slug" hint="Leave blank to auto-generate from the name.">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto-generated" />
        </Field>
        <Field label="Content (JSON)" hint="Raw JSON in this phase — the future Site Editor will replace this with a visual builder.">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-xs font-mono focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={8}
            value={contentText}
            onChange={(e) => setContentText(e.target.value)}
          />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create part" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const PartDetail: React.FC<{ part: TemplatePart; onChanged: (p?: TemplatePart) => void }> = ({ part, onChanged }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "template_parts.update");
  const canPublish = hasPermission(user?.role.permissions, "template_parts.publish");
  const canDelete = hasPermission(user?.role.permissions, "template_parts.delete");
  const canCreate = hasPermission(user?.role.permissions, "template_parts.create");

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<TemplatePartRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRevisions = async () => {
    setRevisionsLoading(true);
    try {
      const res = await templatePartsApi.revisions(part.id);
      setRevisions(res.revisions);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const run = async (action: () => Promise<{ templatePart: TemplatePart }>, successMsg: string) => {
    setBusy(true);
    try {
      const res = await action();
      notify(successMsg, "success");
      onChanged(res.templatePart);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = () => run(() => templatePartsApi.publish(part.id), "Template part published.");
  const handleArchive = async () => {
    setArchiveOpen(false);
    await run(() => templatePartsApi.archive(part.id), "Template part archived.");
  };
  const handleDuplicate = () => run(() => templatePartsApi.duplicate(part.id), "Template part duplicated.");
  const handleRevert = async (revisionId: string) => {
    await run(() => templatePartsApi.revert(part.id, revisionId), "Reverted to prior revision.");
    void loadRevisions();
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {part.name}
            <Badge tone={STATUS_TONE[part.status]}>{part.status}</Badge>
            {part.isSystem && <Badge tone="info">System</Badge>}
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {part.type} · /{part.slug} · v{part.currentRevision?.version ?? "—"} · updated {new Date(part.updatedAt).toLocaleString()}
          </p>
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
          {canCreate && (
            <Button variant="secondary" onClick={() => void handleDuplicate()} disabled={busy}>
              <Copy className="w-3.5 h-3.5" /> Duplicate
            </Button>
          )}
          {canUpdate && !part.isSystem && (
            <Button variant="secondary" onClick={() => setEditOpen(true)} disabled={busy}>
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Button>
          )}
          {canPublish && !part.isSystem && part.status !== "PUBLISHED" && part.status !== "ARCHIVED" && (
            <Button variant="primary" onClick={() => void handlePublish()} disabled={busy}>
              <Rocket className="w-3.5 h-3.5" /> Publish
            </Button>
          )}
          {canDelete && !part.isSystem && part.status !== "ARCHIVED" && (
            <Button variant="danger" onClick={() => setArchiveOpen(true)} disabled={busy}>
              <Archive className="w-3.5 h-3.5" /> Archive
            </Button>
          )}
        </div>
      </div>

      <div className="p-4">
        <pre
          className="text-[11px] font-mono p-3 rounded-lg overflow-auto max-h-64"
          style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          {formatContent(part.currentRevision?.content)}
        </pre>
      </div>

      <PartFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={(updated) => onChanged(updated)} mode="edit" part={part} />
      <ConfirmDialog
        open={archiveOpen}
        title="Archive template part"
        message={`Archive "${part.name}"? Any template referencing it keeps its own copy of the reference — this doesn't retroactively edit templates.`}
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
                    v{r.version} <Badge tone={r.status === "PUBLISHED" ? "success" : "neutral"}>{r.status}</Badge>
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>{new Date(r.createdAt).toLocaleString()}</p>
                </div>
                {canUpdate && !part.isSystem && r.id !== part.currentRevisionId && (
                  <Button variant="secondary" onClick={() => void handleRevert(r.id)} disabled={busy}>
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

export const TemplatePartsPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "template_parts.create");

  const [pageNum, setPageNum] = useState(1);
  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [status, setStatus] = useState<TemplateWorkflowStatus | "">("");
  const [type, setType] = useState<TemplatePartTypeValue | "">("");
  const [parts, setParts] = useState<TemplatePart[]>([]);
  const [selected, setSelected] = useState<TemplatePart | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (consumeNewFlag()) setCreateOpen(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPageNum(1);
  }, [debouncedSearch, status, type]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await templatePartsApi.list({ page: pageNum, limit: 20, search: debouncedSearch || undefined, status: status || undefined, type: type || undefined });
      setParts(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((p) => p.id === prev.id) ? res.items.find((p) => p.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load template parts.");
    } finally {
      setLoading(false);
    }
  }, [pageNum, debouncedSearch, status, type]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <PanelsTopLeft className="w-5 h-5" /> Template Parts
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Reusable regions (header, footer, nav, CTAs) referenced by Templates.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New part
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search template parts…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value as TemplatePartTypeValue | "")}>
          <option value="">All types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as TemplateWorkflowStatus | "")}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </Card>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : parts.length === 0 ? (
        <Card>
          <EmptyState title="No template parts found" description="Create a template part or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {parts.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selected?.id === p.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{p.name}</span>
                <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
              </button>
            ))}
            <Pagination page={pageNum} totalPages={totalPages} onChange={setPageNum} />
          </Card>

          {selected && <PartDetail part={selected} onChanged={(updated) => (updated ? setSelected(updated) : void load())} />}
        </div>
      )}

      <PartFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => load()} mode="create" />
    </div>
  );
};
