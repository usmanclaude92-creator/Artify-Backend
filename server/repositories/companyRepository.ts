import type { Company } from "@prisma/client";
import { prisma } from "../db/prisma";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export const companyRepository = {
  async findById(id: string): Promise<Company | null> {
    return prisma.company.findUnique({ where: { id } });
  },

  async findBySlug(slug: string): Promise<Company | null> {
    return prisma.company.findUnique({ where: { slug } });
  },

  async create(data: { name: string; industry?: string }): Promise<Company> {
    const baseSlug = slugify(data.name) || "organization";
    let slug = baseSlug;
    let attempt = 1;
    // Small, bounded retry loop for slug collisions — acceptable at
    // registration volume; revisit if this ever becomes a hot path.
    while (await this.findBySlug(slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }

    return prisma.company.create({
      data: {
        name: data.name,
        slug,
        industry: data.industry,
        tier: "GROWTH",
        status: "TRIAL",
      },
    });
  },
};
