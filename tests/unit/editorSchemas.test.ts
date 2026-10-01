/**
 * Phase 2 (Site Editor) — pure validation/sanitization unit tests for the
 * block-tree schema (server/schemas/editorSchemas.ts). No database — these
 * are zod parsing and DOMPurify sanitization only.
 */
import { describe, expect, it } from "vitest";
import { editorDocumentSchema, sanitizeEditorDocument, sanitizeContentIfEditorDocument, blockSchema } from "../../server/schemas/editorSchemas";

describe("editorDocumentSchema", () => {
  it("accepts a real nested block tree (section > columns > container > text/heading/image/button)", () => {
    const doc = {
      version: 1,
      blocks: [
        {
          id: "s1",
          type: "section",
          props: { paddingY: "lg" },
          children: [
            {
              id: "c1",
              type: "columns",
              props: { columnCount: 2 },
              children: [
                { id: "h1", type: "heading", props: { text: "Welcome", level: 2 } },
                { id: "t1", type: "text", props: { html: "<p>Hello</p>" } },
                { id: "i1", type: "image", props: { mediaId: "11111111-1111-1111-1111-111111111111", alt: "x" } },
                { id: "b1", type: "button", props: { label: "Go", href: "/x", variant: "primary" } },
              ],
            },
          ],
        },
      ],
    };
    const parsed = editorDocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
  });

  it("defaults version/blocks when omitted (an empty document is valid)", () => {
    const parsed = editorDocumentSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ version: 1, blocks: [] });
  });

  it("rejects a block with an unknown type", () => {
    const parsed = editorDocumentSchema.safeParse({ version: 1, blocks: [{ id: "x", type: "not-a-real-type", props: {} }] });
    expect(parsed.success).toBe(false);
  });

  it("rejects an image block without a valid mediaId", () => {
    const parsed = blockSchema.safeParse({ id: "i1", type: "image", props: { mediaId: "not-a-uuid" } });
    expect(parsed.success).toBe(false);
  });

  it("rejects a columns block with fewer than 2 or more than 4 columns", () => {
    expect(editorDocumentSchema.safeParse({ blocks: [{ id: "c1", type: "columns", props: { columnCount: 1 }, children: [] }] }).success).toBe(false);
    expect(editorDocumentSchema.safeParse({ blocks: [{ id: "c1", type: "columns", props: { columnCount: 5 }, children: [] }] }).success).toBe(false);
  });
});

describe("sanitizeEditorDocument", () => {
  it("strips a script tag out of a text block's html, recursively through nested containers", () => {
    const doc = editorDocumentSchema.parse({
      version: 1,
      blocks: [
        {
          id: "s1",
          type: "section",
          props: {},
          children: [{ id: "t1", type: "text", props: { html: '<p>safe</p><script>alert(1)</script>' } }],
        },
      ],
    });
    const sanitized = sanitizeEditorDocument(doc);
    const textBlock = sanitized.blocks[0] as { children: { props: { html: string } }[] };
    expect(textBlock.children[0]!.props.html).not.toContain("<script>");
    expect(textBlock.children[0]!.props.html).toContain("safe");
  });

  it("strips script tags from a card block's body", () => {
    const doc = editorDocumentSchema.parse({
      version: 1,
      blocks: [{ id: "card1", type: "card", props: { title: "T", body: '<img src=x onerror="alert(1)">' }, children: [] }],
    });
    const sanitized = sanitizeEditorDocument(doc);
    const card = sanitized.blocks[0] as { props: { body: string } };
    expect(card.props.body).not.toContain("onerror");
  });

  it("leaves non-HTML-bearing block types (heading/button/spacer) untouched", () => {
    const doc = editorDocumentSchema.parse({
      version: 1,
      blocks: [
        { id: "h1", type: "heading", props: { text: "Hi", level: 2 } },
        { id: "sp1", type: "spacer", props: { height: 20 } },
      ],
    });
    const sanitized = sanitizeEditorDocument(doc);
    expect(sanitized).toEqual(doc);
  });
});

describe("sanitizeContentIfEditorDocument (TemplatePart.content backward compatibility)", () => {
  it("passes through legacy free-form content (no blocks array) completely unchanged", () => {
    const legacy = { logo: "artify", links: ["/", "/about"] };
    expect(sanitizeContentIfEditorDocument(legacy)).toEqual(legacy);
  });

  it("sanitizes content that genuinely looks like an editor document (has a blocks array)", () => {
    const content = { version: 1, blocks: [{ id: "t1", type: "text", props: { html: "<script>x</script><p>ok</p>" } }] };
    const result = sanitizeContentIfEditorDocument(content) as { blocks: { props: { html: string } }[] };
    expect(result.blocks[0]!.props.html).not.toContain("<script>");
  });

  it("falls back to the original value if `blocks` is present but doesn't actually validate as a document", () => {
    const malformed = { blocks: "not-an-array-despite-the-key-name" };
    expect(sanitizeContentIfEditorDocument(malformed)).toEqual(malformed);
  });
});
