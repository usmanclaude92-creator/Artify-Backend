/** AI usage/cost records (Phase 12 — docs/AI_USAGE_AND_COSTS.md). Operational metric only, never Phase 10 billing data — see AIUsageRecord's schema.prisma doc comment. */
import { prisma } from "../db/prisma";
import type { Prisma } from "@prisma/client";

export const aiUsageRepository = {
  async record(data: {
    organizationId: string;
    executionId: string;
    providerId?: string;
    modelId?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCost?: Prisma.Decimal | number;
    currency?: string;
  }) {
    return prisma.aIUsageRecord.create({
      data: {
        organizationId: data.organizationId,
        executionId: data.executionId,
        providerId: data.providerId,
        modelId: data.modelId,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.totalTokens,
        estimatedCost: data.estimatedCost,
        currency: data.currency ?? "USD",
      },
    });
  },

  async listForOrg(organizationId: string, dateFrom?: Date, dateTo?: Date) {
    return prisma.aIUsageRecord.findMany({
      where: {
        organizationId,
        ...(dateFrom || dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async summaryForOrg(organizationId: string, dateFrom?: Date, dateTo?: Date) {
    const where = {
      organizationId,
      ...(dateFrom || dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {}),
    };
    const [totals, byModel] = await Promise.all([
      prisma.aIUsageRecord.aggregate({
        where,
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, estimatedCost: true },
        _count: true,
      }),
      prisma.aIUsageRecord.groupBy({
        by: ["modelId"],
        where,
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, estimatedCost: true },
        _count: true,
      }),
    ]);
    return { totals, byModel };
  },
};
