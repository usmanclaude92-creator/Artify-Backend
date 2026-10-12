import { describe, expect, it, vi, beforeEach } from "vitest";

const post = vi.fn();
vi.mock("./apiClient", async () => {
  const actual = await vi.importActual<typeof import("./apiClient")>("./apiClient");
  return { ...actual, apiClient: { ...actual.apiClient, post: (...a: unknown[]) => post(...a) } };
});

import { contentAiApi, socialContentApi, AI_REQUEST_TIMEOUT_MS } from "./api";

beforeEach(() => post.mockReset().mockResolvedValue({}));

describe("AI requests get a longer timeout than the 15s default", () => {
  it("content writer calls", async () => {
    await contentAiApi.writePost({ brief: "x".repeat(12) });
    await contentAiApi.writeProduct({ brief: "x".repeat(12) });
    for (const call of post.mock.calls) expect(call[2]).toEqual({ timeoutMs: AI_REQUEST_TIMEOUT_MS });
    expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThan(30_000);
  });

  it("social drafting calls", async () => {
    post.mockResolvedValue({ post: {} });
    await socialContentApi.aiDraft({ instruction: "x", accountIds: [] });
    await socialContentApi.aiPlan({ brief: "x", accountIds: [], cadencePerWeek: 1, startDate: "", endDate: "" });
    await socialContentApi.aiRewrite("p1", { action: "rewrite" });
    for (const call of post.mock.calls) expect(call[2]).toEqual({ timeoutMs: AI_REQUEST_TIMEOUT_MS });
  });
});
