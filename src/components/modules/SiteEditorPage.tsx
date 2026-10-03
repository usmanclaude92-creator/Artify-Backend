/**
 * Phase 2 (Site Editor) — visual block editor for CMS Pages, built on the
 * existing Page/Template/TemplatePart architecture (no new CMS, no new
 * workflow): persistence goes through pagesApi.create/update exactly like
 * PagesPage.tsx, revisions/publish/revert reuse the same endpoints, and
 * `body` is kept in sync as a flattened HTML fallback (src/lib/editorBlocks.ts's
 * blocksToPlainHtml) so a page built here still renders if a caller only
 * reads `body` (docs/control-center-public-site-integration.md's
 * safe-fallback requirement) — never a second source of truth.
 *
 * Reached via /website/site-editor?pageId=<id> (src/lib/deepLink.ts's query
 * convention — the router has no dynamic path segments) from PagesPage's
 * "Open Site Editor" action, or opened bare to pick/create a page first.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Wand2,
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  Save,
  Rocket,
  History,
  RotateCcw,
  Eye,
  X,
  Smartphone,
  Tablet,
  Monitor,
  ArrowLeft,
  PanelsTopLeft,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useRouter } from "../../lib/router";
import { hasPermission } from "../../lib/permissions";
import {
  pagesApi,
  templatesApi,
  templatePartsApi,
  siteSettingsApi,
  mediaApi,
  normalizeTemplateRegions,
  type CmsPage,
  type EditorDocument,
  type EditorBlock,
  type BlockType,
  type Template,
  type TemplatePart,
  type TemplateRegionEntry,
  type TemplatePartRevision,
  type ContentRevision,
  type GlobalStyles,
} from "../../lib/api";
import { ApiClientError } from "../../lib/apiClient";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Modal, Field, ConfirmDialog, Pagination } from "../ui/ui";
import { MediaPickerModal } from "../common/MediaPickerModal";
import { RichTextEditor } from "../common/RichTextEditor";
import { BlockTreeRenderer } from "../common/BlockRenderer";
import {
  createBlock,
  findBlock,
  insertBlock,
  removeBlock,
  duplicateBlock,
  updateBlockProps,
  moveSibling,
  moveIntoParent,
  listContainers,
  isContainerBlock,
  blocksToPlainHtml,
  collectImageMediaIds,
} from "../../lib/editorBlocks";

const EMPTY_DOC: EditorDocument = { version: 1, blocks: [] };

const BLOCK_LABELS: Record<BlockType, string> = {
  section: "Section",
  container: "Container",
  columns: "Columns",
  text: "Text",
  heading: "Heading",
  image: "Image",
  button: "Button",
  card: "Card",
  spacer: "Spacer",
  divider: "Divider",
  templatePart: "Template part",
};

const ADDABLE_TYPES: BlockType[] = ["section", "container", "columns", "heading", "text", "image", "button", "card", "spacer", "divider", "templatePart"];

const VIEWPORT_WIDTH: Record<"desktop" | "tablet" | "mobile", string> = { desktop: "100%", tablet: "768px", mobile: "375px" };
type Viewport = keyof typeof VIEWPORT_WIDTH;

function docsEqual(a: EditorDocument, b: EditorDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Picker shown when the Site Editor is opened without ?pageId=
// ---------------------------------------------------------------------------

const PagePicker: React.FC<{ onOpen: (id: string) => void }> = ({ onOpen }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const canCreate = hasPermission(user?.role.permissions, "content.create");
  const [items, setItems] = useState<CmsPage[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await pagesApi.list({ page, limit: 20, sort: "updatedAt", order: "desc" });
      setItems(res.items);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pages.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await pagesApi.create({ title: newTitle.trim(), body: "", editorBlocks: EMPTY_DOC });
      notify("Page created.", "success");
      onOpen(res.page.id);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not create page.", "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
          <Wand2 className="w-5 h-5" /> Site Editor
        </h1>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Pick a page to edit visually, or start a new one.
        </p>
      </div>

      {canCreate && (
        <Card className="p-4">
          <form onSubmit={handleCreate} className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="New page title">
                <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. About Us" />
              </Field>
            </div>
            <Button type="submit" variant="primary" disabled={creating || !newTitle.trim()}>
              <Plus className="w-4 h-4" /> Create & edit
            </Button>
          </form>
        </Card>
      )}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="No pages yet" description="Create one above to start building in the Site Editor." />
        </Card>
      ) : (
        <Card className="p-2">
          {items.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpen(p.id)}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-semibold mb-0.5 flex items-center justify-between gap-2"
              style={{ color: "var(--text-secondary)" }}
            >
              <span className="truncate">{p.title}</span>
              <Badge tone={p.status === "PUBLISHED" ? "success" : "neutral"}>{p.status}</Badge>
            </button>
          ))}
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </Card>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Canvas — visual, read/select/click-to-configure rendering of the tree
// ---------------------------------------------------------------------------

const CanvasImage: React.FC<{ mediaId: string; alt?: string; cache: Record<string, string>; onResolved: (id: string, url: string) => void }> = ({
  mediaId,
  alt,
  cache,
  onResolved,
}) => {
  useEffect(() => {
    if (!mediaId || cache[mediaId]) return;
    let cancelled = false;
    void mediaApi
      .getReadUrl(mediaId)
      .then((res) => !cancelled && onResolved(mediaId, res.url))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mediaId, cache, onResolved]);

  if (!mediaId) {
    return (
      <div className="h-32 flex items-center justify-center rounded-lg border border-dashed" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
        <ImageIcon className="w-5 h-5" />
      </div>
    );
  }
  const url = cache[mediaId];
  return url ? (
    <img src={url} alt={alt ?? ""} className="max-w-full rounded-lg" />
  ) : (
    <div className="h-32 flex items-center justify-center rounded-lg" style={{ background: "var(--bg-app)" }}>
      <ImageIcon className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
    </div>
  );
};

const CanvasBlock: React.FC<{
  block: EditorBlock;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onAddChild: (parentId: string, type: BlockType) => void;
  mediaCache: Record<string, string>;
  onMediaResolved: (id: string, url: string) => void;
  templatePartNames: Record<string, string>;
  globalStyles: GlobalStyles | null;
}> = ({ block, depth, selectedId, onSelect, onDelete, onDuplicate, onMove, onAddChild, mediaCache, onMediaResolved, templatePartNames, globalStyles }) => {
  const selected = block.id === selectedId;
  const [addChildOpen, setAddChildOpen] = useState(false);

  const frame = (inner: React.ReactNode) => (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(block.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(block.id);
        }
      }}
      className="relative rounded-lg p-2 mb-2 cursor-pointer"
      style={{
        border: selected ? "2px solid var(--accent)" : "1px dashed var(--border)",
        background: depth % 2 === 0 ? "transparent" : "var(--bg-app)",
      }}
    >
      {selected && (
        <div className="absolute -top-3 right-1 flex items-center gap-1 rounded-md px-1 py-0.5 shadow-sm" style={{ background: "var(--accent)" }}>
          <span className="text-[10px] font-bold text-white px-1">{BLOCK_LABELS[block.type]}</span>
          <button type="button" title="Move up" onClick={(e) => (e.stopPropagation(), onMove(block.id, "up"))} className="p-1 text-white">
            <ChevronUp className="w-3 h-3" />
          </button>
          <button type="button" title="Move down" onClick={(e) => (e.stopPropagation(), onMove(block.id, "down"))} className="p-1 text-white">
            <ChevronDown className="w-3 h-3" />
          </button>
          <button type="button" title="Duplicate" onClick={(e) => (e.stopPropagation(), onDuplicate(block.id))} className="p-1 text-white">
            <Copy className="w-3 h-3" />
          </button>
          <button type="button" title="Delete" onClick={(e) => (e.stopPropagation(), onDelete(block.id))} className="p-1 text-white">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
      {inner}
    </div>
  );

  switch (block.type) {
    case "section":
    case "container":
    case "columns":
      return frame(
        <div
          className={block.type === "columns" ? "grid gap-3" : ""}
          style={block.type === "columns" ? { gridTemplateColumns: `repeat(${Number(block.props.columnCount) || 2}, minmax(0,1fr))` } : undefined}
        >
          {(block.children ?? []).map((c) => (
            <CanvasBlock
              key={c.id}
              block={c}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onMove={onMove}
              onAddChild={onAddChild}
              mediaCache={mediaCache}
              onMediaResolved={onMediaResolved}
              templatePartNames={templatePartNames}
              globalStyles={globalStyles}
            />
          ))}
          {addChildOpen ? (
            <div className="flex flex-wrap gap-1 p-2 rounded-lg" style={{ background: "var(--bg-surface-alt)" }}>
              {ADDABLE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="text-[11px] px-2 py-1 rounded-md"
                  style={{ background: "var(--bg-hover)", color: "var(--text-primary)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddChild(block.id, t);
                    setAddChildOpen(false);
                  }}
                >
                  {BLOCK_LABELS[t]}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="text-[11px] px-2 py-1 rounded-md flex items-center gap-1"
              style={{ color: "var(--text-muted)", border: "1px dashed var(--border)" }}
              onClick={(e) => {
                e.stopPropagation();
                setAddChildOpen(true);
              }}
            >
              <Plus className="w-3 h-3" /> Add block inside
            </button>
          )}
        </div>
      );
    case "text":
      return frame(<div className="text-sm cms-rendered-body" dangerouslySetInnerHTML={{ __html: String(block.props.html ?? "") }} />);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(block.props.level) || 2));
      const Tag = (`h${level}` as unknown) as "h1";
      const headingKey = `h${level}` as keyof GlobalStyles["typography"]["headingScale"];
      return frame(
        <Tag
          className={globalStyles ? undefined : "font-bold"}
          style={
            globalStyles
              ? {
                  fontFamily: globalStyles.typography.fontFamilyHeading,
                  fontWeight: globalStyles.typography.fontWeightHeading,
                  fontSize: globalStyles.typography.headingScale[headingKey],
                  lineHeight: globalStyles.typography.lineHeightHeading,
                  color: globalStyles.colors.textPrimary,
                  margin: 0,
                }
              : { color: "var(--text-primary)" }
          }
        >
          {String(block.props.text ?? "")}
        </Tag>
      );
    }
    case "image":
      return frame(<CanvasImage mediaId={String(block.props.mediaId ?? "")} alt={String(block.props.alt ?? "")} cache={mediaCache} onResolved={onMediaResolved} />);
    case "button":
      return frame(
        <span
          className="inline-block text-xs font-semibold"
          style={
            globalStyles
              ? {
                  background: globalStyles.buttons.primaryBg,
                  color: globalStyles.buttons.primaryText,
                  borderRadius: globalStyles.buttons.radius,
                  padding: `${globalStyles.buttons.paddingY} ${globalStyles.buttons.paddingX}`,
                  fontWeight: globalStyles.buttons.fontWeight,
                }
              : { background: "var(--accent)", color: "#fff", padding: "0.375rem 0.75rem", borderRadius: "0.5rem" }
          }
        >
          {String(block.props.label ?? "Button")}
        </span>
      );
    case "card":
      return frame(
        <div
          className="p-3"
          style={
            globalStyles
              ? { background: globalStyles.colors.surface, border: `1px solid ${globalStyles.colors.border}`, borderRadius: globalStyles.layout.borderRadius.md }
              : { background: "var(--bg-app)", borderRadius: "0.5rem" }
          }
        >
          {!!block.props.title && (
            <p
              className="font-bold text-sm mb-1"
              style={{ color: globalStyles ? globalStyles.colors.textPrimary : "var(--text-primary)", fontFamily: globalStyles?.typography.fontFamilyHeading }}
            >
              {String(block.props.title)}
            </p>
          )}
          {!!block.props.body && <div className="text-xs cms-rendered-body" dangerouslySetInnerHTML={{ __html: String(block.props.body) }} />}
        </div>
      );
    case "spacer":
      return frame(<div style={{ height: Number(block.props.height) || 40 }} />);
    case "divider":
      return frame(<hr style={{ borderColor: "var(--border)" }} />);
    case "templatePart": {
      const id = String(block.props.templatePartId ?? "");
      return frame(
        <div className="text-xs italic flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <PanelsTopLeft className="w-3.5 h-3.5" />
          {id ? (templatePartNames[id] ?? "Template part") : "No template part selected"}
        </div>
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Inspector — props editor for the selected block
// ---------------------------------------------------------------------------

const Inspector: React.FC<{
  doc: EditorDocument;
  block: EditorBlock | null;
  onChangeProps: (id: string, patch: Record<string, unknown>) => void;
  onMoveInto: (id: string, parentId: string | null) => void;
  templateParts: TemplatePart[];
}> = ({ doc, block, onChangeProps, onMoveInto, templateParts }) => {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!block) {
    return (
      <Card className="p-4">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Select a block to configure it.
        </p>
      </Card>
    );
  }

  const containers = listContainers(doc.blocks).filter((c) => c.id !== block.id);

  const moveIntoField = (
    <Field label="Container" hint="Which section/container/columns/card this block lives inside.">
      <Select
        value={(() => {
          const found = containers.find((c) => (c.children ?? []).some((ch) => ch.id === block.id));
          return found?.id ?? "";
        })()}
        onChange={(e) => onMoveInto(block.id, e.target.value || null)}
      >
        <option value="">Top level</option>
        {containers.map((c) => (
          <option key={c.id} value={c.id}>
            {BLOCK_LABELS[c.type]} ({c.id.slice(0, 6)})
          </option>
        ))}
      </Select>
    </Field>
  );

  const body = (() => {
    switch (block.type) {
      case "section":
        return (
          <>
            <Field label="Background color">
              <Input value={String(block.props.backgroundColor ?? "")} onChange={(e) => onChangeProps(block.id, { backgroundColor: e.target.value })} placeholder="#ffffff" />
            </Field>
            <Field label="Vertical padding">
              <Select value={String(block.props.paddingY ?? "md")} onChange={(e) => onChangeProps(block.id, { paddingY: e.target.value })}>
                {["none", "sm", "md", "lg", "xl"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        );
      case "container":
        return (
          <Field label="Max width">
            <Select value={String(block.props.maxWidth ?? "lg")} onChange={(e) => onChangeProps(block.id, { maxWidth: e.target.value })}>
              {["sm", "md", "lg", "xl", "full"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        );
      case "columns":
        return (
          <>
            <Field label="Columns">
              <Input
                type="number"
                min={2}
                max={4}
                value={Number(block.props.columnCount) || 2}
                onChange={(e) => onChangeProps(block.id, { columnCount: Number(e.target.value) })}
              />
            </Field>
            <Field label="Gap">
              <Select value={String(block.props.gap ?? "md")} onChange={(e) => onChangeProps(block.id, { gap: e.target.value })}>
                {["none", "sm", "md", "lg"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        );
      case "text":
        return (
          <Field label="Content">
            <RichTextEditor value={String(block.props.html ?? "")} onChange={(html) => onChangeProps(block.id, { html })} />
          </Field>
        );
      case "heading":
        return (
          <>
            <Field label="Text">
              <Input value={String(block.props.text ?? "")} onChange={(e) => onChangeProps(block.id, { text: e.target.value })} />
            </Field>
            <Field label="Level">
              <Select value={Number(block.props.level) || 2} onChange={(e) => onChangeProps(block.id, { level: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6].map((l) => (
                  <option key={l} value={l}>
                    H{l}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        );
      case "image":
        return (
          <>
            <Field label="Image">
              <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
                {block.props.mediaId ? "Change image" : "Choose image"}
              </Button>
            </Field>
            <Field label="Alt text">
              <Input value={String(block.props.alt ?? "")} onChange={(e) => onChangeProps(block.id, { alt: e.target.value })} />
            </Field>
            <Field label="Caption">
              <Input value={String(block.props.caption ?? "")} onChange={(e) => onChangeProps(block.id, { caption: e.target.value })} />
            </Field>
            <MediaPickerModal
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onSelect={(m) => {
                onChangeProps(block.id, { mediaId: m.id, alt: block.props.alt || m.altText || "" });
                setPickerOpen(false);
              }}
            />
          </>
        );
      case "button":
        return (
          <>
            <Field label="Label">
              <Input value={String(block.props.label ?? "")} onChange={(e) => onChangeProps(block.id, { label: e.target.value })} />
            </Field>
            <Field label="Link URL">
              <Input value={String(block.props.href ?? "")} onChange={(e) => onChangeProps(block.id, { href: e.target.value })} placeholder="https://..." />
            </Field>
            <Field label="Style">
              <Select value={String(block.props.variant ?? "primary")} onChange={(e) => onChangeProps(block.id, { variant: e.target.value })}>
                {["primary", "secondary", "outline", "ghost"].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        );
      case "card":
        return (
          <>
            <Field label="Title">
              <Input value={String(block.props.title ?? "")} onChange={(e) => onChangeProps(block.id, { title: e.target.value })} />
            </Field>
            <Field label="Body">
              <RichTextEditor value={String(block.props.body ?? "")} onChange={(html) => onChangeProps(block.id, { body: html })} />
            </Field>
          </>
        );
      case "spacer":
        return (
          <Field label="Height (px)">
            <Input type="number" min={0} max={1000} value={Number(block.props.height) || 40} onChange={(e) => onChangeProps(block.id, { height: Number(e.target.value) })} />
          </Field>
        );
      case "divider":
        return (
          <Field label="Style">
            <Select value={String(block.props.style ?? "solid")} onChange={(e) => onChangeProps(block.id, { style: e.target.value })}>
              {["solid", "dashed"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        );
      case "templatePart":
        return (
          <Field label="Template part" hint="Only PUBLISHED parts render reliably on the live site.">
            <Select value={String(block.props.templatePartId ?? "")} onChange={(e) => onChangeProps(block.id, { templatePartId: e.target.value })}>
              <option value="">Select…</option>
              {templateParts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.status})
                </option>
              ))}
            </Select>
          </Field>
        );
    }
  })();

  return (
    <Card className="p-4 space-y-3">
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {BLOCK_LABELS[block.type]}
      </p>
      {body}
      {isContainerBlock(block.type) || containers.length > 0 ? <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>{moveIntoField}</div> : moveIntoField}
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Template structure editor — region -> Template Part assignment
// (Phase 4). A Template has no canvas content of its own in this
// architecture; its only editable surface is this ordered list of
// regions, each optionally assigned to a Template Part (whose own
// content is edited separately via ?templatePartId=, see below).
// ---------------------------------------------------------------------------

const TemplateStructureEditor: React.FC<{ templateId: string }> = ({ templateId }) => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { navigate } = useRouter();
  const canUpdate = hasPermission(user?.role.permissions, "templates.update");
  const canPublish = hasPermission(user?.role.permissions, "templates.publish");

  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<TemplateRegionEntry[]>([]);
  const [savedRegions, setSavedRegions] = useState<TemplateRegionEntry[]>([]);
  const [availableParts, setAvailableParts] = useState<TemplatePart[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [usage, setUsage] = useState<{ pages: { id: string; title: string; status: string }[] } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ key: string; templatePartId: string | null; part: TemplatePart | null }[] | null>(null);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<{ id: string; version: number; status: string; createdAt: string }[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const dirty = JSON.stringify(regions) !== JSON.stringify(savedRegions);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await templatesApi.get(templateId);
      setTemplate(res.template);
      const loaded = normalizeTemplateRegions(res.template.currentRevision?.structure);
      setRegions(loaded);
      setSavedRegions(loaded);
      void templatesApi.usage(templateId).then(setUsage).catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load template.");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void templatePartsApi.list({ limit: 100, sort: "name", order: "asc" }).then((res) => setAvailableParts(res.items));
  }, []);

  const addRegion = () => setRegions((r) => [...r, { key: "", templatePartId: null }]);
  const removeRegion = (index: number) => setRegions((r) => r.filter((_, i) => i !== index));
  const updateRegionKey = (index: number, key: string) => setRegions((r) => r.map((entry, i) => (i === index ? { ...entry, key } : entry)));
  const updateRegionPart = (index: number, templatePartId: string | null) =>
    setRegions((r) => r.map((entry, i) => (i === index ? { ...entry, templatePartId } : entry)));
  const moveRegion = (index: number, dir: "up" | "down") =>
    setRegions((r) => {
      const to = dir === "up" ? index - 1 : index + 1;
      if (to < 0 || to >= r.length) return r;
      const next = [...r];
      [next[index], next[to]] = [next[to]!, next[index]!];
      return next;
    });

  const save = async (): Promise<boolean> => {
    if (!template) return false;
    setSaving(true);
    try {
      const res = await templatesApi.update(template.id, { structure: { ...template.currentRevision?.structure, regions }, expectedUpdatedAt: template.updatedAt });
      setTemplate(res.template);
      const next = normalizeTemplateRegions(res.template.currentRevision?.structure);
      setRegions(next);
      setSavedRegions(next);
      return true;
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not save the template.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    if (await save()) notify("Draft saved.", "success");
  };

  const handlePublish = async () => {
    if (dirty && !(await save())) return;
    setPublishing(true);
    try {
      const res = await templatesApi.publish(template!.id);
      setTemplate(res.template);
      notify("Template published.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not publish the template.", "error");
    } finally {
      setPublishing(false);
    }
  };

  const loadRevisions = async () => {
    if (!template) return;
    setRevisionsLoading(true);
    try {
      const res = await templatesApi.revisions(template.id);
      setRevisions(res.revisions);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const handleRevert = async (revisionId: string) => {
    if (!template) return;
    try {
      const res = await templatesApi.revert(template.id, revisionId);
      setTemplate(res.template);
      const next = normalizeTemplateRegions(res.template.currentRevision?.structure);
      setRegions(next);
      setSavedRegions(next);
      notify("Reverted to prior revision.", "success");
      void loadRevisions();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not revert.", "error");
    }
  };

  const handleOpenPreview = async () => {
    try {
      const res = await templatesApi.preview(templateId);
      setPreviewData(res.regions);
      setPreviewOpen(true);
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not load preview.", "error");
    }
  };

  const handleBack = () => {
    if (dirty) {
      setLeaveConfirmOpen(true);
      return;
    }
    navigate("/website/templates");
  };

  if (loading) return <LoadingState label="Loading template…" />;
  if (error || !template) return <ErrorState message={error ?? "Template not found."} />;

  return (
    <div className="space-y-3 -m-4 sm:-m-6 p-4 sm:p-6 min-h-[calc(100vh-4rem)]" style={{ background: "var(--bg-app)" }}>
      <Card className="p-2.5 flex items-center justify-between gap-2 flex-wrap sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4" /> Templates
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
              {template.name}
            </p>
            <p className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
              <Badge tone={template.status === "PUBLISHED" ? "success" : "neutral"}>{template.status}</Badge>
              {usage && usage.pages.length > 0 && <span style={{ color: "var(--text-muted)" }}>Used by {usage.pages.length} page(s)</span>}
              {dirty && <span className="text-amber-500">Unsaved changes</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button variant="secondary" onClick={() => void handleOpenPreview()}>
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
          {canUpdate && template.status !== "ARCHIVED" && !template.isSystem && (
            <Button variant="secondary" onClick={() => void handleSaveDraft()} disabled={saving || !dirty}>
              <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save draft"}
            </Button>
          )}
          {canPublish && template.status !== "PUBLISHED" && template.status !== "ARCHIVED" && !template.isSystem && (
            <Button variant="primary" onClick={() => void handlePublish()} disabled={publishing || saving}>
              <Rocket className="w-3.5 h-3.5" /> {publishing ? "Publishing…" : "Publish"}
            </Button>
          )}
        </div>
      </Card>

      {template.isSystem && (
        <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 bg-amber-500/10 text-amber-600 border border-amber-500/30">
          <AlertTriangle className="w-3.5 h-3.5" /> This is a protected system template and is read-only. Duplicate it from Templates to customize.
        </div>
      )}

      <Card className="p-4 space-y-3 max-w-2xl">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Regions
          </p>
          {canUpdate && !template.isSystem && (
            <Button variant="secondary" onClick={addRegion}>
              <Plus className="w-3.5 h-3.5" /> Add region
            </Button>
          )}
        </div>

        {regions.length === 0 ? (
          <EmptyState title="No regions yet" description="Add a region (e.g. header, footer) and assign a Template Part to it." />
        ) : (
          <ul className="space-y-2">
            {regions.map((region, index) => (
              <li key={index} className="flex items-center gap-2 p-2.5 rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-col">
                  <button type="button" disabled={!canUpdate || template.isSystem || index === 0} onClick={() => moveRegion(index, "up")} className="p-0.5" title="Move up">
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={!canUpdate || template.isSystem || index === regions.length - 1}
                    onClick={() => moveRegion(index, "down")}
                    className="p-0.5"
                    title="Move down"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
                <Input
                  placeholder="region key, e.g. header"
                  value={region.key}
                  disabled={!canUpdate || template.isSystem}
                  onChange={(e) => updateRegionKey(index, e.target.value)}
                  className="w-40"
                />
                <Select
                  value={region.templatePartId ?? ""}
                  disabled={!canUpdate || template.isSystem}
                  onChange={(e) => updateRegionPart(index, e.target.value || null)}
                  className="flex-1"
                >
                  <option value="">— None —</option>
                  {availableParts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.status})
                    </option>
                  ))}
                </Select>
                {region.templatePartId && (
                  <Button variant="ghost" onClick={() => navigate(`/website/site-editor?templatePartId=${region.templatePartId}`)}>
                    Edit part →
                  </Button>
                )}
                {canUpdate && !template.isSystem && (
                  <Button variant="ghost" onClick={() => removeRegion(index)} aria-label={`Remove region ${region.key || index}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {usage && usage.pages.length > 0 && (
        <Card className="p-4 max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>
            Used by
          </p>
          <ul className="space-y-1">
            {usage.pages.map((p) => (
              <li key={p.id} className="text-[11px] flex items-center justify-between gap-2" style={{ color: "var(--text-secondary)" }}>
                <span>{p.title}</span>
                <Badge tone={p.status === "PUBLISHED" ? "success" : "neutral"}>{p.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview">
        <div className="max-h-[70vh] overflow-y-auto space-y-4">
          {!previewData || previewData.length === 0 ? (
            <EmptyState title="Nothing to preview yet" description="Add a region and assign a Template Part to see a preview." />
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
          <ul className="space-y-2 max-h-96 overflow-y-auto">
            {revisions.map((r) => (
              <li key={r.id} className="p-2.5 rounded-lg border text-xs flex items-center justify-between gap-3" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                    v{r.version} <Badge tone={r.status === "PUBLISHED" ? "success" : "neutral"}>{r.status}</Badge>
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>{new Date(r.createdAt).toLocaleString()}</p>
                </div>
                {canUpdate && !template.isSystem && r.id !== template.currentRevisionId && (
                  <Button variant="secondary" onClick={() => void handleRevert(r.id)} disabled={template.status === "ARCHIVED"}>
                    <RotateCcw className="w-3.5 h-3.5" /> Revert to this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={leaveConfirmOpen}
        title="Leave without saving?"
        message="You have unsaved region changes. Leave this page and discard them?"
        confirmLabel="Discard & leave"
        destructive
        onConfirm={() => {
          setLeaveConfirmOpen(false);
          navigate("/website/templates");
        }}
        onCancel={() => setLeaveConfirmOpen(false)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Phase 4 — the Site Editor now opens three kinds of subject, picked by
 * which query param is present: `?pageId=` (Page, unchanged since Phase 2),
 * `?templatePartId=` (a Template Part's own content — the exact same
 * canvas/doc editing machinery as a Page, just persisted through
 * templatePartsApi instead of pagesApi), or `?templateId=` (a Template's
 * region assignments — a different, much simpler editor; see
 * TemplateStructureEditor below, since a Template has no canvas content of
 * its own in this architecture, only a list of region -> Template Part
 * assignments).
 */
