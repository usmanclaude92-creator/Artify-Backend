/** Phase 8 — CMS taxonomy: category and tag CRUD, side by side. */
import React, { useEffect, useState } from "react";
import { Tag as TagIcon, FolderTree, Plus, Trash2, Pencil } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { categoriesApi, tagsApi, type CmsCategory, type CmsTag } from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, LoadingState, EmptyState, Modal, Field, ConfirmDialog, Badge } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

const CategoryFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; category?: CmsCategory; categories: CmsCategory[] }> = ({
  open,
  onClose,
  onSaved,
  category,
  categories,
}) => {
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(category?.name ?? "");
      setDescription(category?.description ?? "");
      setParentId(category?.parentId ?? "");
      setError(null);
    }
  }, [open, category]);

  // Phase 7 — a category cannot be its own parent; the server also rejects
  // a cycle through an ancestor, but there's no point offering one here.
  const parentOptions = categories.filter((c) => c.id !== category?.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (category) await categoriesApi.update(category.id, { name, description, parentId: parentId || null });
      else await categoriesApi.create({ name, description: description || undefined, parentId: parentId || undefined });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save category.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={category ? `Edit ${category.name}` : "New category"}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Parent category" hint="Builds a simple category hierarchy.">
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">— No parent (top-level) —</option>
            {parentOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description">
          <Input value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const TagFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: () => void; tag?: CmsTag }> = ({ open, onClose, onSaved, tag }) => {
  const [name, setName] = useState(tag?.name ?? "");
  const [description, setDescription] = useState(tag?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(tag?.name ?? "");
      setDescription(tag?.description ?? "");
      setError(null);
    }
  }, [open, tag]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (tag) await tagsApi.update(tag.id, { name, description });
      else await tagsApi.create({ name, description: description || undefined });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save tag.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={tag ? `Edit ${tag.name}` : "New tag"}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <Input value={description ?? ""} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export const CmsTaxonomyPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(user?.role.permissions, "content.create");
  const canUpdate = hasPermission(user?.role.permissions, "content.update");
  const canDelete = hasPermission(user?.role.permissions, "content.delete");

  const [categories, setCategories] = useState<CmsCategory[]>([]);
  const [tags, setTags] = useState<CmsTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryModal, setCategoryModal] = useState<{ open: boolean; category?: CmsCategory }>({ open: false });
  const [tagModal, setTagModal] = useState<{ open: boolean; tag?: CmsTag }>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "category" | "tag"; id: string; name: string } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [c, t] = await Promise.all([categoriesApi.list(), tagsApi.list()]);
      setCategories(c.categories);
      setTags(t.tags);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === "category") await categoriesApi.remove(deleteTarget.id);
      else await tagsApi.remove(deleteTarget.id);
      notify(`${deleteTarget.kind === "category" ? "Category" : "Tag"} deleted.`, "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not delete.", "error");
    } finally {
      setDeleteTarget(null);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
          Categories & Tags
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Taxonomy used to organize blog posts.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
              <FolderTree className="w-3.5 h-3.5" /> Categories
            </h2>
            {canCreate && (
              <Button variant="primary" onClick={() => setCategoryModal({ open: true })}>
                <Plus className="w-3.5 h-3.5" /> New
              </Button>
            )}
          </div>
          {categories.length === 0 ? (
            <EmptyState title="No categories yet" description="" />
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {categories.map((c) => (
                <li key={c.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                      {c.name}
                      <Badge tone="neutral">{c.postCount} post(s)</Badge>
                    </p>
                    <p style={{ color: "var(--text-muted)" }}>
                      /{c.slug}
                      {c.parent && <> · child of {c.parent.name}</>}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {canUpdate && (
                      <Button variant="ghost" onClick={() => setCategoryModal({ open: true, category: c })} aria-label="Edit category">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" onClick={() => setDeleteTarget({ kind: "category", id: c.id, name: c.name })} aria-label="Delete category">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
            <h2 className="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
              <TagIcon className="w-3.5 h-3.5" /> Tags
            </h2>
            {canCreate && (
              <Button variant="primary" onClick={() => setTagModal({ open: true })}>
                <Plus className="w-3.5 h-3.5" /> New
              </Button>
            )}
          </div>
          {tags.length === 0 ? (
            <EmptyState title="No tags yet" description="" />
          ) : (
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {tags.map((t) => (
                <li key={t.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                      {t.name}
                      <Badge tone="neutral">{t.postCount} post(s)</Badge>
                    </p>
                    <p style={{ color: "var(--text-muted)" }}>
                      /{t.slug}
                      {t.description && <> · {t.description}</>}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {canUpdate && (
                      <Button variant="ghost" onClick={() => setTagModal({ open: true, tag: t })} aria-label="Edit tag">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" onClick={() => setDeleteTarget({ kind: "tag", id: t.id, name: t.name })} aria-label="Delete tag">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CategoryFormModal
        open={categoryModal.open}
        onClose={() => setCategoryModal({ open: false })}
        onSaved={load}
        category={categoryModal.category}
        categories={categories}
      />
      <TagFormModal open={tagModal.open} onClose={() => setTagModal({ open: false })} onSaved={load} tag={tagModal.tag} />
      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete ${deleteTarget?.kind ?? ""}`}
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
