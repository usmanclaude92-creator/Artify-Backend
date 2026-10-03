/**
 * Phase 4 — walks an editorBlocks-shaped JSON document (Page.currentRevision.editorBlocks
 * or TemplatePart.currentRevision.content) to find every `templatePart` block's
 * referenced id, so Template Part usage/dependency checks (templatePartRepository.findUsage)
 * can see references that live inside a Page or TemplatePart's own block tree,
 * not just a Template's `structure.regions`. Defensive against malformed/
 * legacy content (anything not shaped like a real editor document yields []),
 * matching editorSchemas.ts's own "pass through unchanged" tolerance for
 * non-editor JSON.
 *
 * Phase 5 — extended with the same walk for `navigationMenu` blocks, so
 * NavigationMenu usage/dependency checks (navigationMenuRepository.findUsage)
 * see the id a HEADER/FOOTER/MOBILE TemplatePart (or a Page) assigned.
 */
interface BlockLike {
  type?: unknown;
  props?: { templatePartId?: unknown; navigationMenuId?: unknown };
  children?: unknown;
}

function walk(blocks: unknown[], templatePartIds: Set<string>, navigationMenuIds: Set<string>): void {
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as BlockLike;
    if (block.type === "templatePart" && typeof block.props?.templatePartId === "string") {
      templatePartIds.add(block.props.templatePartId);
    }
    if (block.type === "navigationMenu" && typeof block.props?.navigationMenuId === "string") {
      navigationMenuIds.add(block.props.navigationMenuId);
    }
    if (Array.isArray(block.children)) walk(block.children, templatePartIds, navigationMenuIds);
  }
}

function blocksOf(doc: unknown): unknown[] {
  if (!doc || typeof doc !== "object" || !Array.isArray((doc as { blocks?: unknown }).blocks)) return [];
  return (doc as { blocks: unknown[] }).blocks;
}

export function collectTemplatePartIds(doc: unknown): string[] {
  const templatePartIds = new Set<string>();
  walk(blocksOf(doc), templatePartIds, new Set());
  return [...templatePartIds];
}

export function collectNavigationMenuIds(doc: unknown): string[] {
  const navigationMenuIds = new Set<string>();
  walk(blocksOf(doc), new Set(), navigationMenuIds);
  return [...navigationMenuIds];
}
