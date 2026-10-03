/**
 * Phase 4 — walks an editorBlocks-shaped JSON document (Page.currentRevision.editorBlocks
 * or TemplatePart.currentRevision.content) to find every `templatePart` block's
 * referenced id, so Template Part usage/dependency checks (templatePartRepository.findUsage)
 * can see references that live inside a Page or TemplatePart's own block tree,
 * not just a Template's `structure.regions`. Defensive against malformed/
 * legacy content (anything not shaped like a real editor document yields []),
 * matching editorSchemas.ts's own "pass through unchanged" tolerance for
 * non-editor JSON.
 */
interface BlockLike {
  type?: unknown;
  props?: { templatePartId?: unknown };
  children?: unknown;
}

function walk(blocks: unknown[], out: Set<string>): void {
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as BlockLike;
    if (block.type === "templatePart" && typeof block.props?.templatePartId === "string") {
      out.add(block.props.templatePartId);
    }
    if (Array.isArray(block.children)) walk(block.children, out);
  }
}

export function collectTemplatePartIds(doc: unknown): string[] {
  if (!doc || typeof doc !== "object" || !Array.isArray((doc as { blocks?: unknown }).blocks)) return [];
  const out = new Set<string>();
  walk((doc as { blocks: unknown[] }).blocks, out);
  return [...out];
}
