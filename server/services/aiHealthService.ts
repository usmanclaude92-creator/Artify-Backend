/**
 * AI Control Center health snapshot (Phase 18). Every number is an aggregate of
 * real rows (CopilotUsage, AIExecution, AIUsageRecord, Knowledge*) scoped to the
 * caller's organization. Configuration is reported as booleans only — secret
 * values are never read into the response. Connectivity is never probed or
 * assumed: "configured" means credentials are present, nothing more.
 */
import { prisma } from "../db/prisma";
import { config } from "../config/env";
import { aiQuotaService } from "./aiQuotaService";
import { EmbeddingService } from "./knowledge/EmbeddingService";

const DAY = 24 * 60 * 60 * 1000;

export const aiHealthService = {
  async snapshot(organizationId: string) {
    const now = Date.now();
    const since30 = new Date(now - 30 * DAY);
    const since24 = new Date(now - DAY);

    const hasKey = config.geminiApiKey.length > 0;
    const providerEnabled = config.aiProvider === "gemini";
    const configured = providerEnabled && hasKey;

    const [
      providers,
      copilot30,
      copilotFailed30,
      copilot24,
      byModel,
      execByStatus,
      recentExecFailures,
      recentCopilot,
      usageRecordAgg,
      docsByStatus,
      chunkCount,
      embeddingCount,
      failedJobs,
      limits,
      today,
    ] = await Promise.all([
      prisma.aIProvider.findMany({ include: { models: { select: { id: true, isActive: true } } }, orderBy: { code: "asc" } }),
      prisma.copilotUsage.aggregate({
        where: { organizationId, createdAt: { gte: since30 }, status: "SUCCESS" },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, estimatedCost: true },
        _avg: { durationMs: true },
      }),
      prisma.copilotUsage.count({ where: { organizationId, createdAt: { gte: since30 }, status: { not: "SUCCESS" } } }),
      prisma.copilotUsage.count({ where: { organizationId, createdAt: { gte: since24 } } }),
      prisma.copilotUsage.groupBy({
        by: ["providerType", "modelName"],
        where: { organizationId, createdAt: { gte: since30 }, status: "SUCCESS" },
        _count: { _all: true },
        _sum: { totalTokens: true },
      }),
      prisma.aIExecution.groupBy({ by: ["status"], where: { organizationId, startedAt: { gte: since30 } }, _count: { _all: true } }),
      prisma.aIExecution.findMany({
        where: { organizationId, status: "FAILED" },
        orderBy: { startedAt: "desc" },
        take: 5,
        select: { id: true, errorCategory: true, errorMessage: true, startedAt: true },
      }),
      prisma.copilotUsage.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, providerType: true, modelName: true, totalTokens: true, durationMs: true, status: true, createdAt: true },
      }),
      prisma.aIUsageRecord.aggregate({
        where: { organizationId, createdAt: { gte: since30 } },
        _count: { _all: true },
        _sum: { totalTokens: true, estimatedCost: true },
      }),
      prisma.knowledgeDocument.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
      prisma.knowledgeChunk.count({ where: { organizationId } }),
      prisma.knowledgeEmbedding.count({ where: { chunk: { organizationId } } }),
      prisma.knowledgeIngestionJob.count({ where: { organizationId, status: "FAILED" } }),
      aiQuotaService.getLimits(organizationId),
      aiQuotaService.usageToday(organizationId),
    ]);

    const embeddingsAvailable = EmbeddingService.isAvailable();

    return {
      generatedAt: new Date(now).toISOString(),
      provider: {
        active: config.aiProvider,
        configured,
        state: configured ? "CONFIGURED" : providerEnabled ? "NOT_CONFIGURED_KEY_MISSING" : "DISABLED",
        label: configured ? "Configured (credentials present, connectivity not probed)" : "Not configured",
        defaultModel: configured ? "gemini-3.7-flash" : null,
        embeddingsAvailable,
        capabilities: {
          textGeneration: configured,
          structuredOutput: configured,
          embeddings: embeddingsAvailable,
          copilot: configured,
          knowledgeSemanticSearch: embeddingsAvailable,
          knowledgeKeywordSearch: true,
        },
      },
      catalog: providers.map((p) => ({
        code: p.code,
        name: p.name,
        status: p.status,
        isDefault: p.isDefault,
        models: p.models.length,
        activeModels: p.models.filter((m) => m.isActive).length,
      })),
      usage: {
        window: "30d",
        copilotRequests: copilot30._count._all,
        copilotFailures: copilotFailed30,
        copilotRequests24h: copilot24,
        inputTokens: copilot30._sum.inputTokens ?? 0,
        outputTokens: copilot30._sum.outputTokens ?? 0,
        totalTokens: copilot30._sum.totalTokens ?? 0,
        estimatedCost: Number(copilot30._sum.estimatedCost ?? 0),
        avgLatencyMs: copilot30._avg.durationMs ? Math.round(copilot30._avg.durationMs) : null,
        byModel: byModel.map((m) => ({ provider: m.providerType, model: m.modelName, requests: m._count._all, tokens: m._sum.totalTokens ?? 0 })),
        governedExecutions: execByStatus.map((e) => ({ status: e.status, count: e._count._all })),
        governedUsage: { records: usageRecordAgg._count._all, tokens: usageRecordAgg._sum.totalTokens ?? 0, estimatedCost: Number(usageRecordAgg._sum.estimatedCost ?? 0) },
      },
      limits: { ...limits, usedToday: today },
      recentActivity: recentCopilot,
      recentErrors: recentExecFailures.map((e) => ({ id: e.id, category: e.errorCategory, message: (e.errorMessage ?? "").slice(0, 200), at: e.startedAt })),
      knowledge: {
        documents: docsByStatus.map((d) => ({ status: d.status, count: d._count._all })),
        chunks: chunkCount,
        embeddedChunks: embeddingCount,
        failedIngestionJobs: failedJobs,
        retrievalMode: embeddingsAvailable ? "HYBRID" : "KEYWORD_ONLY",
      },
    };
  },
};
