/** AI writer for Posts/Products: governed call, output clipped to field limits, HTML sanitised, nothing saved. */
import { describe, expect, it, vi, beforeEach, afterAll } from "vitest";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../server/services/social/socialAiService", () => ({ run: runMock, brandVoiceText: () => "VOICE" }));
vi.mock("../../server/services/social/socialPostService", () => ({ socialPostService: { getBrandVoice: async () => ({ languages: ["en"] }) } }));

import { contentAiService, nextProductCode, uniqueProductSlug } from "../../server/services/contentAiService";
import { prisma } from "../../server/db/prisma";

const caller = { id: "u1", organizationId: "o1" } as never;

beforeEach(() => { runMock.mockReset(); });
const parseWith = (v: unknown) => async (p: { schema: { parse: (x: unknown) => unknown } }) => ({ result: p.schema.parse(v), executionId: "x" });

describe("contentAiService", () => {
  it("writePost sanitises the HTML and runs under a social_ tool code so the daily limit counts it", async () => {
    runMock.mockImplementation(parseWith({ title: "T", excerpt: "E", bodyHtml: "<p>Hi</p><script>alert(1)</script>", seoTitle: "S", seoDescription: "D" }));
    const out = await contentAiService.writePost(caller, { brief: "Write about chatbots", length: "short" });
    expect(out.bodyHtml).toContain("<p>Hi</p>");
    expect(out.bodyHtml).not.toContain("<script");
    expect(out.executionId).toBe("x");
    const call = runMock.mock.calls[0]![0] as { toolCode: string; variables: Record<string, unknown> };
    expect(call.toolCode).toBe("social_cms_post");
    expect(call.variables.length).toBe(400);
  });

  it("writeProduct clips over-long fields and defaults missing lists", async () => {
    runMock.mockImplementation(parseWith({ shortDescription: "x".repeat(400), seoTitle: "y".repeat(200) }));
    const out = await contentAiService.writeProduct(caller, { brief: "A chatbot package", itemType: "SERVICE" });
    expect(out.shortDescription).toHaveLength(300);
    expect(out.seoTitle.length).toBeLessThanOrEqual(70);
    expect(out.benefits).toEqual([]);
    expect((runMock.mock.calls[0]![0] as { variables: Record<string, unknown> }).variables.itemType).toBe("service");
  });

  it("writePost returns a unique slug, focus keywords and OG fields within limits", async () => {
    runMock.mockImplementation(parseWith({
      title: "T", slug: "How Clinics Use AI Chatbots!", excerpt: "E", bodyHtml: "<p>x</p>", seoTitle: "S".repeat(90), seoDescription: "D",
      focusKeywords: ["AI chatbot", "ai chatbot", "clinic automation", "a", "b", "c", "d", "e"], ogTitle: "O".repeat(120), ogDescription: "OD",
    }));
    const out = await contentAiService.writePost(caller, { brief: "How clinics use AI chatbots" });
    expect(out.slug).toBe("how-clinics-use-ai-chatbots");
    expect(out.seoTitle.length).toBeLessThanOrEqual(60);
    expect(out.ogTitle.length).toBeLessThanOrEqual(90);
    expect(out.focusKeywords[0]).toBe("ai chatbot");
    expect(new Set(out.focusKeywords).size).toBe(out.focusKeywords.length);
    expect(out.focusKeywords.length).toBeLessThanOrEqual(6);
  });

  describe("product identity (code and slug)", () => {
    const rows = [{ code: "CAS-001", slug: "artify-cas" }, { code: "CAS-007", slug: "artify-cas-2" }];
    beforeEach(async () => {
      await prisma.product.deleteMany({ where: { code: { in: rows.map((r) => r.code) } } });
      for (const r of rows) await prisma.product.create({ data: { code: r.code, name: r.slug, slug: r.slug, type: "PRODUCT" } });
    });
    afterAll(async () => { await prisma.product.deleteMany({ where: { code: { in: rows.map((r) => r.code) } } }); });

    it("next code continues after the highest used number for that prefix", async () => {
      expect(await nextProductCode("cas", "Artify CAS")).toBe("CAS-008");
      expect(await nextProductCode("ZZ", "Zed")).toBe("ZZ-001");
    });

    it("falls back to the name's initials when the AI prefix is unusable", async () => {
      expect(await nextProductCode("!", "Smart Hotel Concierge")).toBe("SHC-001");
    });

    it("slug avoids existing products but an edited product may keep its own", async () => {
      expect(await uniqueProductSlug("Artify CAS")).toBe("artify-cas-3");
      const own = await prisma.product.findUniqueOrThrow({ where: { slug: "artify-cas" } });
      expect(await uniqueProductSlug("Artify CAS", own.id)).toBe("artify-cas");
    });

    it("writeProduct gives a new item a code, and an existing one no code", async () => {
      runMock.mockImplementation(parseWith({
        name: "Artify CAS - Construction Accounting Software", codePrefix: "CAS", slug: "artify cas construction accounting", shortDescription: "s",
        seoTitle: "t", seoDescription: "d", focusKeywords: ["construction accounting software"], ogTitle: "o", ogDescription: "od",
      }));
      const created = await contentAiService.writeProduct(caller, { brief: "Artify CAS construction accounting" });
      expect(created.code).toBe("CAS-008");
      expect(created.slug).toBe("artify-cas-construction-accounting");
      expect(created.name).toBe("Artify CAS - Construction Accounting Software");
      const own = await prisma.product.findUniqueOrThrow({ where: { slug: "artify-cas" } });
      const edited = await contentAiService.writeProduct(caller, { brief: "Artify CAS construction accounting", productId: own.id });
      expect(edited.code).toBeNull();
    });
  });
});
