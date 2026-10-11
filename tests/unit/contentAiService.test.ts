/** AI writer for Posts/Products: governed call, output clipped to field limits, HTML sanitised, nothing saved. */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../server/services/social/socialAiService", () => ({ run: runMock, brandVoiceText: () => "VOICE" }));
vi.mock("../../server/services/social/socialPostService", () => ({ socialPostService: { getBrandVoice: async () => ({ languages: ["en"] }) } }));

import { contentAiService } from "../../server/services/contentAiService";

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
});
