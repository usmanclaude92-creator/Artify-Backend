/** Pure content rules for landing pages (no I/O): reserved slugs, media collection, plain-text flattening and the publish checklist. */
import { landingDocumentSchema, type LandingDocument, type LandingBlock } from "../../schemas/landingSchemas";

/**
 * Slugs that can never be a landing page: they collide with site routes, system paths or things that must stay reachable.
 * (Landing pages live under /lp/<slug>, so a collision is not technical today; the list keeps URLs unambiguous and future-proof.)
 */
export const RESERVED_LANDING_SLUGS: ReadonlySet<string> = new Set([
  "admin", "api", "app", "assets", "blog", "case-studies", "contact", "about", "privacy", "terms", "portal", "login", "logout", "register", "signup", "sign-in", "sign-up",
  "verify-email", "reset-password", "sitemap", "sitemap-xml", "robots", "robots-txt", "health", "static", "public", "preview", "submit", "lp", "services", "solutions",
  "ai-solutions", "industries", "ecosystem", "updates", "search", "new", "edit", "draft", "null", "undefined", "favicon", "www", "cc", "dashboard", "settings", "account",
]);
export const isReservedLandingSlug = (slug: string): boolean => RESERVED_LANDING_SLUGS.has(slug.toLowerCase());

export interface PublishIssue { blockId?: string; message: string }

/** Every Media-library id a document references (hero/feature images, testimonial avatars). */
export function collectLandingMediaIds(doc: LandingDocument): string[] {
  const ids = new Set<string>();
  for (const b of doc.blocks) {
    if (b.type === "lp_hero" && b.props.image) ids.add(b.props.image.mediaId);
    if (b.type === "lp_features") b.props.items.forEach((i) => i.image && ids.add(i.image.mediaId));
    if (b.type === "lp_testimonials") b.props.items.forEach((i) => i.avatar && ids.add(i.avatar.mediaId));
  }
  return [...ids];
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => strings(v, out));
  return out;
}

/** All human-readable text of a block (ids, hrefs and media ids excluded). */
function blockText(b: LandingBlock): string[] {
  const p = b.props as Record<string, unknown>;
  const walk = (v: unknown): string[] => {
    if (typeof v === "string") return [v];
    if (Array.isArray(v)) return v.flatMap(walk);
    if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).filter(([k]) => !["href", "mediaId", "key", "type", "privacyUrl", "redirectUrl", "value"].includes(k)).flatMap(([, x]) => walk(x));
    return [];
  };
  return walk(p);
}

/** A plain-text rendition of the page, stored as the revision `body` (search, excerpts, diffing). Never rendered as HTML. */
export function flattenLandingText(doc: LandingDocument): string {
  return doc.blocks.flatMap(blockText).join("\n").slice(0, 100_000);
}

const PLACEHOLDER_TOKEN = /\[\[|\]\]/;

/**
 * The publish checklist. Returns every reason this page may not go live; an empty list means publishable.
 * Placeholder content (flagged blocks or any leftover `[[...]]` token) can never be published, testimonials need an explicit
 * "these are real quotes" attestation, and the page needs a title, a meta description and a valid block document.
 */
export function landingPublishIssues(input: { title: string; document: unknown; seo: { metaTitle?: string; metaDescription?: string } }): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (!input.title.trim()) issues.push({ message: "The page needs a title." });
  if (!input.seo.metaDescription?.trim()) issues.push({ message: "Add a meta description (search and social previews)." });
  const parsed = landingDocumentSchema.safeParse(input.document);
  if (!parsed.success) {
    issues.push({ message: "The page content is not valid: " + (parsed.error.issues[0]?.message ?? "check the blocks.") });
    return issues;
  }
  const doc = parsed.data;
  if (doc.blocks.length === 0) issues.push({ message: "Add at least a hero block." });
  for (const b of doc.blocks) {
    if (b.placeholder) issues.push({ blockId: b.id, message: `The ${b.type.replace("lp_", "")} block still holds placeholder content. Replace it with real content, then confirm it.` });
    else if (blockText(b).some((t) => PLACEHOLDER_TOKEN.test(t))) issues.push({ blockId: b.id, message: `The ${b.type.replace("lp_", "")} block still contains a [[placeholder]].` });
    if (b.type === "lp_testimonials" && !b.props.confirmedReal) issues.push({ blockId: b.id, message: "Confirm that every testimonial is a real quote from a real customer who agreed to be quoted." });
  }
  if (input.seo.metaTitle && PLACEHOLDER_TOKEN.test(input.seo.metaTitle)) issues.push({ message: "The meta title still contains a [[placeholder]]." });
  if (input.seo.metaDescription && PLACEHOLDER_TOKEN.test(input.seo.metaDescription)) issues.push({ message: "The meta description still contains a [[placeholder]]." });
  if (PLACEHOLDER_TOKEN.test(input.title)) issues.push({ message: "The title still contains a [[placeholder]]." });
  void strings;
  return issues;
}