export const SiteEditorPage: React.FC = () => {
  const templateId = new URLSearchParams(window.location.search).get("templateId");
  if (templateId) return <TemplateStructureEditor templateId={templateId} />;
  return <PageOrPartEditor />;
};

const PageOrPartEditor: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const { navigate } = useRouter();

  const [pageId, setPageId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("pageId"));
  const [templatePartId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("templatePartId"));
  const subjectKind: "page" | "templatePart" = templatePartId ? "templatePart" : "page";

  const canUpdate = hasPermission(user?.role.permissions, subjectKind === "templatePart" ? "template_parts.update" : "content.update");
  const canPublish = hasPermission(user?.role.permissions, subjectKind === "templatePart" ? "template_parts.publish" : "content.publish");

  const [page, setPage] = useState<CmsPage | null>(null);
  const [part, setPart] = useState<TemplatePart | null>(null);
  const [partUsage, setPartUsage] = useState<{ templates: { id: string; name: string; status: string }[]; pages: { id: string; title: string; status: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [savedDoc, setSavedDoc] = useState<EditorDocument>(EMPTY_DOC);
  const [doc, setDoc] = useState<EditorDocument>(EMPTY_DOC);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [template, setTemplate] = useState<Template | null>(null);
  const [templateRegionParts, setTemplateRegionParts] = useState<Record<string, TemplatePart>>({});
  const [templateParts, setTemplateParts] = useState<TemplatePart[]>([]);
  const [globalStyles, setGlobalStyles] = useState<GlobalStyles | null>(null);

  const [mediaCache, setMediaCache] = useState<Record<string, string>>({});
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<(ContentRevision | TemplatePartRevision)[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const dirty = !docsEqual(doc, savedDoc);

  // Unsaved-change protection — covers browser close/refresh/direct URL
  // navigation; in-app "Back to Pages" uses leaveConfirmOpen below since
  // the minimal router has no navigation-guard hook to intercept.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const loadPage = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await pagesApi.get(id);
      setPage(res.page);
      const loadedDoc = res.page.currentRevision?.editorBlocks ?? EMPTY_DOC;
      setSavedDoc(loadedDoc);
      setDoc(loadedDoc);
      setSelectedId(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load page.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPart = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await templatePartsApi.get(id);
      setPart(res.templatePart);
      const content = res.templatePart.currentRevision?.content;
      const loadedDoc = content && Array.isArray((content as EditorDocument).blocks) ? (content as EditorDocument) : EMPTY_DOC;
      setSavedDoc(loadedDoc);
      setDoc(loadedDoc);
      setSelectedId(null);
      void templatePartsApi.usage(id).then(setPartUsage).catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Failed to load template part.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subjectKind === "templatePart" && templatePartId) void loadPart(templatePartId);
    else if (pageId) void loadPage(pageId);
  }, [pageId, templatePartId, subjectKind, loadPage, loadPart]);

  // Resolve the page's assigned Template (if any) so its Header/Footer
  // regions can be shown read-only for context (requirement: "show
  // resolved template structure in editor") — editable from its own
  // Site Editor entry point (?templateId=), reached here via an "Edit
  // template" link (Phase 4).
  useEffect(() => {
    if (subjectKind !== "page" || !page?.templateId) {
      setTemplate(null);
      setTemplateRegionParts({});
      return;
    }
    let cancelled = false;
    void templatesApi.get(page.templateId).then(async (res) => {
      if (cancelled) return;
      setTemplate(res.template);
      const regions = normalizeTemplateRegions(res.template.currentRevision?.structure);
      const entries = await Promise.all(
        regions.map(async ({ key, templatePartId: partId }) => {
          if (!partId) return null;
          try {
            const partRes = await templatePartsApi.get(partId);
            return [key, partRes.templatePart] as const;
          } catch {
            return null;
          }
        })
      );
      if (!cancelled) setTemplateRegionParts(Object.fromEntries(entries.filter((e): e is readonly [string, TemplatePart] => e !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [subjectKind, page?.templateId]);

  useEffect(() => {
    void templatePartsApi.list({ limit: 100, sort: "name", order: "asc" }).then((res) => setTemplateParts(res.items));
  }, []);

  // Phase 3 — make Global Styles available to the canvas preview, scoped
  // to rendered block content only (never the Control Center's own chrome
  // theme). Reads the PUBLISHED values, same as what the live site shows,
  // so what an editor sees here matches what visitors will see.
  useEffect(() => {
    void siteSettingsApi
      .getGlobalStyles()
      .then((res) => setGlobalStyles(res.published))
      .catch(() => undefined);
  }, []);

  // Pre-resolve every image block's URL on load (both for the Canvas and
  // for blocksToPlainHtml's body fallback below).
  useEffect(() => {
    const ids = collectImageMediaIds(doc.blocks).filter((id) => !mediaCache[id]);
    if (ids.length === 0) return;
    let cancelled = false;
    void Promise.all(
      ids.map(async (id) => {
        try {
          const res = await mediaApi.getReadUrl(id);
          return [id, res.url] as const;
        } catch {
          return null;
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const next = Object.fromEntries(results.filter((r): r is readonly [string, string] => r !== null));
      if (Object.keys(next).length > 0) setMediaCache((prev) => ({ ...prev, ...next }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const templatePartNames = useMemo(() => Object.fromEntries(templateParts.map((p) => [p.id, p.name])), [templateParts]);
  const selectedBlock = selectedId ? findBlock(doc, selectedId) : null;

  const mutate = (fn: (d: EditorDocument) => EditorDocument) => setDoc((d) => fn(d));

  const handleAddBlock = (type: BlockType) => {
    const block = createBlock(type);
    setDoc((d) => insertBlock(d, block, null, d.blocks.length));
    setSelectedId(block.id);
    setAddBlockOpen(false);
  };
  const handleAddChild = (parentId: string, type: BlockType) => {
    const block = createBlock(type);
    setDoc((d) => {
      const parent = findBlock(d, parentId);
      return insertBlock(d, block, parentId, parent?.children?.length ?? 0);
    });
    setSelectedId(block.id);
  };
  const handleDelete = (id: string) => {
    mutate((d) => removeBlock(d, id));
    if (selectedId === id) setSelectedId(null);
  };
  const handleDuplicate = (id: string) => mutate((d) => duplicateBlock(d, id));
  const handleMove = (id: string, dir: "up" | "down") => mutate((d) => moveSibling(d, id, dir));
  const handleMoveInto = (id: string, parentId: string | null) => mutate((d) => moveIntoParent(d, id, parentId));
  const handleChangeProps = (id: string, patch: Record<string, unknown>) => mutate((d) => updateBlockProps(d, id, patch));

  const save = async (): Promise<boolean> => {
    const subjectId = subjectKind === "page" ? page?.id : part?.id;
    const expectedUpdatedAt = subjectKind === "page" ? page?.updatedAt : part?.updatedAt;
    if (!subjectId) return false;
    setSaving(true);
    try {
      if (subjectKind === "page") {
        const body = blocksToPlainHtml(doc, mediaCache);
        const res = await pagesApi.update(subjectId, { editorBlocks: doc, body, expectedUpdatedAt });
        setPage(res.page);
        const nextDoc = res.page.currentRevision?.editorBlocks ?? doc;
        setSavedDoc(nextDoc);
        setDoc(nextDoc);
      } else {
        const res = await templatePartsApi.update(subjectId, { content: doc, expectedUpdatedAt });
        setPart(res.templatePart);
        const nextDoc = res.templatePart.currentRevision?.content ?? doc;
        setSavedDoc(nextDoc);
        setDoc(nextDoc);
      }
      return true;
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : `Could not save the ${subjectKind === "page" ? "page" : "template part"}.`, "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    if (await save()) notify("Draft saved.", "success");
  };

  const handlePublish = async () => {
    const subjectId = subjectKind === "page" ? page?.id : part?.id;
    if (!subjectId) return;
    if (dirty && !(await save())) return;
    setPublishing(true);
    try {
      if (subjectKind === "page") {
        const res = await pagesApi.publish(subjectId);
        setPage(res.page);
      } else {
        const res = await templatePartsApi.publish(subjectId);
        setPart(res.templatePart);
      }
      notify(`${subjectKind === "page" ? "Page" : "Template part"} published.`, "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not publish.", "error");
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!page) return;
    try {
      const res = await pagesApi.update(page.id, { status: "DRAFT" });
      setPage(res.page);
      notify("Page moved back to draft.", "success");
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not update the page.", "error");
    }
  };

  const loadRevisions = async () => {
    const subjectId = subjectKind === "page" ? page?.id : part?.id;
    if (!subjectId) return;
    setRevisionsLoading(true);
    try {
      const res = subjectKind === "page" ? await pagesApi.revisions(subjectId) : await templatePartsApi.revisions(subjectId);
      setRevisions(res.revisions);
    } finally {
      setRevisionsLoading(false);
    }
  };

  const handleRevert = async (revisionId: string) => {
    const subjectId = subjectKind === "page" ? page?.id : part?.id;
    if (!subjectId) return;
    try {
      if (subjectKind === "page") {
        const res = await pagesApi.revert(subjectId, revisionId);
        setPage(res.page);
        const nextDoc = res.page.currentRevision?.editorBlocks ?? EMPTY_DOC;
        setSavedDoc(nextDoc);
        setDoc(nextDoc);
      } else {
        const res = await templatePartsApi.revert(subjectId, revisionId);
        setPart(res.templatePart);
        const nextDoc = res.templatePart.currentRevision?.content ?? EMPTY_DOC;
        setSavedDoc(nextDoc);
        setDoc(nextDoc);
      }
      notify("Reverted to prior revision.", "success");
      void loadRevisions();
    } catch (err) {
      notify(err instanceof ApiClientError ? err.message : "Could not revert.", "error");
    }
  };

  const backPath = subjectKind === "templatePart" ? "/website/template-parts" : "/cms/pages";
  const handleBack = () => {
    if (dirty) {
      setLeaveConfirmOpen(true);
      return;
    }
    navigate(backPath);
  };

  if (!pageId && !templatePartId) {
    return (
      <PagePicker
        onOpen={(id) => {
          setPageId(id);
          navigate(`/website/site-editor?pageId=${id}`);
        }}
      />
    );
  }

  const subject = subjectKind === "page" ? page : part;
  if (loading) return <LoadingState label={subjectKind === "page" ? "Loading page…" : "Loading template part…"} />;
  if (error || !subject) return <ErrorState message={error ?? (subjectKind === "page" ? "Page not found." : "Template part not found.")} />;

  const subjectTitle = subjectKind === "page" ? page!.title : part!.name;
  const subjectStatus = subject.status;

  return (
    <div className="space-y-3 -m-4 sm:-m-6 p-4 sm:p-6 min-h-[calc(100vh-4rem)]" style={{ background: "var(--bg-app)" }}>
      {/* Toolbar */}
      <Card className="p-2.5 flex items-center justify-between gap-2 flex-wrap sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4" /> {subjectKind === "page" ? "Pages" : "Template Parts"}
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
              {subjectTitle}
            </p>
            <p className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
              <Badge tone={subjectStatus === "PUBLISHED" ? "success" : "neutral"}>{subjectStatus}</Badge>
              {dirty && <span className="text-amber-500">Unsaved changes</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center rounded-lg p-0.5" style={{ background: "var(--bg-app)", border: "1px solid var(--border)" }}>
            <button type="button" title="Desktop" onClick={() => setViewport("desktop")} className="p-1.5 rounded-md" style={viewport === "desktop" ? { background: "var(--accent-soft)" } : undefined}>
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button type="button" title="Tablet" onClick={() => setViewport("tablet")} className="p-1.5 rounded-md" style={viewport === "tablet" ? { background: "var(--accent-soft)" } : undefined}>
              <Tablet className="w-3.5 h-3.5" />
            </button>
            <button type="button" title="Mobile" onClick={() => setViewport("mobile")} className="p-1.5 rounded-md" style={viewport === "mobile" ? { background: "var(--accent-soft)" } : undefined}>
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>
          <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
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
          {canUpdate && subjectStatus !== "ARCHIVED" && (
            <Button variant="secondary" onClick={() => void handleSaveDraft()} disabled={saving || !dirty}>
              <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save draft"}
            </Button>
          )}
          {canPublish && subjectStatus !== "PUBLISHED" && subjectStatus !== "ARCHIVED" && (
            <Button variant="primary" onClick={() => void handlePublish()} disabled={publishing || saving}>
              <Rocket className="w-3.5 h-3.5" /> {publishing ? "Publishing…" : "Publish"}
            </Button>
          )}
          {subjectKind === "page" && canUpdate && subjectStatus === "PUBLISHED" && (
            <Button variant="secondary" onClick={() => void handleUnpublish()}>
              Move to draft
            </Button>
          )}
        </div>
      </Card>

      {subjectStatus === "ARCHIVED" && (
        <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 bg-amber-500/10 text-amber-600 border border-amber-500/30">
          <AlertTriangle className="w-3.5 h-3.5" /> This {subjectKind === "page" ? "page" : "template part"} is archived and read-only. Restore it to edit again.
        </div>
      )}

      <div className="grid lg:grid-cols-[260px_1fr_300px] gap-3 items-start">
        {/* Left: layers / structure */}
        <Card className="p-3 space-y-3 lg:sticky lg:top-16">
          {subjectKind === "page" && template && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5 flex items-center justify-between gap-2" style={{ color: "var(--text-muted)" }}>
                <span>Template: {template.name}</span>
                {hasPermission(user?.role.permissions, "templates.read") && (
                  <button type="button" className="font-semibold normal-case" style={{ color: "var(--accent)" }} onClick={() => navigate(`/website/site-editor?templateId=${template.id}`)}>
                    Edit →
                  </button>
                )}
              </p>
              <ul className="space-y-1">
                {Object.entries(templateRegionParts).map(([region, regionPart]) => (
                  <li key={region} className="text-[11px] flex items-center justify-between gap-2" style={{ color: "var(--text-secondary)" }}>
                    <span className="capitalize">{region}</span>
                    <button type="button" onClick={() => navigate(`/website/site-editor?templatePartId=${regionPart.id}`)}>
                      <Badge tone={regionPart.status === "PUBLISHED" ? "success" : "neutral"}>{regionPart.name}</Badge>
                    </button>
                  </li>
                ))}
                {Object.keys(templateRegionParts).length === 0 && (
                  <li className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    No regions configured.
                  </li>
                )}
              </ul>
            </div>
          )}
          {subjectKind === "templatePart" && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
                Used by
              </p>
              {!partUsage || (partUsage.templates.length === 0 && partUsage.pages.length === 0) ? (
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Not referenced by any template or page yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {partUsage.templates.map((t) => (
                    <li key={t.id} className="text-[11px] flex items-center justify-between gap-2" style={{ color: "var(--text-secondary)" }}>
                      <span className="truncate">Template: {t.name}</span>
                      <Badge tone={t.status === "PUBLISHED" ? "success" : "neutral"}>{t.status}</Badge>
                    </li>
                  ))}
                  {partUsage.pages.map((p) => (
                    <li key={p.id} className="text-[11px] flex items-center justify-between gap-2" style={{ color: "var(--text-secondary)" }}>
                      <span className="truncate">Page: {p.title}</span>
                      <Badge tone={p.status === "PUBLISHED" ? "success" : "neutral"}>{p.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
              Layers
            </p>
            {doc.blocks.length === 0 ? (
              <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                No blocks yet — add one from the canvas.
              </p>
            ) : (
              <LayersTree blocks={doc.blocks} selectedId={selectedId} onSelect={setSelectedId} />
            )}
          </div>
        </Card>

        {/* Center: canvas */}
        <div className="flex justify-center">
          <div className="w-full" style={{ maxWidth: VIEWPORT_WIDTH[viewport] }}>
            <Card className="p-4 min-h-[400px]">
              {doc.blocks.map((b) => (
                <CanvasBlock
                  key={b.id}
                  block={b}
                  depth={0}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onMove={handleMove}
                  onAddChild={handleAddChild}
                  mediaCache={mediaCache}
                  onMediaResolved={(id, url) => setMediaCache((prev) => ({ ...prev, [id]: url }))}
                  templatePartNames={templatePartNames}
                  globalStyles={globalStyles}
                />
              ))}

              {addBlockOpen ? (
                <div className="flex flex-wrap gap-1.5 p-3 rounded-lg" style={{ background: "var(--bg-surface-alt)" }}>
                  {ADDABLE_TYPES.map((t) => (
                    <Button key={t} variant="secondary" onClick={() => handleAddBlock(t)}>
                      {BLOCK_LABELS[t]}
                    </Button>
                  ))}
                  <Button variant="ghost" onClick={() => setAddBlockOpen(false)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full py-6 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                  style={{ border: "2px dashed var(--border)", color: "var(--text-muted)" }}
                  onClick={() => setAddBlockOpen(true)}
                >
                  <Plus className="w-4 h-4" /> Add block
                </button>
              )}
            </Card>
          </div>
        </div>

        {/* Right: inspector */}
        <div className="lg:sticky lg:top-16">
          <Inspector doc={doc} block={selectedBlock} onChangeProps={handleChangeProps} onMoveInto={handleMoveInto} templateParts={templateParts} />
        </div>
      </div>

      <Modal open={previewOpen} onClose={() => setPreviewOpen(false)} title="Preview">
        <div className="max-h-[70vh] overflow-y-auto" style={{ maxWidth: VIEWPORT_WIDTH[viewport], margin: "0 auto" }}>
          {doc.blocks.length === 0 ? (
            <EmptyState title="Nothing to preview yet" description="Add blocks to see a preview." />
          ) : (
            <BlockTreeRenderer blocks={doc.blocks} templatePartNames={templatePartNames} globalStyles={globalStyles} />
          )}
        </div>
      </Modal>

      <Modal open={revisionsOpen} onClose={() => setRevisionsOpen(false)} title="Revision history">
        {revisionsLoading ? (
          <LoadingState />
        ) : revisions.length === 0 ? (
          <EmptyState title="No revisions yet" description="" />
        ) : (
          <ul className="space-y-2 max-h-96 overflow-y-auto">
            {revisions.map((r) => (
              <li key={r.id} className="p-2.5 rounded-lg border text-xs flex items-center justify-between gap-3" style={{ borderColor: "var(--border)" }}>
                <div>
                  <p className="font-semibold flex items-center gap-1.5" style={{ color: "var(--text-primary)" }}>
                    v{r.version} <Badge tone={r.status === "PUBLISHED" ? "success" : "neutral"}>{r.status}</Badge>
                  </p>
                  <p style={{ color: "var(--text-muted)" }}>{new Date(r.createdAt).toLocaleString()}</p>
                </div>
                {canUpdate && r.id !== subject.currentRevisionId && (
                  <Button variant="secondary" onClick={() => void handleRevert(r.id)} disabled={subjectStatus === "ARCHIVED"}>
                    <RotateCcw className="w-3.5 h-3.5" /> Revert to this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ConfirmDialog
        open={leaveConfirmOpen}
        title="Leave without saving?"
        message="You have unsaved changes in the Site Editor. Leave this page and discard them?"
        confirmLabel="Discard & leave"
        destructive
        onConfirm={() => {
          setLeaveConfirmOpen(false);
          navigate(backPath);
        }}
        onCancel={() => setLeaveConfirmOpen(false)}
      />
    </div>
  );
};

const LayersTree: React.FC<{ blocks: EditorBlock[]; selectedId: string | null; onSelect: (id: string) => void; depth?: number }> = ({
  blocks,
  selectedId,
  onSelect,
  depth = 0,
}) => (
  <ul className="space-y-0.5">
    {blocks.map((b) => (
      <li key={b.id}>
        <button
          type="button"
          onClick={() => onSelect(b.id)}
          className="w-full text-left px-2 py-1 rounded-md text-[11px] truncate"
          style={{
            paddingLeft: `${depth * 12 + 8}px`,
            background: b.id === selectedId ? "var(--accent-soft)" : "transparent",
            color: b.id === selectedId ? "var(--accent)" : "var(--text-secondary)",
          }}
        >
          {BLOCK_LABELS[b.type]}
        </button>
        {b.children && b.children.length > 0 && <LayersTree blocks={b.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />}
      </li>
    ))}
  </ul>
);
