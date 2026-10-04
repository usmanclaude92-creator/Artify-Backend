/**
 * Phase 2 (Site Editor) — pure tree helpers over the EditorDocument block
 * shape (src/lib/api.ts), shared by the Canvas/Layers/Inspector panes.
 * Every mutation returns a new document (immutable), matching how the
 * component layer above treats `doc` as ordinary React state.
 */
import type { BlockType, EditorBlock, EditorDocument } from "./api";

export function newBlockId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `b_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const CONTAINER_TYPES = new Set<BlockType>(["section", "container", "columns", "card"]);
export function isContainerBlock(type: BlockType): boolean {
  return CONTAINER_TYPES.has(type);
}

export function createBlock(type: BlockType): EditorBlock {
  const id = newBlockId();
  switch (type) {
    case "section":
      return { id, type, props: { paddingY: "md" }, children: [] };
    case "container":
      return { id, type, props: { maxWidth: "lg" }, children: [] };
    case "columns":
      return { id, type, props: { columnCount: 2, gap: "md" }, children: [] };
    case "text":
      return { id, type, props: { html: "<p>New text block.</p>" } };
    case "heading":
      return { id, type, props: { text: "New heading", level: 2 } };
    case "image":
      return { id, type, props: { mediaId: "" } };
    case "button":
      return { id, type, props: { label: "Click me", href: "#", variant: "primary" } };
    case "card":
      return { id, type, props: { title: "Card title", body: "<p>Card body.</p>" }, children: [] };
    case "spacer":
      return { id, type, props: { height: 40 } };
    case "divider":
      return { id, type, props: { style: "solid" } };
    case "templatePart":
      return { id, type, props: { templatePartId: "" } };
    case "navigationMenu":
      return { id, type, props: { navigationMenuId: "" } };
    case "form":
      return { id, type, props: { formId: "" } };
    case "testimonial":
      return { id, type, props: { quote: "", authorName: "", authorTitle: "" } };
  }
}

interface Located {
  block: EditorBlock;
  parent: EditorBlock[];
  index: number;
}

function locate(list: EditorBlock[], id: string): Located | null {
  for (let i = 0; i < list.length; i++) {
    const b = list[i]!;
    if (b.id === id) return { block: b, parent: list, index: i };
    if (b.children) {
      const found = locate(b.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findBlock(doc: EditorDocument, id: string): EditorBlock | null {
  return locate(doc.blocks, id)?.block ?? null;
}

/** Every container-type block id in the tree, for the Inspector's "move into" picker. */
export function listContainers(blocks: EditorBlock[]): EditorBlock[] {
  const out: EditorBlock[] = [];
  for (const b of blocks) {
    if (isContainerBlock(b.type)) out.push(b);
    if (b.children) out.push(...listContainers(b.children));
  }
  return out;
}

function cloneDoc(doc: EditorDocument): EditorDocument {
  return { version: doc.version, blocks: JSON.parse(JSON.stringify(doc.blocks)) as EditorBlock[] };
}

export function insertBlock(doc: EditorDocument, block: EditorBlock, parentId: string | null, index: number): EditorDocument {
  const next = cloneDoc(doc);
  const target = parentId ? locate(next.blocks, parentId)?.block.children : next.blocks;
  if (!target) return next;
  target.splice(index, 0, block);
  return next;
}

export function removeBlock(doc: EditorDocument, id: string): EditorDocument {
  const next = cloneDoc(doc);
  const found = locate(next.blocks, id);
  if (!found) return next;
  found.parent.splice(found.index, 1);
  return next;
}

export function duplicateBlock(doc: EditorDocument, id: string): EditorDocument {
  const found = locate(doc.blocks, id);
  if (!found) return doc;
  const copy = reassignIds(JSON.parse(JSON.stringify(found.block)) as EditorBlock);
  const next = cloneDoc(doc);
  const foundNext = locate(next.blocks, id)!;
  foundNext.parent.splice(foundNext.index + 1, 0, copy);
  return next;
}

function reassignIds(block: EditorBlock): EditorBlock {
  block.id = newBlockId();
  if (block.children) block.children = block.children.map(reassignIds);
  return block;
}

export function updateBlockProps(doc: EditorDocument, id: string, patch: Record<string, unknown>): EditorDocument {
  const next = cloneDoc(doc);
  const found = locate(next.blocks, id);
  if (!found) return next;
  found.block.props = { ...found.block.props, ...patch };
  return next;
}

/** Swap a block with its previous/next sibling (reorder within the same parent). */
export function moveSibling(doc: EditorDocument, id: string, direction: "up" | "down"): EditorDocument {
  const next = cloneDoc(doc);
  const found = locate(next.blocks, id);
  if (!found) return next;
  const swapWith = direction === "up" ? found.index - 1 : found.index + 1;
  if (swapWith < 0 || swapWith >= found.parent.length) return next;
  const tmp = found.parent[swapWith]!;
  found.parent[swapWith] = found.parent[found.index]!;
  found.parent[found.index] = tmp;
  return next;
}

/** Re-parent a block to the end of a different container (or root, when targetParentId is null). A block can never be moved inside itself or one of its own descendants. */
export function moveIntoParent(doc: EditorDocument, id: string, targetParentId: string | null): EditorDocument {
  const found = locate(doc.blocks, id);
  if (!found) return doc;
  if (targetParentId) {
    const targetFound = locate(doc.blocks, targetParentId);
    if (!targetFound || !isContainerBlock(targetFound.block.type)) return doc;
    if (containsDescendant(found.block, targetParentId)) return doc;
  }
  const withoutBlock = removeBlock(doc, id);
  return insertBlock(withoutBlock, found.block, targetParentId, targetParentId ? (findBlock(withoutBlock, targetParentId)?.children?.length ?? 0) : withoutBlock.blocks.length);
}

function containsDescendant(block: EditorBlock, id: string): boolean {
  if (block.id === id) return true;
  return (block.children ?? []).some((c) => containsDescendant(c, id));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Flattens the block tree into plain HTML limited to the tags
 * server/utils/sanitizeHtml.ts already allows for Page.body — this is the
 * safe-fallback content a public renderer that doesn't yet understand
 * `editorBlocks` shows (docs/control-center-public-site-integration.md).
 * Section/container/columns/card wrappers aren't in that allowlist either,
 * so they're deliberately not emitted as tags here — only their children's
 * content is, which is exactly what the server's sanitizer would reduce
 * them to anyway if sent as literal markup.
 */
export function blocksToPlainHtml(doc: EditorDocument, mediaUrlCache: Record<string, string>): string {
  return doc.blocks.map((b) => renderBlockToHtml(b, mediaUrlCache)).join("\n");
}

function renderBlockToHtml(block: EditorBlock, mediaUrlCache: Record<string, string>): string {
  const children = () => (block.children ?? []).map((c) => renderBlockToHtml(c, mediaUrlCache)).join("\n");
  switch (block.type) {
    case "section":
    case "container":
    case "columns":
      return children();
    case "card": {
      const title = typeof block.props.title === "string" ? block.props.title : "";
      const body = typeof block.props.body === "string" ? block.props.body : "";
      return `${title ? `<h3>${escapeHtml(title)}</h3>` : ""}${body}${children()}`;
    }
    case "text":
      return typeof block.props.html === "string" ? block.props.html : "";
    case "heading": {
      const level = typeof block.props.level === "number" ? Math.min(6, Math.max(1, block.props.level)) : 2;
      const text = typeof block.props.text === "string" ? block.props.text : "";
      return `<h${level}>${escapeHtml(text)}</h${level}>`;
    }
    case "image": {
      const mediaId = typeof block.props.mediaId === "string" ? block.props.mediaId : "";
      const url = mediaUrlCache[mediaId];
      if (!url) return "";
      const alt = typeof block.props.alt === "string" ? block.props.alt : "";
      const caption = typeof block.props.caption === "string" ? block.props.caption : "";
      return `<figure><img src="${url}" alt="${escapeHtml(alt)}" />${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
    }
    case "button": {
      const label = typeof block.props.label === "string" ? block.props.label : "";
      const href = typeof block.props.href === "string" ? block.props.href : "#";
      return `<p><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></p>`;
    }
    case "spacer":
      return "";
    case "divider":
      return "<hr />";
    case "templatePart":
      // Resolved from the Template/Template Part system at render time, not
      // inlined into a page's own body fallback (it would duplicate the
      // Header/Footer content that already renders around every page).
      return "";
    case "navigationMenu":
      return "";
    case "form":
      // A real form needs controlled inputs/fetch submission — the static
      // body-HTML fallback can't provide that (same reasoning
      // templatePart/navigationMenu already use for their own
      // render-time-only resolution). The public site's own block-aware
      // renderer (not this flattened fallback) is what actually renders
      // this block live — see artifysolscom's PublicBlockRenderer.
      return "";
    case "testimonial": {
      const quote = typeof block.props.quote === "string" ? block.props.quote : "";
      const authorName = typeof block.props.authorName === "string" ? block.props.authorName : "";
      if (!quote) return "";
      return `<blockquote>${escapeHtml(quote)}${authorName ? `<cite>${escapeHtml(authorName)}</cite>` : ""}</blockquote>`;
    }
  }
}

export function collectImageMediaIds(blocks: EditorBlock[]): string[] {
  const ids: string[] = [];
  for (const b of blocks) {
    if (b.type === "image" && typeof b.props.mediaId === "string" && b.props.mediaId) ids.push(b.props.mediaId);
    if (b.type === "testimonial" && typeof b.props.avatarMediaId === "string" && b.props.avatarMediaId) ids.push(b.props.avatarMediaId);
    if (b.children) ids.push(...collectImageMediaIds(b.children));
  }
  return [...new Set(ids)];
}
