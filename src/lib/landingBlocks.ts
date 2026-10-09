/**
 * Field specs for the landing page block editor (mirror of server/schemas/landingSchemas.ts, which stays the source of truth:
 * the server re-validates everything). Plain text only: there is deliberately no HTML field.
 */
export type FieldKind = "text" | "textarea" | "cta" | "image" | "bool" | "list" | "strings" | "formFields" | "consent";
export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  max?: number;
  optional?: boolean;
  /** list: item fields and bounds */
  itemFields?: FieldSpec[];
  minItems?: number;
  maxItems?: number;
  hint?: string;
}
export interface BlockSpec { type: string; label: string; description: string; fields: FieldSpec[]; blank: () => Record<string, unknown>; unique?: boolean }

const cta = (key: string, label: string, optional = false): FieldSpec => ({ key, label, kind: "cta", optional });

export const BLOCK_SPECS: BlockSpec[] = [
  {
    type: "lp_hero", label: "Hero", unique: true, description: "The page's single H1, a short supporting line and the main button.",
    fields: [
      { key: "eyebrow", label: "Small label above the headline", kind: "text", max: 60, optional: true },
      { key: "headline", label: "Headline (H1)", kind: "text", max: 120 },
      { key: "subheadline", label: "Supporting text", kind: "textarea", max: 300, optional: true },
      cta("primaryCta", "Main button"), cta("secondaryCta", "Second button", true),
      { key: "image", label: "Image", kind: "image", optional: true },
    ],
    blank: () => ({ headline: "", primaryCta: { label: "Get started", href: "#contact" } }),
  },
  {
    type: "lp_benefits", label: "Benefits", description: "2–6 short benefits.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "items", label: "Benefits", kind: "list", minItems: 2, maxItems: 6, itemFields: [{ key: "title", label: "Title", kind: "text", max: 80 }, { key: "text", label: "Text", kind: "textarea", max: 240 }] },
    ],
    blank: () => ({ heading: "", items: [{ title: "", text: "" }, { title: "", text: "" }] }),
  },
  {
    type: "lp_features", label: "Features", description: "Feature rows with optional images (alt text required).",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "intro", label: "Intro", kind: "textarea", max: 300, optional: true },
      { key: "items", label: "Features", kind: "list", minItems: 1, maxItems: 8, itemFields: [{ key: "title", label: "Title", kind: "text", max: 80 }, { key: "text", label: "Text", kind: "textarea", max: 300 }, { key: "image", label: "Image", kind: "image", optional: true }] },
    ],
    blank: () => ({ heading: "", items: [{ title: "", text: "" }] }),
  },
  {
    type: "lp_testimonials", label: "Testimonials", description: "Real quotes only. Publishing needs your confirmation that each quote is real and permitted.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "items", label: "Quotes", kind: "list", minItems: 1, maxItems: 6, itemFields: [{ key: "quote", label: "Quote", kind: "textarea", max: 500 }, { key: "authorName", label: "Name", kind: "text", max: 80 }, { key: "authorRole", label: "Role", kind: "text", max: 80, optional: true }, { key: "company", label: "Company", kind: "text", max: 80, optional: true }] },
      { key: "confirmedReal", label: "I confirm every quote is a real statement from a real customer who agreed to be quoted", kind: "bool" },
    ],
    blank: () => ({ heading: "", items: [{ quote: "", authorName: "" }], confirmedReal: false }),
  },
  {
    type: "lp_pricing", label: "Pricing", description: "1–4 plans. Use real prices only.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "intro", label: "Intro", kind: "textarea", max: 300, optional: true },
      { key: "plans", label: "Plans", kind: "list", minItems: 1, maxItems: 4, itemFields: [
        { key: "name", label: "Plan name", kind: "text", max: 60 }, { key: "price", label: "Price", kind: "text", max: 40 }, { key: "period", label: "Period", kind: "text", max: 30, optional: true },
        { key: "description", label: "Description", kind: "text", max: 160, optional: true }, { key: "features", label: "Included (one per line)", kind: "strings", max: 100, maxItems: 10, optional: true },
        cta("cta", "Plan button"), { key: "highlighted", label: "Highlight this plan", kind: "bool", optional: true },
      ] },
      { key: "footnote", label: "Footnote", kind: "text", max: 200, optional: true },
    ],
    blank: () => ({ heading: "", plans: [{ name: "", price: "", features: [], cta: { label: "Choose", href: "#contact" } }] }),
  },
  {
    type: "lp_faq", label: "FAQ", description: "Questions and answers.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "items", label: "Questions", kind: "list", minItems: 1, maxItems: 12, itemFields: [{ key: "question", label: "Question", kind: "text", max: 200 }, { key: "answer", label: "Answer", kind: "textarea", max: 1000 }] },
    ],
    blank: () => ({ heading: "", items: [{ question: "", answer: "" }] }),
  },
  {
    type: "lp_cta", label: "Call to action", description: "A closing prompt with one button.",
    fields: [{ key: "heading", label: "Heading", kind: "text", max: 120 }, { key: "text", label: "Text", kind: "textarea", max: 300, optional: true }, cta("cta", "Button")],
    blank: () => ({ heading: "", cta: { label: "Get started", href: "#contact" } }),
  },
  {
    type: "lp_form", label: "Lead form", unique: true, description: "Creates a CRM lead with the visit's UTM data. The consent checkbox needs text and a privacy link.",
    fields: [
      { key: "heading", label: "Heading", kind: "text", max: 120 },
      { key: "intro", label: "Intro", kind: "textarea", max: 300, optional: true },
      { key: "fields", label: "Fields", kind: "formFields" },
      { key: "consent", label: "Consent", kind: "consent" },
      { key: "submitLabel", label: "Button label", kind: "text", max: 40 },
      { key: "successMessage", label: "Success message", kind: "textarea", max: 300 },
      { key: "redirectUrl", label: "Redirect after success (optional, https:// or /path)", kind: "text", max: 2000, optional: true },
    ],
    blank: () => ({
      heading: "", fields: [{ key: "name", label: "Name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }],
      consent: { enabled: true, text: "I agree that you may contact me about my request.", privacyUrl: "/privacy" }, submitLabel: "Send", successMessage: "Thank you. We will be in touch.",
    }),
  },
  {
    type: "lp_footer", label: "Footer", unique: true, description: "Optional footer text and links. Always last.",
    fields: [
      { key: "text", label: "Text", kind: "text", max: 300, optional: true },
      { key: "links", label: "Links", kind: "list", maxItems: 6, minItems: 0, itemFields: [{ key: "label", label: "Label", kind: "text", max: 40 }, { key: "href", label: "Link", kind: "text", max: 2000 }] },
      { key: "copyright", label: "Copyright line", kind: "text", max: 100, optional: true },
    ],
    blank: () => ({ links: [] }),
  },
];

export const SPEC_BY_TYPE: Record<string, BlockSpec> = Object.fromEntries(BLOCK_SPECS.map((s) => [s.type, s]));

export function newBlockId(type: string): string {
  return `${type.replace("lp_", "")}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Drops empty optional values so the server (which rejects empty strings for some fields) gets a clean document. */
export function cleanProps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanProps);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === "" || v === undefined || v === null) continue;
      out[k] = cleanProps(v);
    }
    return out;
  }
  return value;
}

export const FORM_FIELD_TYPES = ["text", "email", "tel", "textarea", "select"] as const;
