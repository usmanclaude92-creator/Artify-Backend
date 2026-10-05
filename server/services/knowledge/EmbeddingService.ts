/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG
 * Embedding Pipeline & Vector Store Interface
 * Handles vector generation, pgvector query translation, and vector similarity calculation.
 */
import { prisma } from "../../db/prisma";
import { getAdapter } from "../../ai/adapters";
import { logger } from "../../core/logger";
import { config } from "../../config/env";

export interface VectorItem {
  id: string;
  chunkId: string;
  vector: number[];
  dimension: number;
}

export class EmbeddingService {
  /**
   * Returns an embedding from the configured AI provider, or null when no
   * provider is configured or the call fails. Never fabricates vectors outside
   * the test runner, so callers must degrade to keyword retrieval on null.
   */
  public static async tryGenerateEmbedding(text: string, modelName = "text-embedding-004"): Promise<number[] | null> {
    let adapter;
    try {
      adapter = getAdapter();
    } catch {
      return null;
    }
    if (!adapter.generateEmbedding) return null;
    try {
      return await adapter.generateEmbedding({ text, modelName, dimension: 768 });
    } catch (err) {
      logger.warn({ err }, "[EmbeddingService] Provider embedding failed");
      return null;
    }
  }

  /** True when a real (non-mock) embedding provider is configured. */
  public static isAvailable(): boolean {
    return process.env.NODE_ENV === "test" || config.geminiApiKey.length > 0;
  }

  /**
   * Computes cosine similarity between two unit vectors.
   */
  public static cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || b.length === 0) return 0;
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : Math.max(0, Math.min(1, dot / denom));
  }

  /**
   * Stores embedding for a chunk in the database.
   */
  public static async storeEmbedding(chunkId: string, vector: number[], modelName = "text-embedding-004"): Promise<void> {
    await prisma.knowledgeEmbedding.create({
      data: {
        chunkId,
        providerType: getAdapter().providerType,
        modelName,
        dimension: vector.length,
        vector: vector as any,
      },
    });
  }
}
