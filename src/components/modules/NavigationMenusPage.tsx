/**
 * Phase 5 (Navigation + Pages + Homepage) — Navigation Menus: searchable/
 * filterable/paginated list + master-detail with publish/revisions/revert/
 * duplicate/archive/delete, mirroring TemplatePartsPage.tsx's shape
 * exactly (same draft/publish/revision architecture). The one real
 * addition is the nested item tree editor (MenuItemEditor below) — add/
 * remove/reorder/nest items, each with a label, a link type + target
 * picker (Page/Post/Category/Tag/Product or a custom URL), and an
 * open-in-new-tab toggle.
 */
import React, { useEffect, useState } from "react";
import { Menu, Plus, Search, Rocket, Archive, History, RotateCcw, Copy, Pencil, Eye, Trash2, ChevronUp, ChevronDown, X, CornerDownRight } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  navigationMenusApi,
  pagesApi,
  postsApi,
  categoriesApi,
  tagsApi,
  productsApi,
  type NavigationMenu,
  type NavigationMenuRevision,
  type NavigationMenuTypeValue,
  type TemplateWorkflowStatus,
  type MenuItem,
  type MenuLinkType,
  type CmsPage,
  type CmsPost,
  type CmsCategory,
  type CmsTag,
  type CatalogProduct,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Pagination, Modal, Field, ConfirmDialog } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";
import { initialSearchFromQuery, consumeNewFlag } from "../../lib/deepLink";

const TYPE_OPTIONS: NavigationMenuTypeValue[] = ["PRIMARY", "HEADER", "FOOTER", "MOBILE", "CUSTOM"];
const STATUS_OPTIONS: TemplateWorkflowStatus[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];
const STATUS_TONE: Record<TemplateWorkflowStatus, "success" | "danger" | "neutral"> = {
  DRAFT: "neutral",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};
const LINK_TYPE_OPTIONS: { value: MenuLinkType; label: string }[] = [
  { value: "page", label: "Page" },
  { value: "post", label: "Post" },
  { value: "category", label: "Category" },
  { value: "tag", label: "Tag" },
  { value: "product", label: "Product/Service/Solution" },
  { value: "custom", label: "Custom URL" },
];
const MAX_DEPTH = 4;

function genId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function newItem(): MenuItem {
  return { id: genId(), label: "", linkType: "custom", url: "", openInNewTab: false, children: [] };
}

function updateItem(items: MenuItem[], id: string, patch: Partial<MenuItem>): MenuItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : { ...item, children: updateItem(item.children, id, patch) }));
}

function removeItem(items: MenuItem[], id: string): MenuItem[] {
  return items.filter((item) => item.id !== id).map((item) => ({ ...item, children: removeItem(item.children, id) }));
}

function addChild(items: MenuItem[], parentId: string, child: MenuItem): MenuItem[] {
  return items.map((item) =>
    item.id === parentId ? { ...item, children: [...item.children, child] } : { ...item, children: addChild(item.children, parentId, child) }
  );
}

function moveItem(items: MenuItem[], id: string, dir: "up" | "down"): MenuItem[] {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    return items.map((item) => ({ ...item, children: moveItem(item.children, id, dir) }));
  }
  const to = dir === "up" ? index - 1 : index + 1;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

interface TargetOptions {
  pages: CmsPage[];
  posts: CmsPost[];
  categories: CmsCategory[];
  tags: CmsTag[];
  products: CatalogProduct[];
}

