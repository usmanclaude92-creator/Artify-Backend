/**
 * Phase 4 (Templates + Template Parts production enhancement) — the
 * read-only half of SiteEditorPage.tsx's `CanvasBlock` (no selection,
 * no editing affordances), extracted so Template/TemplatePart "Preview"
 * can reuse the exact same rendering the Site Editor itself uses rather
 * than a second renderer ("Do not create another template/page-builder
 * system"). Self-contained: resolves its own image media URLs, so a
 * caller only needs to pass `blocks`.
 */
import React, { useEffect, useState } from "react";
import { Image as ImageIcon, PanelsTopLeft, Menu as MenuIcon } from "lucide-react";
import { mediaApi, type EditorBlock, type GlobalStyles } from "../../lib/api";
import { collectImageMediaIds } from "../../lib/editorBlocks";

const CanvasImage: React.FC<{ mediaId: string; alt?: string; cache: Record<string, string> }> = ({ mediaId, alt, cache }) => {
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

const ReadOnlyBlock: React.FC<{
  block: EditorBlock;
  depth: number;
  mediaCache: Record<string, string>;
  templatePartNames: Record<string, string>;
  navigationMenuNames: Record<string, string>;
  globalStyles: GlobalStyles | null;
}> = ({ block, depth, mediaCache, templatePartNames, navigationMenuNames, globalStyles }) => {
  const wrap = (inner: React.ReactNode) => <div className="mb-2">{inner}</div>;

  switch (block.type) {
    case "section":
    case "container":
    case "columns":
      return wrap(
        <div
          className={block.type === "columns" ? "grid gap-3" : ""}
          style={block.type === "columns" ? { gridTemplateColumns: `repeat(${Number(block.props.columnCount) || 2}, minmax(0,1fr))` } : undefined}
        >
          {(block.children ?? []).map((c) => (
            <ReadOnlyBlock
              key={c.id}
              block={c}
              depth={depth + 1}
              mediaCache={mediaCache}
              templatePartNames={templatePartNames}
              navigationMenuNames={navigationMenuNames}
              globalStyles={globalStyles}
            />
          ))}
        </div>
      );
    case "text":
      return wrap(<div className="text-sm cms-rendered-body" dangerouslySetInnerHTML={{ __html: String(block.props.html ?? "") }} />);
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(block.props.level) || 2));
      const Tag = (`h${level}` as unknown) as "h1";
      const headingKey = `h${level}` as keyof GlobalStyles["typography"]["headingScale"];
      return wrap(
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
      return wrap(<CanvasImage mediaId={String(block.props.mediaId ?? "")} alt={String(block.props.alt ?? "")} cache={mediaCache} />);
    case "button":
      return wrap(
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
      return wrap(
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
      return wrap(<div style={{ height: Number(block.props.height) || 40 }} />);
    case "divider":
      return wrap(<hr style={{ borderColor: "var(--border)" }} />);
    case "templatePart": {
      const id = String(block.props.templatePartId ?? "");
      return wrap(
        <div className="text-xs italic flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <PanelsTopLeft className="w-3.5 h-3.5" />
          {id ? (templatePartNames[id] ?? "Template part") : "No template part selected"}
        </div>
      );
    }
    case "navigationMenu": {
      const id = String(block.props.navigationMenuId ?? "");
      return wrap(
        <div className="text-xs italic flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <MenuIcon className="w-3.5 h-3.5" />
          {id ? (navigationMenuNames[id] ?? "Navigation menu") : "No navigation menu selected"}
        </div>
      );
    }
    default:
      return null;
  }
};

/** Renders a block tree read-only (no selection/editing). Resolves its own image URLs. */
export const BlockTreeRenderer: React.FC<{
  blocks: EditorBlock[];
  templatePartNames?: Record<string, string>;
  navigationMenuNames?: Record<string, string>;
  globalStyles?: GlobalStyles | null;
}> = ({ blocks, templatePartNames = {}, navigationMenuNames = {}, globalStyles = null }) => {
  const [mediaCache, setMediaCache] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = collectImageMediaIds(blocks).filter((id) => !mediaCache[id]);
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
  }, [blocks]);

  return (
    <>
      {blocks.map((b) => (
        <ReadOnlyBlock
          key={b.id}
          block={b}
          depth={0}
          mediaCache={mediaCache}
          templatePartNames={templatePartNames}
          navigationMenuNames={navigationMenuNames}
          globalStyles={globalStyles}
        />
      ))}
    </>
  );
};
