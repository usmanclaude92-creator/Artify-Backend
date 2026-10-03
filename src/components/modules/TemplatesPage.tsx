/**
 * Phase 1 (Website module) — Templates: searchable/filterable/paginated
 * list + master-detail with publish/revisions/revert/duplicate/archive.
 * Mirrors PagesPage.tsx's exact shape (docs/control-center-replacement-roadmap.md).
 *
 * No visual Site Editor exists yet (explicitly out of scope this phase —
 * see the Phase 1 brief's "DO NOT build the full visual Site Editor yet").
 * `structure` is edited here as raw JSON, which is what it actually is at
 * this point in the architecture — this UI is the structural/template
 * management surface the future Site Editor will build on, not a stand-in
 * for it.
 */
import React, { useEffect, useState } from "react";
import { LayoutTemplate, Plus, Search, Rocket, Archive, History, RotateCcw, Copy, Pencil, Wand2, Eye, Trash2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import {
  templatesApi,
  type Template,
  type TemplateRevision,
  type TemplateTypeValue,
  type TemplateWorkflowStatus,
  type TemplateStructure,
  type TemplatePart,
  type EditorDocument,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery, consumeNewFlag } from "../../lib/deepLink";
import { BlockTreeRenderer } from "../common/BlockRenderer";

const TYPE_OPTIONS: TemplateTypeValue[] = [
  "HOMEPAGE",
  "STANDARD_PAGE",
  "BLOG_INDEX",
  "SINGLE_POST",
  "CATEGORY",
  "TAG",
  "SEARCH",
  "ARCHIVE",
  "AUTHOR",
  "NOT_FOUND",
  "PRODUCT",
  "SERVICE",
  "SOLUTION",
  "CASE_STUDY",
  "LANDING_PAGE",
];
const STATUS_OPTIONS: TemplateWorkflowStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];
const STATUS_TONE: Record<TemplateWorkflowStatus, "success" | "danger" | "neutral"> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

const EMPTY_STRUCTURE: TemplateStructure = { regions: {} };

function formatStructure(structure: TemplateStructure | undefined): string {
  try {
    return JSON.stringify(structure ?? EMPTY_STRUCTURE, null, 2);
  } catch {
    return JSON.stringify(EMPTY_STRUCTURE);
  }
}

const TemplateFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: (t?: Template) => void; mode: "create" | "edit"; template?: Template }> = ({
  open,
  onClose,
  onSaved,
  mode,
  template,
}) => {
  const [type, setType] = useState<TemplateTypeValue>(template?.type ?? "STANDARD_PAGE");
  const [name, setName] = useState(template?.name ?? "");
  const [slug, setSlug] = useState(template?.slug ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [structureText, setStructureText] = useState(formatStructure(template?.currentRevision?.structure));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setType(template?.type ?? "STANDARD_PAGE");
      setName(template?.name ?? "");
      setSlug(template?.slug ?? "");
      setDescription(template?.description ?? "");
      setStructureText(formatStructure(template?.currentRevision?.structure));
      setError(null);
    }
  }, [open, template]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    let structure: TemplateStructure;
    try {
      structure = structureText.trim() ? (JSON.parse(structureText) as TemplateStructure) : EMPTY_STRUCTURE;
    } catch {
      setError("Structure must be valid JSON.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await templatesApi.create({ type, name, slug: slug || undefined, description: description || undefined, structure });
        onSaved(res.template);
      } else if (template) {
        const res = await templatesApi.update(template.id, {
          name,
          slug,
          description: description || null,
          structure,
          expectedUpdatedAt: template.updatedAt,
        });
        onSaved(res.template);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save template.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "New template" : `Edit ${template?.name}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        {mode === "create" && (
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as TemplateTypeValue)}>
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
        <Field label="Description">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
        </Field>
        <Field label="Structure (JSON)" hint="Slot/region layout. Raw JSON in this phase — the future Site Editor will replace this with a visual builder.">
          <textarea
            className="w-full px-3 py-2 rounded-lg text-xs font-mono focus:outline-none"
            style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-primary)" }}
            rows={8}
            value={structureText}
            onChange={(e) => setStructureText(e.target.value)}
          />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create template" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const TemplateDetail: React.FC<{ template: Template; onChanged: (t?: Template) => void; onDeleted: () => void }> = ({ template, onChanged, onDeleted }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { navigate } = useRouter();
  const canUpdate = hasPermission(user?.role.permissions, "templates.update");
  const canPublish = hasPermission(user?.role.permissions, "templates.publish");
  const canDelete = hasPermission(user?.role.permissions, "templates.delete");
  const canCreate = hasPermission(user?.role.permissions, "templates.create");

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<TemplateRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ pages: { id: string; title: string; status: string }[] } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ key: string; templatePartId: string | null; part: TemplatePart | null }[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    void templatesApi.usage(template.id).then(setUsage).catch(() => undefined);
  }, [template.id]);

  const loadRevisions = async () => {
    setRevisionsLoading(true);
    try {
      const res = await templatesApi.revisions(template.id);
      setRevisions(res.revisions);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const handleOpenPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const res = await templatesApi.preview(template.id);
      setPreviewData(res.regions);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not load preview.", "error");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleteOpen(false);
    setBusy(true);
    try {
      await templatesApi.remove(template.id);
      notify("Template deleted.", "success");
      onDeleted();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not delete template.", "error");
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: () => Promise<{ template: Template }>, successMsg: string) => {
    setBusy(true);
    try {
      const res = await action();
      notify(successMsg, "success");
      onChanged(res.template);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = () => run(() => templatesApi.publish(template.id), "Template published.");
  const handleArchive = async () => {
    setArchiveOpen(false);
    await run(() => templatesApi.archive(template.id), "Template archived.");
  };
  const handleDuplicate = () => run(() => templatesApi.duplicate(template.id), "Template duplicated.");
  const handleRevert = async (revisionId: string) => {
    await run(() => templatesApi.revert(template.id, revisionId), "Reverted to prior revision.");
    void loadRevisions();
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {template.name}
            <Badge tone={STATUS_TONE[template.status]}>{template.status}</Badge>
            {template.isSystem && <Badge tone="info">System</Badge>}
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {template.type} · /{template.slug} · v{template.currentRevision?.version ?? "—"} · updated {new Date(template.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end shrink-0">
          <Button variant="ghost" onClick={() => void handleOpenPreview()}>
            <Eye className="w-3.5 h-3.5" /> Preview
          </Button>
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
          {canUpdate && !template.isSystem && (
            <Button variant="secondary" onClick={() => navigate(`/website/site-editor?templateId=${template.id}`)}>
              <Wand2 className="w-3.5 h-3.5" /> Edit regions
            </Button>
          )}
          {canUpdate && !template.isSystem && (
            <Button variant="secondary" onClick={() => setEditOpen(true)} disabled={busy}>
              <Pencil className="w-3.5 h-3.5" /> Edit details
            </Button>
          )}
          {canPublish && !template.isSystem && template.status !== "PUBLISHED" && template.status !== "ARCHIVED" && (
            <Button variant="primary" onClick={() => void handlePublish()} disabled={busy}>
              <Rocket className="w-3.5 h-3.5" /> Publish
            </Button>
          )}
          {canDelete && !template.isSystem && template.status !== "ARCHIVED" && (
            <Button variant="danger" onClick={() => setArchiveOpen(true)} disabled={busy}>
              <Archive className="w-3.5 h-3.5" /> Archive
            </Button>
          )}
          {canDelete && !template.isSystem && (
            <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={busy}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>

      {template.description && (
        <div className="px-4 py-3 text-xs" style={{ color: "var(--text-secondary)" }}>
          {template.description}
        </div>
      )}

      <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
          Used by
        </p>
        {!usage || usage.pages.length === 0 ? (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            No pages are assigned to this template.
          </p>
        ) : (
          <ul className="space-y-1">
            {usage.pages.map((p) => (
              <li key={p.id} className="text-[11px] flex items-center justify-between gap-2" style={{ color: "var(--text-secondary)" }}>
                <span>{p.title}</span>
                <Badge tone={p.status === "PUBLISHED" ? "success" : "neutral"}>{p.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-4">
        <pre
          className="text-[11px] font-mono p-3 rounded-lg overflow-auto max-h-64"
          style={{ background: "var(--bg-app)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}
        >
          {formatStructure(template.currentRevision?.structure)}
        </pre>
      </div>

      <TemplateFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={(updated) => onChanged(updated)} mode="edit" template={template} />
      <ConfirmDialog
        open={archiveOpen}
        title="Archive template"
        message={`Archive "${template.name}"? Pages still assigned to it will fall back to default rendering rather than break.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setArchiveOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="Delete template"
        message={`Permanently delete "${template.name}"? This cannot be undone. Blocked while any page is still assigned to it.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={`Preview: ${template.name}`}>
        <div className="max-h-[70vh] overflow-y-auto space-y-4">
          {previewLoading ? (
            <LoadingState />
          ) : !previewData || previewData.length === 0 ? (
            <EmptyState title="Nothing to preview yet" description="Assign a Template Part to a region to see a preview." />
          ) : (
            previewData.map((r) => (
              <div key={r.key}>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>
                  {r.key}
                </p>
                {!r.part ? (
                  <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>
                    No template part assigned.
                  </p>
                ) : Array.isArray((r.part.currentRevision?.content as EditorDocument)?.blocks) ? (
                  <BlockTreeRenderer blocks={(r.part.currentRevision!.content as EditorDocument).blocks} />
                ) : (
                  <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>
                    {r.part.name} ({r.part.status}) — legacy content, no visual preview available.
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>
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
                {canUpdate && !template.isSystem && r.id !== template.currentRevisionId && (
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

export const TemplatesPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "templates.create");

  const [pageNum, setPageNum] = useState(1);
  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [status, setStatus] = useState<TemplateWorkflowStatus | "">("");
  const [type, setType] = useState<TemplateTypeValue | "">("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
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
      const res = await templatesApi.list({ page: pageNum, limit: 20, search: debouncedSearch || undefined, status: status || undefined, type: type || undefined });
      setTemplates(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((t) => t.id === prev.id) ? res.items.find((t) => t.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates.");
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
            <LayoutTemplate className="w-5 h-5" /> Templates
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Reusable page structures. A Page assigned a PUBLISHED template renders through it on the public site.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New template
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value as TemplateTypeValue | "")}>
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
      ) : templates.length === 0 ? (
        <Card>
          <EmptyState title="No templates found" description="Create a template or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelected(t)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selected?.id === t.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">{t.name}</span>
                <Badge tone={STATUS_TONE[t.status]}>{t.status}</Badge>
              </button>
            ))}
            <Pagination page={pageNum} totalPages={totalPages} onChange={setPageNum} />
          </Card>

          {selected && (
            <TemplateDetail
              template={selected}
              onChanged={(updated) => (updated ? setSelected(updated) : void load())}
              onDeleted={() => {
                setSelected(null);
                void load();
              }}
            />
          )}
        </div>
      )}

      <TemplateFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => load()} mode="create" />
    </div>
  );
};
