import { describe, expect, it } from "vitest";
import { isSafeHref, landingDocumentSchema, landingSlugSchema, publicLandingSubmitSchema } from "../../server/schemas/landingSchemas";
import { isReservedLandingSlug, landingPublishIssues } from "../../server/services/landing/landingContent";
import { buildTemplateDocument, LANDING_TEMPLATES } from "../../server/services/landing/landingTemplates";

const hero = (over: object = {}) => ({ id: "h", type: "lp_hero", props: { headline: "Real headline", primaryCta: { label: "Go", href: "#contact" }, ...over } });
const form = (over: object = {}) => ({
  id: "f", type: "lp_form",
  props: { heading: "Talk to us", fields: [{ key: "email", label: "Email", type: "email", required: true }], consent: { enabled: false, text: "", privacyUrl: "" }, submitLabel: "Send", successMessage: "Thanks", ...over },
});

describe("landing block validation", () => {
  it("accepts only safe links", () => {
    for (const ok of ["https://example.com/x", "/privacy", "#form", "mailto:a@b.co", "tel:+4915112345"]) expect(isSafeHref(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://example.com", "//evil.com", "/\\evil", " ", "#", "vbscript:x", "https://", "/a b"]) expect(isSafeHref(bad), bad).toBe(false);
  });

  it("rejects unknown block types and unknown props shapes (no raw HTML block exists)", () => {
    expect(landingDocumentSchema.safeParse({ version: 1, blocks: [hero(), { id: "x", type: "html", props: { html: "<script>1</script>" } }] }).success).toBe(false);
    expect(landingDocumentSchema.safeParse({ version: 1, blocks: [{ id: "x", type: "script", props: {} }] }).success).toBe(false);
  });

  it("requires alt text on images and a Media-library uuid", () => {
    const id = "4f1c2b1e-6f0b-4b5a-9a63-0d4b0f6a9a11";
    expect(landingDocumentSchema.safeParse({ version: 1, blocks: [hero({ image: { mediaId: id, alt: "A product screenshot" } })] }).success).toBe(true);
    expect(landingDocumentSchema.safeParse({ version: 1, blocks: [hero({ image: { mediaId: id, alt: "" } })] }).success).toBe(false);
    expect(landingDocumentSchema.safeParse({ version: 1, blocks: [hero({ image: { mediaId: "https://evil/x.png", alt: "x" } })] }).success).toBe(false);
  });

  it("enforces structure: one hero first, one form, footer last, unique ids", () => {
    expect(landingDocumentSchema.safeParse({ version: 1, blocks: [hero(), hero({}), ] }).success).toBe(false); // duplicate id + two heroes
    expect(landingDocumentSchema.safeParse({ version: 1, blocks: [form(), hero()] }).success).toBe(false);
    expect(landingDocumentSchema.safeParse({ version: 1, blocks: [hero(), form(), { ...form(), id: "f2" }] }).success).toBe(false);
    expect(landingDocumentSchema.safeParse({ version: 1, blocks: [hero(), { id: "ft", type: "lp_footer", props: {} }, form()] }).success).toBe(false);
    expect(landingDocumentSchema.safeParse({ version: 1, blocks: [hero(), form()] }).success).toBe(true);
  });

  it("form rules: needs email or phone, consent needs text and a privacy link, reserved/duplicate keys blocked", () => {
    const parse = (props: object) => landingDocumentSchema.safeParse({ version: 1, blocks: [hero(), form(props)] }).success;
    expect(parse({ fields: [{ key: "name", label: "Name", type: "text", required: true }] })).toBe(false);
    expect(parse({ consent: { enabled: true, text: "", privacyUrl: "" } })).toBe(false);
    expect(parse({ consent: { enabled: true, text: "I agree to be contacted about my request.", privacyUrl: "" } })).toBe(false);
    expect(parse({ consent: { enabled: true, text: "I agree to be contacted about my request.", privacyUrl: "/privacy" } })).toBe(true);
    expect(parse({ fields: [{ key: "email", label: "Email", type: "email", required: true }, { key: "email", label: "Again", type: "email", required: false }] })).toBe(false);
    expect(parse({ fields: [{ key: "email", label: "Email", type: "email", required: true }, { key: "website", label: "Site", type: "text", required: false }] })).toBe(false);
    expect(parse({ fields: [{ key: "email", label: "Email", type: "text", required: true }] })).toBe(false);
  });

  it("slug rules", () => {
    for (const ok of ["spring-sale", "abc", "a1-b2"]) expect(landingSlugSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["ab", "-x-", "a--b", "Upper", "a_b", "a/b", "a b", ""]) expect(landingSlugSchema.safeParse(bad).success, bad).toBe(false);
    for (const r of ["admin", "api", "blog", "contact", "preview"]) expect(isReservedLandingSlug(r), r).toBe(true);
    expect(isReservedLandingSlug("spring-sale")).toBe(false);
  });

  it("every starter template is valid, uses only placeholders for claims, and cannot be published as is", () => {
    expect(LANDING_TEMPLATES).toHaveLength(3);
    for (const t of LANDING_TEMPLATES) {
      const doc = buildTemplateDocument(t.key);
      expect(landingDocumentSchema.safeParse(doc).success, t.key).toBe(true);
      const issues = landingPublishIssues({ title: "Real title", document: doc, seo: { metaDescription: "A real description" } });
      expect(issues.length, t.key).toBeGreaterThan(0);
      const text = JSON.stringify(doc);
      expect(text).not.toMatch(/\d+\s*%|\bcustomers?\b.*\d{3,}|trusted by/i);
    }
  });

  it("submit schema is strict about touch data", () => {
    expect(publicLandingSubmitSchema.safeParse({ data: { email: "a@b.co" }, lastTouch: { utmSource: "x" } }).success).toBe(true);
    expect(publicLandingSubmitSchema.safeParse({ data: {}, lastTouch: { evil: "x" } }).success).toBe(false);
  });
});
