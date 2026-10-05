/**
 * AI usage limits (Phase 18). Per-organization daily caps stored in the
 * existing `system_settings` table; enforced from real CopilotUsage rows.
 * A limit of 0 / unset means unlimited.
 */
import { z } from "zod";
import { prisma } from "../db/prisma";
import { RateLimitError } from "../core/errors";
import { systemSettingRepository } from "../repositories/systemSettingRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";

export const AI_LIMITS_KEY = "ai.limits";

export const aiLimitsSchema = z.object({
  dailyRequests: z.number().int().min(0).max(10_000_000),
  dailyTokens: z.number().int().min(0).max(1_000_000_000),
});
export type AiLimits = z.infer<typeof aiLimitsSchema>;

const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

export const aiQuotaService = {
  async getLimits(organizationId: string): Promise<AiLimits> {
    const row = await systemSettingRepository.findByKey(organizationId, AI_LIMITS_KEY);
    const parsed = aiLimitsSchema.safeParse(row?.value);
    return parsed.success ? parsed.data : { dailyRequests: 0, dailyTokens: 0 };
  },

  async setLimits(organizationId: string, actorUserId: string, limits: AiLimits, meta: { ip?: string; userAgent?: string } = {}) {
    const before = await this.getLimits(organizationId);
    await systemSettingRepository.upsert({
      organizationId,
      key: AI_LIMITS_KEY,
      value: limits,
      type: "JSON",
      description: "AI usage limits (0 = unlimited)",
      updatedById: actorUserId,
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId,
      actorType: "USER",
      action: "AI_LIMITS_UPDATED",
      resourceType: "ai_limits",
      beforeData: before,
      afterData: limits,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
    return limits;
  },

  async usageToday(organizationId: string) {
    const agg = await prisma.copilotUsage.aggregate({
      where: { organizationId, createdAt: { gte: startOfUtcDay() }, status: "SUCCESS" },
      _count: { _all: true },
      _sum: { totalTokens: true },
    });
    return { requests: agg._count._all, tokens: agg._sum.totalTokens ?? 0 };
  },

  /** Throws RateLimitError (429) when today's org-wide usage has reached a configured cap. */
  async assertWithinLimits(organizationId: string): Promise<void> {
    const limits = await this.getLimits(organizationId);
    if (!limits.dailyRequests && !limits.dailyTokens) return;
    const used = await this.usageToday(organizationId);
    if (limits.dailyRequests && used.requests >= limits.dailyRequests) {
      throw new RateLimitError("Daily AI request limit reached for this organization.");
    }
    if (limits.dailyTokens && used.tokens >= limits.dailyTokens) {
      throw new RateLimitError("Daily AI token limit reached for this organization.");
    }
  },
};
