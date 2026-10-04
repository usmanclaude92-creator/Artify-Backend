/** Phase 10 (Products + Services + Solutions) — platform-global industry taxonomy management (Solution <-> Industry tagging). Mirrors productCategoryService.ts exactly. */
import { industryRepository } from "../repositories/industryRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateIndustryInput, UpdateIndustryInput } from "../schemas/industrySchemas";
import type { RequestMeta } from "./authService";
import type { Industry } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadOrThrow(id: string): Promise<Industry> {
  const industry = await industryRepository.findById(id);
  if (!industry) throw new NotFoundError("Industry not found.");
  return industry;
}

export const industryService = {
  async list(search?: string): Promise<Industry[]> {
    return industryRepository.list(search);
  },

  async create(caller: SanitizedUser, input: CreateIndustryInput, meta: RequestMeta = {}): Promise<Industry> {
    let slug: string;
    if (input.slug) {
      const existing = await industryRepository.findBySlug(input.slug);
      if (existing) throw new ConflictError(`An industry with slug "${input.slug}" already exists.`);
      slug = input.slug;
    } else {
      slug = await industryRepository.findUniqueSlug(input.name);
    }

    let industry: Industry;
    try {
      industry = await industryRepository.create({ slug, name: input.name, description: input.description, displayOrder: input.displayOrder });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("An industry with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "INDUSTRY_CREATED",
      resourceType: "industry",
      resourceId: industry.id,
      afterData: { name: industry.name, slug: industry.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return industry;
  },

  async update(caller: SanitizedUser, id: string, input: UpdateIndustryInput, meta: RequestMeta = {}): Promise<Industry> {
    const existing = await loadOrThrow(id);
    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await industryRepository.findBySlug(input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`An industry with slug "${input.slug}" already exists.`);
    }

    let updated: Industry;
    try {
      updated = await industryRepository.update(id, input);
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("An industry with this slug already exists.") : err;
    }

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "INDUSTRY_UPDATED",
      resourceType: "industry",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: input,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async delete(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const existing = await loadOrThrow(id);
    const productCount = await industryRepository.countProducts(id);
    if (productCount > 0) {
      throw new ConflictError(`This industry is tagged on ${productCount} product${productCount === 1 ? "" : "s"} — untag them before deleting it.`);
    }
    await industryRepository.delete(id);

    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "INDUSTRY_DELETED",
      resourceType: "industry",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },
};
