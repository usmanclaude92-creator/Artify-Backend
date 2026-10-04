/**
 * Site Editor block tree (Phase 2 — docs/control-center-replacement-roadmap.md
 * Phase 2/4 sections). Reuses ContentRevision.editorBlocks (Page) and
 * Template/TemplatePart's existing structure/content JSON fields — no new
 * table. The shape was left deliberately unfixed through Phase 1
 * (schema.prisma's own doc comments on TemplateRevision/TemplatePartRevision);
 * this is that shape, proven against the real Page/Template/TemplatePart
 * editing flow rather than designed in the abstract.
 *
 * A block is a typed node; container-shaped blocks (section/container/
 * columns/card) hold `children: Block[]`. `text`/`heading` carry their own
 * string content, sanitized the same way Page.body is (see
 * sanitizeEditorDocument below) — never trusted as pre-sanitized input.
 */
import { z } from "zod";
import { sanitizeContentHtml } from "../utils/sanitizeHtml";

const blockIdSchema = z.string().trim().min(1).max(100);

const baseFields = {
  id: blockIdSchema,
};

const sectionBlockSchema = z.object({
  ...baseFields,
  type: z.literal("section"),
  props: z
    .object({
      backgroundColor: z.string().trim().max(50).optional(),
      paddingY: z.enum(["none", "sm", "md", "lg", "xl"]).optional(),
      fullWidth: z.boolean().optional(),
    })
    .default({}),
  children: z.array(z.lazy(() => blockSchema)).default([]),
});

const containerBlockSchema = z.object({
  ...baseFields,
  type: z.literal("container"),
  props: z
    .object({
      maxWidth: z.enum(["sm", "md", "lg", "xl", "full"]).optional(),
    })
    .default({}),
  children: z.array(z.lazy(() => blockSchema)).default([]),
});

const columnsBlockSchema = z.object({
  ...baseFields,
  type: z.literal("columns"),
  props: z
    .object({
      columnCount: z.number().int().min(2).max(4).default(2),
      gap: z.enum(["none", "sm", "md", "lg"]).optional(),
    })
    .default({ columnCount: 2 }),
  // Each child is expected to be a "container" representing one column;
  // not enforced at the schema layer (kept recursive/generic) so the
  // Site Editor can nest arbitrary content per column.
  children: z.array(z.lazy(() => blockSchema)).default([]),
});

const textBlockSchema = z.object({
  ...baseFields,
  type: z.literal("text"),
  props: z.object({
    html: z.string().max(100000).default(""),
  }),
});

const headingBlockSchema = z.object({
  ...baseFields,
  type: z.literal("heading"),
  props: z.object({
    text: z.string().trim().max(500).default(""),
    level: z.number().int().min(1).max(6).default(2),
  }),
});

const imageBlockSchema = z.object({
  ...baseFields,
  type: z.literal("image"),
  props: z.object({
    mediaId: z.string().trim().uuid(),
    alt: z.string().trim().max(300).optional(),
    caption: z.string().trim().max(500).optional(),
  }),
});

const buttonBlockSchema = z.object({
  ...baseFields,
  type: z.literal("button"),
  props: z.object({
    label: z.string().trim().min(1).max(100),
    href: z.string().trim().max(2000),
    variant: z.enum(["primary", "secondary", "outline", "ghost"]).default("primary"),
    openInNewTab: z.boolean().optional(),
  }),
});

const cardBlockSchema = z.object({
  ...baseFields,
  type: z.literal("card"),
  props: z.object({
    title: z.string().trim().max(200).optional(),
    body: z.string().max(20000).optional(),
    mediaId: z.string().trim().uuid().optional(),
  }),
  children: z.array(z.lazy(() => blockSchema)).default([]),
});

const spacerBlockSchema = z.object({
  ...baseFields,
  type: z.literal("spacer"),
  props: z.object({
    height: z.number().int().min(0).max(1000).default(40),
  }),
});

const dividerBlockSchema = z.object({
  ...baseFields,
  type: z.literal("divider"),
  props: z
    .object({
      style: z.enum(["solid", "dashed"]).optional(),
    })
    .default({}),
});

// References a TemplatePart by id — resolved at render time, not inlined,
// so an edit to the shared part is reflected everywhere it's referenced
// (the same reuse model templatePartService.ts documents for Template
// structure referencing Template Parts).
const templatePartBlockSchema = z.object({
  ...baseFields,
  type: z.literal("templatePart"),
  props: z.object({
    templatePartId: z.string().trim().uuid(),
  }),
});

