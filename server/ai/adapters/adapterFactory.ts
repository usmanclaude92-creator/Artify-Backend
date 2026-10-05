/**
 * Adapter Factory (Phase 12 — docs/AI_ARCHITECTURE.md).
 * Instantiates provider adapters based on database provider configuration.
 */
import type { AiModelAdapter } from "./types";
import { GeminiAdapter } from "./geminiAdapter";
import { MockAdapter } from "./mockAdapter";
import { config } from "../../config/env";
import { InfrastructureError } from "../../core/errors";

export class AdapterFactory {
  private static mockInstance = new MockAdapter();
  private static geminiInstance: GeminiAdapter | null = null;

  public static getAdapter(providerType: string, apiKey?: string): AiModelAdapter {
    const normalized = (providerType || "GEMINI").toUpperCase();

    if (normalized === "MOCK") {
      return this.mockInstance;
    }

    if (normalized === "GEMINI") {
      const key = apiKey || config.geminiApiKey;
      if (!key || key.length === 0) {
        // Never fabricate AI output outside the test runner.
        if (process.env.NODE_ENV === "test") return this.mockInstance;
        throw new InfrastructureError("AI provider is not configured");
      }
      if (!this.geminiInstance || apiKey) {
        const adapter = new GeminiAdapter(key);
        if (!apiKey) this.geminiInstance = adapter;
        return adapter;
      }
      return this.geminiInstance;
    }

    // Third-party adapters (OPENAI, ANTHROPIC, CUSTOM) are not implemented.
    if (process.env.NODE_ENV === "test") return this.mockInstance;
    throw new InfrastructureError(`AI provider adapter "${normalized}" is not implemented`);
  }
}
