/**
 * Phase 2 (Site Editor) — pure tree helper tests (src/lib/editorBlocks.ts).
 * No DOM/network/DB — these are plain data-structure transformations.
 */
import { describe, expect, it } from "vitest";
import type { EditorDocument } from "./api";
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
} from "./editorBlocks";

function doc(blocks: EditorDocument["blocks"]): EditorDocument {
  return { version: 1, blocks };
}

describe("createBlock", () => {
  it("creates a block of the requested type with a unique id and sensible defaults", () => {
    const a = createBlock("heading");
    const b = createBlock("heading");
    expect(a.id).not.toBe(b.id);
    expect(a.type).toBe("heading");
    expect(a.props.level).toBe(2);
  });

  it("container types (section/container/columns/card) start with an empty children array", () => {
    for (const t of ["section", "container", "columns", "card"] as const) {
      expect(createBlock(t).children).toEqual([]);
      expect(isContainerBlock(t)).toBe(true);
    }
  });

  it("leaf types (text/heading/image/button/spacer/divider/templatePart/navigationMenu/form/testimonial) have no children", () => {
    for (const t of ["text", "heading", "image", "button", "spacer", "divider", "templatePart", "navigationMenu", "form", "testimonial"] as const) {
      expect(createBlock(t).children).toBeUndefined();
      expect(isContainerBlock(t)).toBe(false);
    }
  });

  it("creates a form block referencing no Form yet, and a testimonial block with empty text fields", () => {
    const form = createBlock("form");
    expect(form.props.formId).toBe("");
    const testimonial = createBlock("testimonial");
    expect(testimonial.props.quote).toBe("");
    expect(testimonial.props.authorName).toBe("");
  });
});

describe("insertBlock / findBlock / removeBlock", () => {
  it("inserts at root and finds it by id", () => {
    const heading = createBlock("heading");
    const d = insertBlock(doc([]), heading, null, 0);
    expect(findBlock(d, heading.id)?.id).toBe(heading.id);
  });

  it("inserts a block inside a named parent container", () => {
    const section = createBlock("section");
    let d = insertBlock(doc([]), section, null, 0);
    const text = createBlock("text");
    d = insertBlock(d, text, section.id, 0);
    expect(d.blocks[0]!.children).toHaveLength(1);
    expect(d.blocks[0]!.children![0]!.id).toBe(text.id);
  });

  it("removeBlock deletes a block and findBlock no longer finds it", () => {
    const heading = createBlock("heading");
    let d = insertBlock(doc([]), heading, null, 0);
    d = removeBlock(d, heading.id);
    expect(findBlock(d, heading.id)).toBeNull();
    expect(d.blocks).toHaveLength(0);
  });

  it("does not mutate the original document (immutability)", () => {
    const heading = createBlock("heading");
    const original = insertBlock(doc([]), heading, null, 0);
    const after = removeBlock(original, heading.id);
    expect(original.blocks).toHaveLength(1);
    expect(after.blocks).toHaveLength(0);
  });
});

describe("duplicateBlock", () => {
  it("creates a copy with a new id, immediately after the original, preserving props", () => {
    const button = createBlock("button");
    let d = insertBlock(doc([]), button, null, 0);
    d = duplicateBlock(d, button.id);
    expect(d.blocks).toHaveLength(2);
    expect(d.blocks[1]!.id).not.toBe(button.id);
    expect(d.blocks[1]!.props).toEqual(button.props);
  });

  it("recursively assigns new ids to duplicated children too", () => {
    const section = createBlock("section");
    const heading = createBlock("heading");
    let d = insertBlock(doc([]), section, null, 0);
    d = insertBlock(d, heading, section.id, 0);
    d = duplicateBlock(d, section.id);
    const copy = d.blocks[1]!;
    expect(copy.children![0]!.id).not.toBe(heading.id);
  });
});

describe("updateBlockProps", () => {
  it("merges a props patch without clobbering untouched props", () => {
    const heading = createBlock("heading");
    let d = insertBlock(doc([]), heading, null, 0);
    d = updateBlockProps(d, heading.id, { text: "Changed" });
    expect(d.blocks[0]!.props.text).toBe("Changed");
    expect(d.blocks[0]!.props.level).toBe(2);
  });
});