// References a NavigationMenu by id (Phase 5) — resolved at render time,
// same reuse model as templatePartBlockSchema above. This is how a menu
// gets "assigned to a template/template part" (e.g. a HEADER TemplatePart's
// content includes one of these) without inventing a second, parallel
// navigation system.
const navigationMenuBlockSchema = z.object({
  ...baseFields,
  type: z.literal("navigationMenu"),
  props: z.object({
    navigationMenuId: z.string().trim().uuid(),
  }),
});

// References a Form by id (Phase 9 — Forms + Landing Pages + Conversion) —
// resolved at render time against the real Form, same reuse model as
// templatePart/navigationMenu above: the editor stores only the
// reference, never a frozen copy of the form's fields, so an edit to the
// Form is reflected everywhere it's embedded. This is the mechanism for
// "lead forms"/"newsletter signup"/"contact blocks" as reusable
// conversion elements — a newsletter signup is just a Form with one email
// field embedded via this same block.
const formBlockSchema = z.object({
  ...baseFields,
  type: z.literal("form"),
  props: z.object({
    formId: z.string().trim().uuid(),
  }),
});

// A trust/testimonial section (Phase 9). Plain text fields only (never
// rendered via dangerouslySetInnerHTML on either side) — a quote is
// always attacker-influenceable content (anyone who can edit a page), so
// keeping it as plain text rather than HTML is the simplest way to make
// it inherently safe rather than relying on a sanitize pass.
const testimonialBlockSchema = z.object({
  ...baseFields,
  type: z.literal("testimonial"),
  props: z.object({
    quote: z.string().trim().max(2000).default(""),
    authorName: z.string().trim().max(150).optional(),
    authorTitle: z.string().trim().max(150).optional(),
    avatarMediaId: z.string().trim().uuid().optional(),
  }),
});

export const blockSchema: z.ZodType<unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    sectionBlockSchema,
    containerBlockSchema,
    columnsBlockSchema,
    textBlockSchema,
    headingBlockSchema,
    imageBlockSchema,
    buttonBlockSchema,
    cardBlockSchema,
    spacerBlockSchema,
    dividerBlockSchema,
    templatePartBlockSchema,
    navigationMenuBlockSchema,
    formBlockSchema,
    testimonialBlockSchema,
  ])
);
export type Block = z.infer<typeof sectionBlockSchema> | Record<string, unknown>;

export const editorDocumentSchema = z.object({
  version: z.literal(1).default(1),
  blocks: z.array(blockSchema).default([]),
});
export type EditorDocument = z.infer<typeof editorDocumentSchema>;

// Mirrors sanitizeContentHtml's role for Page.body (server/utils/sanitizeHtml.ts)
// — the client (or the AI Copilot tool, once it's extended to write editor
// content) is never trusted to have pre-sanitized "text"/"card" HTML.
// Recurses into every container block's children so nothing nested escapes
// the pass.
function sanitizeBlock(block: Record<string, unknown>): Record<string, unknown> {
  const next = { ...block };
  if (next.type === "text" || next.type === "card") {
    const props = { ...(next.props as Record<string, unknown>) };
    if (typeof props.html === "string") props.html = sanitizeContentHtml(props.html);
    if (typeof props.body === "string") props.body = sanitizeContentHtml(props.body);
    next.props = props;
  }
  if (Array.isArray(next.children)) {
    next.children = (next.children as Record<string, unknown>[]).map(sanitizeBlock);
  }
  return next;
}

export function sanitizeEditorDocument(doc: EditorDocument): EditorDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => sanitizeBlock(b as Record<string, unknown>)) as EditorDocument["blocks"],
  };
}

/**
 * TemplatePart.content stays unconstrained JSON at the schema layer
 * (server/schemas/templateSchemas.ts — validating it strictly here would
 * silently strip any legacy/non-editor content, since zod drops
 * unrecognized object keys by default). This only applies the HTML
 * sanitize pass when content actually looks like a Site Editor document
 * (a real `blocks` array present) — anything else passes through
 * unchanged, same as before Phase 2.
 */
export function sanitizeContentIfEditorDocument(content: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(content.blocks)) return content;
  const parsed = editorDocumentSchema.safeParse(content);
  return parsed.success ? sanitizeEditorDocument(parsed.data) : content;
}

export const BLOCK_TYPES = [
  "section",
  "container",
  "columns",
  "text",
  "heading",
  "image",
  "button",
  "card",
  "spacer",
  "divider",
  "templatePart",
  "navigationMenu",
  "form",
  "testimonial",
] as const;
