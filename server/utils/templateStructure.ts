/**
 * Phase 4 (Templates + Template Parts production enhancement) — formalizes
 * the Template.structure "regions" convention that Phase 1/2 deliberately
 * left as loose JSON (see Template model's doc comment in schema.prisma
 * and templateSchemas.ts's TemplateStructure comment: "the shape should be
 * proven against a real page before being generalized"). This is that
 * generalization — an ORDERED array rather than a plain object, because
 * Postgres JSONB does not guarantee object key order is preserved across
 * writes, which would silently break "reorder regions."
 *
 * Fully backward compatible: a Template written before this phase stored
 * `structure.regions` as `Record<string, string>` (region key -> template
 * part id) — `normalizeRegions` still reads that shape fine, just without
 * a meaningful order (object property order, best-effort). Nothing here
 * requires a migration; it's a JSON-shape convention read/written by the
 * application layer only.
 */
export interface TemplateRegionEntry {
  key: string;
  templatePartId: string | null;
}

interface StructureLike {
  regions?: TemplateRegionEntry[] | Record<string, string | null> | unknown;
  [key: string]: unknown;
}

export function normalizeRegions(structure: unknown): TemplateRegionEntry[] {
  const regions = (structure as StructureLike | null | undefined)?.regions;
  if (!regions) return [];

  if (Array.isArray(regions)) {
    return regions
      .filter((r): r is TemplateRegionEntry => !!r && typeof r === "object" && typeof (r as TemplateRegionEntry).key === "string")
      .map((r) => ({ key: r.key, templatePartId: r.templatePartId ?? null }));
  }

  if (typeof regions === "object") {
    return Object.entries(regions as Record<string, string | null>).map(([key, templatePartId]) => ({ key, templatePartId: templatePartId ?? null }));
  }

  return [];
}

/** Builds the structure patch sent back to the API — always the new ordered-array shape. */
export function buildStructureWithRegions(regions: TemplateRegionEntry[], rest: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...rest, regions };
}
