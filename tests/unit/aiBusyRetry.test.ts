/** A busy AI provider is retried, then a second model is tried; a busy-for-good provider gives a clear message; real errors are not retried. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prisma } from "../../server/db/prisma";
import { run, aiRetryConfig, isTransientAiError, isModelUnavailableError } from "../../server/services/social/socialAiService";
import { CONTENT_PROMPTS } from "../../server/services/contentAiPrompts";
import { AdapterFactory } from "../../server/ai/adapters/adapterFactory";
import { ServiceBusyError } from "../../server/core/errors";
import { resetDb } from "../helpers/db";

const BUSY = new Error('Gemini error: {"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
const ok = { text: '{"a":"fine"}', inputTokens: 1, outputTokens: 1, totalTokens: 2, durationMs: 1, finishReason: "STOP" };

describe("AI busy handling", () => {
  let orgId = "";
  const calls: string[] = [];
  beforeAll(async () => {
    await resetDb();
    orgId = (await prisma.organization.create({ data: { name: "Busy Co", slug: "busy-co" } })).id;
    aiRetryConfig.delayMs = 1;
    aiRetryConfig.deadlineMs = 60_000;
    aiRetryConfig.attemptTimeoutMs = 60;
  });
  afterAll(async () => { aiRetryConfig.delayMs = 1500; aiRetryConfig.deadlineMs = 50_000; aiRetryConfig.attemptTimeoutMs = 22_000; await prisma.organization.deleteMany({ where: { id: orgId } }); vi.restoreAllMocks(); });
  beforeEach(() => { calls.length = 0; vi.restoreAllMocks(); });

  const go = () => run({ caller: { id: null, organizationId: orgId }, def: CONTENT_PROMPTS.product, toolCode: "social_cms_product", variables: { brief: "x" }, schema: z.object({ a: z.string() }), meta: {}, inputSummary: {} });
  const adapter = (behaviour: (model: string, n: number) => unknown) =>
    vi.spyOn(AdapterFactory, "getAdapter").mockReturnValue({
      providerType: "GEMINI",
      generateText: async (p: { modelName: string }) => { calls.push(p.modelName); const r = behaviour(p.modelName, calls.length); if (r instanceof Error) throw r; return r; },
    } as never);

  it("recognises busy and rate-limit errors but not ordinary ones", () => {
    expect(isTransientAiError(BUSY)).toBe(true);
    expect(isTransientAiError(new Error("429 RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isTransientAiError(new Error("API key not valid"))).toBe(false);
  });

  it("retries the same model once when the provider is busy", async () => {
    adapter((_m, n) => (n === 1 ? BUSY : ok));
    expect((await go()).result).toEqual({ a: "fine" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
  });

  it("switches to the current backup model when the first stays busy", async () => {
    adapter((m) => (m === "gemini-3.8-flash" ? ok : BUSY));
    await go();
    expect(calls[calls.length - 1]).toBe("gemini-3.8-flash");
    expect(calls.length).toBe(3);
  });

  it("moves straight to the next model when a model is no longer offered, without retrying it", async () => {
    const GONE = new Error('Gemini error: {"error":{"code":404,"message":"This model models/x is no longer available to new users.","status":"NOT_FOUND"}}');
    expect(isModelUnavailableError(GONE)).toBe(true);
    expect(isModelUnavailableError(BUSY)).toBe(false);
    adapter((m) => (m === "gemini-3.7-flash" ? GONE : ok));
    await go();
    expect(calls).toEqual(["gemini-3.7-flash", "gemini-3.8-flash"]);
  });

  it("explains an unavailable model clearly when no model can answer", async () => {
    adapter(() => new Error('Gemini error: {"error":{"code":404,"status":"NOT_FOUND"}}'));
    const err = await go().catch((e) => e);
    expect(err).toBeInstanceOf(ServiceBusyError);
    expect(err.message).toMatch(/not available right now/i);
    expect(err.message).not.toMatch(/busy/i);
  });

  it("does not retry a real error", async () => {
    adapter(() => new Error("API key not valid"));
    await expect(go()).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("gives a clear, user-safe message when every attempt is busy", async () => {
    adapter(() => BUSY);
    const err = await go().catch((e) => e);
    expect(err).toBeInstanceOf(ServiceBusyError);
    expect(err.exposeMessage).toBe(true);
    expect(err.message).toMatch(/busy right now/i);
    expect(calls).toHaveLength(4);
  });

  it("gives up on a hung attempt and tries the next model instead of waiting for the function to be killed", async () => {
    vi.spyOn(AdapterFactory, "getAdapter").mockReturnValue({
      providerType: "GEMINI",
      generateText: async (p: { modelName: string }) => {
        calls.push(p.modelName);
        if (p.modelName !== "gemini-3.8-flash") return new Promise(() => {}); // never answers
        return ok;
      },
    } as never);
    const t0 = Date.now();
    expect((await go()).result).toEqual({ a: "fine" });
    expect(calls).toEqual(["gemini-3.7-flash", "gemini-3.8-flash"]);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("reports busy (not a gateway timeout) when every model hangs", async () => {
    vi.spyOn(AdapterFactory, "getAdapter").mockReturnValue({ providerType: "GEMINI", generateText: () => new Promise(() => {}) } as never);
    const err = await go().catch((e) => e);
    expect(err).toBeInstanceOf(ServiceBusyError);
    expect(err.message).toMatch(/busy right now/i);
  });
});
