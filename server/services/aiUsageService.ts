/** AI usage/cost read surface (Phase 12 — docs/AI_USAGE_AND_COSTS.md). Read-only — usage records are written by the execution path (server/ai/governance.ts and any future provider-calling code), never edited here. */
import { aiUsageRepository } from "../repositories/aiUsageRepository";

export const aiUsageService = {
  async listUsage(organizationId: string, dateFrom?: Date, dateTo?: Date) {
    return aiUsageRepository.listForOrg(organizationId, dateFrom, dateTo);
  },

  async summary(organizationId: string, dateFrom?: Date, dateTo?: Date) {
    return aiUsageRepository.summaryForOrg(organizationId, dateFrom, dateTo);
  },
};