const MenuItemRow: React.FC<{
  item: MenuItem;
  depth: number;
  siblingCount: number;
  index: number;
  targets: TargetOptions;
  readOnly: boolean;
  onChange: (patch: Partial<MenuItem>) => void;
  onRemove: () => void;
  onMove: (dir: "up" | "down") => void;
  onAddChild: () => void;
  renderChildren: () => React.ReactNode;
}> = ({ item, depth, siblingCount, index, targets, readOnly, onChange, onRemove, onMove, onAddChild, renderChildren }) => {
  const targetOptions = (() => {
    switch (item.linkType) {
      case "page":
        return targets.pages.map((p) => ({ id: p.id, label: p.title }));
      case "post":
        return targets.posts.map((p) => ({ id: p.id, label: p.title }));
      case "category":
        return targets.categories.map((c) => ({ id: c.id, label: c.name }));
      case "tag":
        return targets.tags.map((t) => ({ id: t.id, label: t.name }));
      case "product":
        return targets.products.map((p) => ({ id: p.id, label: p.name }));
      default:
        return [];
    }
  })();

  return (
    <li>
      <div
        className="flex items-center gap-2 p-2 rounded-lg border flex-wrap"
        style={{ borderColor: "var(--border)", marginLeft: depth * 20 }}
      >
        {depth > 0 && <CornerDownRight className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />}
        <div className="flex flex-col shrink-0">
          <button type="button" disabled={readOnly || index === 0} onClick={() => onMove("up")} className="p-0.5" title="Move up">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={readOnly || index === siblingCount - 1} onClick={() => onMove("down")} className="p-0.5" title="Move down">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        <Input
          placeholder="Label"
          value={item.label}
          disabled={readOnly}
          onChange={(e) => onChange({ label: e.target.value })}
          className="w-36"
        />
        <Select
          value={item.linkType}
          disabled={readOnly}
          onChange={(e) => onChange({ linkType: e.target.value as MenuLinkType, targetId: undefined, url: e.target.value === "custom" ? item.url ?? "" : undefined })}
          className="w-40"
        >
          {LINK_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {item.linkType === "custom" ? (
          <Input placeholder="https://… or /path" value={item.url ?? ""} disabled={readOnly} onChange={(e) => onChange({ url: e.target.value })} className="flex-1 min-w-[160px]" />
        ) : (
          <Select value={item.targetId ?? ""} disabled={readOnly} onChange={(e) => onChange({ targetId: e.target.value || undefined })} className="flex-1 min-w-[160px]">
            <option value="">Select…</option>
            {targetOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
        <label className="flex items-center gap-1.5 text-[11px] shrink-0" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={item.openInNewTab} disabled={readOnly} onChange={(e) => onChange({ openInNewTab: e.target.checked })} />
          New tab
        </label>
        {!readOnly && depth < MAX_DEPTH - 1 && (
          <Button type="button" variant="ghost" onClick={onAddChild} title="Add nested item">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        )}
        {!readOnly && (
          <Button type="button" variant="ghost" onClick={onRemove} aria-label={`Remove ${item.label || "item"}`}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      {renderChildren()}
    </li>
  );
};

const MenuItemEditor: React.FC<{ items: MenuItem[]; onChange: (items: MenuItem[]) => void; targets: TargetOptions; readOnly: boolean }> = ({
  items,
  onChange,
  targets,
  readOnly,
}) => {
  const renderList = (list: MenuItem[], depth: number): React.ReactNode => (
    <ul className="space-y-2">
      {list.map((item, index) => (
        <MenuItemRow
          key={item.id}
          item={item}
          depth={depth}
          index={index}
          siblingCount={list.length}
          targets={targets}
          readOnly={readOnly}
          onChange={(patch) => onChange(updateItem(items, item.id, patch))}
          onRemove={() => onChange(removeItem(items, item.id))}
          onMove={(dir) => onChange(moveItem(items, item.id, dir))}
          onAddChild={() => onChange(addChild(items, item.id, newItem()))}
          renderChildren={() => item.children.length > 0 && <div className="mt-2">{renderList(item.children, depth + 1)}</div>}
        />
      ))}
    </ul>
  );

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <EmptyState title="No items yet" description="Add a link to get started." />
      ) : (
        renderList(items, 0)
      )}
      {!readOnly && (
        <Button type="button" variant="secondary" onClick={() => onChange([...items, newItem()])}>
          <Plus className="w-3.5 h-3.5" /> Add item
        </Button>
      )}
    </div>
  );
};

function flattenLabels(items: MenuItem[], prefix = ""): string[] {
  return items.flatMap((item) => [`${prefix}${item.label || "(untitled)"}`, ...flattenLabels(item.children, `${prefix}— `)]);
}

const MenuFormModal: React.FC<{ open: boolean; onClose: () => void; onSaved: (m?: NavigationMenu) => void; mode: "create" | "edit"; menu?: NavigationMenu; targets: TargetOptions }> = ({
  open,
  onClose,
  onSaved,
  mode,
  menu,
  targets,
}) => {
  const [type, setType] = useState<NavigationMenuTypeValue>(menu?.type ?? "PRIMARY");
  const [name, setName] = useState(menu?.name ?? "");
  const [slug, setSlug] = useState(menu?.slug ?? "");
  const [items, setItems] = useState<MenuItem[]>(menu?.currentRevision?.items ?? []);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setType(menu?.type ?? "PRIMARY");
      setName(menu?.name ?? "");
      setSlug(menu?.slug ?? "");
      setItems(menu?.currentRevision?.items ?? []);
      setError(null);
    }
  }, [open, menu]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "create") {
        const res = await navigationMenusApi.create({ type, name, slug: slug || undefined, items });
        onSaved(res.navigationMenu);
      } else if (menu) {
        const res = await navigationMenusApi.update(menu.id, { name, slug, items, expectedUpdatedAt: menu.updatedAt });
        onSaved(res.navigationMenu);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save navigation menu.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "create" ? "New navigation menu" : `Edit ${menu?.name}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {error && <div className="text-xs rounded-lg px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/30">{error}</div>}
        {mode === "create" && (
          <Field label="Location">
            <Select value={type} onChange={(e) => setType(e.target.value as NavigationMenuTypeValue)}>
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
        <div>
          <p className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
            Menu items
          </p>
          <MenuItemEditor items={items} onChange={setItems} targets={targets} readOnly={false} />
        </div>
        <div className="pt-2 border-t flex justify-end gap-2" style={{ borderColor: "var(--border)" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {mode === "create" ? "Create menu" : "Save changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const MenuDetail: React.FC<{ menu: NavigationMenu; targets: TargetOptions; onChanged: (m?: NavigationMenu) => void; onDeleted: () => void }> = ({
  menu,
  targets,
  onChanged,
  onDeleted,
}) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canUpdate = hasPermission(user?.role.permissions, "navigation_menus.update");
  const canPublish = hasPermission(user?.role.permissions, "navigation_menus.publish");
  const canDelete = hasPermission(user?.role.permissions, "navigation_menus.delete");
  const canCreate = hasPermission(user?.role.permissions, "navigation_menus.create");

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<NavigationMenuRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [usage, setUsage] = useState<{
    templateParts: { id: string; name: string; status: string }[];
    pages: { id: string; title: string; status: string }[];
  } | null>(null);

  useEffect(() => {
    void navigationMenusApi.usage(menu.id).then(setUsage).catch(() => undefined);
  }, [menu.id]);

  const loadRevisions = async () => {
    setRevisionsLoading(true);
    try {
      const res = await navigationMenusApi.revisions(menu.id);
      setRevisions(res.revisions);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleteOpen(false);
    setBusy(true);
    try {
      await navigationMenusApi.remove(menu.id);
      notify("Navigation menu deleted.", "success");
      onDeleted();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not delete navigation menu.", "error");
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: () => Promise<{ navigationMenu: NavigationMenu }>, successMsg: string) => {
    setBusy(true);
    try {
      const res = await action();
      notify(successMsg, "success");
      onChanged(res.navigationMenu);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Action failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = () => run(() => navigationMenusApi.publish(menu.id), "Navigation menu published.");
  const handleArchive = async () => {
    setArchiveOpen(false);
    await run(() => navigationMenusApi.archive(menu.id), "Navigation menu archived.");
  };
  const handleDuplicate = () => run(() => navigationMenusApi.duplicate(menu.id), "Navigation menu duplicated.");
  const handleRevert = async (revisionId: string) => {
    await run(() => navigationMenusApi.revert(menu.id, revisionId), "Reverted to prior revision.");
    void loadRevisions();
  };

  const items = menu.currentRevision?.items ?? [];

  return (
    <Card>
      <div className="px-4 py-3 border-b flex items-start justify-between gap-3" style={{ borderColor: "var(--border)" }}>
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            {menu.name}
            <Badge tone={STATUS_TONE[menu.status]}>{menu.status}</Badge>
            {menu.isSystem && <Badge tone="info">System</Badge>}
          </h2>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {menu.type} · /{menu.slug} · v{menu.currentRevision?.version ?? "—"} · updated {new Date(menu.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-1.5 flex-wrap justify-end shrink-0">
          <Button variant="ghost" onClick={() => setPreviewOpen(true)}>
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
          {canUpdate && !menu.isSystem && (
            <Button variant="secondary" onClick={() => setEditOpen(true)} disabled={busy}>
              <Pencil className="w-3.5 h-3.5" /> Edit items
            </Button>
          )}
          {canPublish && !menu.isSystem && menu.status !== "PUBLISHED" && menu.status !== "ARCHIVED" && (
            <Button variant="primary" onClick={() => void handlePublish()} disabled={busy}>
              <Rocket className="w-3.5 h-3.5" /> Publish
            </Button>
          )}
          {canDelete && !menu.isSystem && menu.status !== "ARCHIVED" && (
            <Button variant="danger" onClick={() => setArchiveOpen(true)} disabled={busy}>
              <Archive className="w-3.5 h-3.5" /> Archive
            </Button>
          )}
          {canDelete && !menu.isSystem && (
            <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={busy}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
        <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
          Used by
        </p>
        {!usage || (usage.templateParts.length === 0 && usage.pages.length === 0) ? (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Not assigned to any template part or page yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {usage.templateParts.map((p) => (
              <li key={p.id} className="text-[11px] flex items-center justify-between gap-2" style={{ color: "var(--text-secondary)" }}>
                <span>Template part: {p.name}</span>
                <Badge tone={p.status === "PUBLISHED" ? "success" : "neutral"}>{p.status}</Badge>
              </li>
            ))}
            {usage.pages.map((p) => (
              <li key={p.id} className="text-[11px] flex items-center justify-between gap-2" style={{ color: "var(--text-secondary)" }}>
                <span>Page: {p.title}</span>
                <Badge tone={p.status === "PUBLISHED" ? "success" : "neutral"}>{p.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-4">
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
          Items
        </p>
        <MenuItemEditor items={items} onChange={() => undefined} targets={targets} readOnly />
      </div>

      <MenuFormModal open={editOpen} onClose={() => setEditOpen(false)} onSaved={(updated) => onChanged(updated)} mode="edit" menu={menu} targets={targets} />
      <ConfirmDialog
        open={archiveOpen}
        title="Archive navigation menu"
        message={`Archive "${menu.name}"? Anything still assigned to it keeps rendering its last published content.`}
        confirmLabel="Archive"
        destructive
        onConfirm={handleArchive}
        onCancel={() => setArchiveOpen(false)}
      />
      <ConfirmDialog
        open={deleteOpen}
        title="Delete navigation menu"
        message={`Permanently delete "${menu.name}"? This cannot be undone. Blocked while any template part or page still references it.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteOpen(false)}
      />
      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title={`Preview: ${menu.name}`}>
        {items.length === 0 ? (
          <EmptyState title="Nothing to preview yet" description="Add items to see a preview." />
        ) : (
          <ul className="space-y-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            {flattenLabels(items).map((label, i) => (
              <li key={i}>{label}</li>
            ))}
          </ul>
        )}
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
                {canUpdate && !menu.isSystem && r.id !== menu.currentRevisionId && (
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

export const NavigationMenusPage: React.FC = () => {
  const { user } = useAuth();
  const canCreate = hasPermission(user?.role.permissions, "navigation_menus.create");

  const [pageNum, setPageNum] = useState(1);
  const [search, setSearch] = useState(initialSearchFromQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [status, setStatus] = useState<TemplateWorkflowStatus | "">("");
  const [type, setType] = useState<NavigationMenuTypeValue | "">("");
  const [menus, setMenus] = useState<NavigationMenu[]>([]);
  const [selected, setSelected] = useState<NavigationMenu | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [targets, setTargets] = useState<TargetOptions>({ pages: [], posts: [], categories: [], tags: [], products: [] });

  useEffect(() => {
    if (consumeNewFlag()) setCreateOpen(true);
  }, []);

  useEffect(() => {
    void Promise.all([
      pagesApi.list({ limit: 100 }),
      postsApi.list({ limit: 100 }),
      categoriesApi.list(),
      tagsApi.list(),
      productsApi.list({ limit: 100 }),
    ])
      .then(([pagesRes, postsRes, categoriesRes, tagsRes, productsRes]) => {
        setTargets({ pages: pagesRes.items, posts: postsRes.items, categories: categoriesRes.categories, tags: tagsRes.tags, products: productsRes.items });
      })
      .catch(() => undefined);
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
      const res = await navigationMenusApi.list({ page: pageNum, limit: 20, search: debouncedSearch || undefined, status: status || undefined, type: type || undefined });
      setMenus(res.items);
      setTotalPages(res.totalPages);
      setSelected((prev) => (prev && res.items.some((m) => m.id === prev.id) ? res.items.find((m) => m.id === prev.id)! : res.items[0] ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load navigation menus.");
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
            <Menu className="w-5 h-5" /> Navigation Menus
          </h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Primary/Header/Footer/Mobile menus, assignable to a Header/Footer/Mobile Template Part in the Site Editor.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> New menu
          </Button>
        )}
      </div>

      <Card className="p-3 flex flex-col sm:flex-row gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: "var(--text-muted)" }} />
          <Input placeholder="Search menus…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value as NavigationMenuTypeValue | "")}>
          <option value="">All locations</option>
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
      ) : menus.length === 0 ? (
        <Card>
          <EmptyState title="No navigation menus found" description="Create a menu or adjust your filters." />
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[300px_1fr] gap-4">
          <Card className="p-2 h-fit">
            {menus.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold mb-0.5 flex items-center justify-between gap-2"
                style={selected?.id === m.id ? { background: "var(--accent-soft)", color: "var(--accent)" } : { color: "var(--text-secondary)" }}
              >
                <span className="truncate">
                  {m.name} <span className="font-normal" style={{ color: "var(--text-muted)" }}>({m.type})</span>
                </span>
                <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
              </button>
            ))}
            <Pagination page={pageNum} totalPages={totalPages} onChange={setPageNum} />
          </Card>

          {selected && (
            <MenuDetail
              menu={selected}
              targets={targets}
              onChanged={(updated) => (updated ? setSelected(updated) : void load())}
              onDeleted={() => {
                setSelected(null);
                void load();
              }}
            />
          )}
        </div>
      )}

      <MenuFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={() => load()} mode="create" targets={targets} />
    </div>
  );
};
