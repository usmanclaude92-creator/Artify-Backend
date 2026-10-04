/**
 * Form/FormSubmission data access (Phase 9 MVP slice — docs/FORMS_ARCHITECTURE.md).
 * Organization-scoped, same findByIdInOrg-only convention as every other
 * repository since Phase 5.
 */
import type { Form, FormSubmission, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface FormFilters {
  search?: string;
  status?: string;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 150);
}

function buildWhere(organizationId: string, filters: FormFilters): Prisma.FormWhereInput {
  const where: Prisma.FormWhereInput = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status as Prisma.EnumFormStatusFilter["equals"];
  if (filters.search) where.name = { contains: filters.search, mode: "insensitive" };
  return where;
}

export const formRepository = {
  async list(organizationId: string, filters: FormFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.form.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.form.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string): Promise<Form | null> {
    return prisma.form.findFirst({ where: { id, organizationId, deletedAt: null } });
  },

  async findBySlugInOrg(organizationId: string, slug: string): Promise<Form | null> {
    return prisma.form.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },

  async findUniqueSlugInOrg(organizationId: string, base: string): Promise<string> {
    const baseSlug = slugify(base) || "form";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },

  async create(data: {
    organizationId: string;
    name: string;
    slug: string;
    fields: Prisma.InputJsonValue;
    successMessage?: string;
    notifyUserIds?: Prisma.InputJsonValue;
    createdById?: string;
  }): Promise<Form> {
    return prisma.form.create({ data });
  },

  async update(id: string, data: Prisma.FormUpdateInput): Promise<Form> {
    return prisma.form.update({ where: { id }, data });
  },

  async softDelete(id: string): Promise<void> {
    await prisma.form.update({ where: { id }, data: { deletedAt: new Date() } });
  },

  async countSubmissions(formId: string): Promise<number> {
    return prisma.formSubmission.count({ where: { formId } });
  },

  async listSubmissions(formId: string, organizationId: string, page: number, limit: number): Promise<{ rows: FormSubmission[]; total: number }> {
    const where: Prisma.FormSubmissionWhereInput = { formId, organizationId };
    const [rows, total] = await Promise.all([
      prisma.formSubmission.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.formSubmission.count({ where }),
    ]);
    return { rows, total };
  },

  async createSubmission(data: {
    formId: string;
    organizationId: string;
    data: Prisma.InputJsonValue;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
    leadId?: string;
    ipAddress?: string;
    userAgent?: string;
    consentGiven?: boolean;
    landingPagePath?: string;
    referrer?: string;
    campaignId?: string;
  }): Promise<FormSubmission> {
    return prisma.formSubmission.create({ data });
  },

  /** Phase 14 — marketing dashboard: real form counts, never fabricated. */
  async countForDashboard(organizationId: string): Promise<{ total: number; active: number }> {
    const [total, active] = await Promise.all([
      prisma.form.count({ where: { organizationId, deletedAt: null } }),
      prisma.form.count({ where: { organizationId, deletedAt: null, status: "ACTIVE" } }),
    ]);
    return { total, active };
  },

  /** Phase 15 — form performance reporting: real submission counts within a date range (never fabricated). */
  async countSubmissionsInRange(organizationId: string, range: { from: Date; to: Date }): Promise<number> {
    return prisma.formSubmission.count({ where: { organizationId, createdAt: { gte: range.from, lte: range.to } } });
  },
};