describe("moveSibling (reorder)", () => {
  it("swaps a block with its next sibling on 'down', and back on 'up'", () => {
    const a = createBlock("heading");
    const b = createBlock("text");
    let d = insertBlock(doc([]), a, null, 0);
    d = insertBlock(d, b, null, 1);
    d = moveSibling(d, a.id, "down");
    expect(d.blocks.map((x) => x.id)).toEqual([b.id, a.id]);
    d = moveSibling(d, a.id, "up");
    expect(d.blocks.map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it("is a no-op at the boundary (moving the first block up, or the last block down)", () => {
    const a = createBlock("heading");
    const d = insertBlock(doc([]), a, null, 0);
    expect(moveSibling(d, a.id, "up").blocks.map((x) => x.id)).toEqual([a.id]);
    expect(moveSibling(d, a.id, "down").blocks.map((x) => x.id)).toEqual([a.id]);
  });
});

describe("moveIntoParent (re-parenting)", () => {
  it("moves a root-level block into a container", () => {
    const section = createBlock("section");
    const heading = createBlock("heading");
    let d = insertBlock(doc([]), section, null, 0);
    d = insertBlock(d, heading, null, 1);
    d = moveIntoParent(d, heading.id, section.id);
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0]!.children![0]!.id).toBe(heading.id);
  });

  it("moves a nested block back out to root level when targetParentId is null", () => {
    const section = createBlock("section");
    const heading = createBlock("heading");
    let d = insertBlock(doc([]), section, null, 0);
    d = insertBlock(d, heading, section.id, 0);
    d = moveIntoParent(d, heading.id, null);
    expect(d.blocks.map((b) => b.id)).toEqual([section.id, heading.id]);
    expect(d.blocks[0]!.children).toHaveLength(0);
  });

  it("refuses to move a container into its own descendant (no cycles)", () => {
    const outer = createBlock("section");
    const inner = createBlock("container");
    let d = insertBlock(doc([]), outer, null, 0);
    d = insertBlock(d, inner, outer.id, 0);
    const result = moveIntoParent(d, outer.id, inner.id);
    // Unchanged: outer is still at root, inner still its child.
    expect(result.blocks.map((b) => b.id)).toEqual([outer.id]);
    expect(result.blocks[0]!.children![0]!.id).toBe(inner.id);
  });
});

describe("listContainers", () => {
  it("lists every container-type block, including nested ones, and excludes leaves", () => {
    const section = createBlock("section");
    const columns = createBlock("columns");
    const heading = createBlock("heading");
    let d = insertBlock(doc([]), section, null, 0);
    d = insertBlock(d, columns, section.id, 0);
    d = insertBlock(d, heading, columns.id, 0);
    const containers = listContainers(d.blocks);
    expect(containers.map((c) => c.id).sort()).toEqual([columns.id, section.id].sort());
  });
});

describe("blocksToPlainHtml (public safe-fallback body)", () => {
  it("flattens section/container/columns wrappers, keeping only their children's content", () => {
    const heading = createBlock("heading");
    const section = createBlock("section");
    let d = insertBlock(doc([]), section, null, 0);
    d = insertBlock(d, heading, section.id, 0);
    const html = blocksToPlainHtml(d, {});
    expect(html).toContain("<h2>");
    expect(html).not.toContain("<section");
  });

  it("renders a heading, text, and button with real tags", () => {
    const d = doc([
      { id: "h", type: "heading", props: { text: "Title", level: 1 } },
      { id: "t", type: "text", props: { html: "<p>Body</p>" } },
      { id: "b", type: "button", props: { label: "Go", href: "/go", variant: "primary" } },
    ]);
    const html = blocksToPlainHtml(d, {});
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Body</p>");
    expect(html).toContain('<a href="/go">Go</a>');
  });

  it("only renders an image once its URL is resolved in the media cache; omits it otherwise", () => {
    const d = doc([{ id: "i", type: "image", props: { mediaId: "media-1", alt: "pic" } }]);
    expect(blocksToPlainHtml(d, {})).toBe("");
    const html = blocksToPlainHtml(d, { "media-1": "https://cdn.example.com/pic.jpg" });
    expect(html).toContain("https://cdn.example.com/pic.jpg");
  });

  it("never inlines a templatePart block's content into the page body (avoids duplicating Header/Footer)", () => {
    const d = doc([{ id: "tp", type: "templatePart", props: { templatePartId: "header-1" } }]);
    expect(blocksToPlainHtml(d, {})).toBe("");
  });

  it("never inlines a form block — it needs real interactivity the static fallback can't provide", () => {
    const d = doc([{ id: "f", type: "form", props: { formId: "form-1" } }]);
    expect(blocksToPlainHtml(d, {})).toBe("");
  });

  it("renders a testimonial block as a blockquote with the author as a <cite>, HTML-escaped", () => {
    const d = doc([{ id: "t", type: "testimonial", props: { quote: "Great <product>!", authorName: "Jane <Doe>" } }]);
    const html = blocksToPlainHtml(d, {});
    expect(html).toContain("<blockquote>");
    expect(html).toContain("Great &lt;product&gt;!");
    expect(html).toContain("<cite>Jane &lt;Doe&gt;</cite>");
  });

  it("omits a testimonial block entirely when it has no quote", () => {
    const d = doc([{ id: "t", type: "testimonial", props: { quote: "" } }]);
    expect(blocksToPlainHtml(d, {})).toBe("");
  });

  it("escapes HTML-significant characters in heading text and button label/href", () => {
    const d = doc([{ id: "h", type: "heading", props: { text: '<img src=x onerror=alert(1)>', level: 2 } }]);
    const html = blocksToPlainHtml(d, {});
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("collectImageMediaIds", () => {
  it("collects every distinct image block's mediaId, including nested ones, de-duplicated", () => {
    const section = createBlock("section");
    const img1 = createBlock("image");
    const img2 = { ...createBlock("image"), props: { mediaId: img1.props.mediaId } };
    let d = insertBlock(doc([]), section, null, 0);
    d = insertBlock(d, { ...img1, props: { mediaId: "m1" } }, section.id, 0);
    d = insertBlock(d, { ...img2, props: { mediaId: "m1" } }, null, 1);
    d = insertBlock(d, { ...createBlock("image"), props: { mediaId: "m2" } }, null, 2);
    expect(collectImageMediaIds(d.blocks).sort()).toEqual(["m1", "m2"]);
  });

  it("ignores image blocks with no mediaId set yet", () => {
    const d = doc([{ id: "i", type: "image", props: { mediaId: "" } }]);
    expect(collectImageMediaIds(d.blocks)).toEqual([]);
  });

  it("also collects a testimonial block's avatarMediaId", () => {
    const d = doc([{ id: "t", type: "testimonial", props: { quote: "x", avatarMediaId: "avatar-1" } }]);
    expect(collectImageMediaIds(d.blocks)).toEqual(["avatar-1"]);
  });
});
