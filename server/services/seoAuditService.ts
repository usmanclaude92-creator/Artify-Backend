/**
 * Rule-based SEO audit (Phase 5 — docs/SEO_ARCHITECTURE.md). Every check
 * here is a plain, explainable rule against real content the org already
 * has — never a fabricated "SEO score" and never anything framed as a
 * Google ranking signal. `canonicalUrl` is deliberately NOT checked: the
 * public site already computes a sane default canonical from the slug
 * when one isn't set (generateBlogPostSeo() in artifysolscom), so an
 * absent canonical isn't actually broken.
 */
import { postRepository } from "../repositories/postRepository";
import { pageRepository } from "../repositories/pageRepository";
import type { SeoMetadataInput } from "../schemas/contentSchemas";

export type SeoIssueSeverity = "critical" | "warning";

export interface SeoIssue {
  resourceType: "post" | "page";
  resourceId: string;
  resourceTitle: string;
  slug: string;
  status: string;
  severity: SeoIssueSeverity;
  code: string;
  message: string;
}

const LIVE_STATUSES = new Set(["PUBLISHED", "SCHEDULED"]);
const META_TITLE_IDEAL_MAX = 60;
const META_DESCRIPTION_IDEAL_MIN = 50;
const META_DESCRIPTION_IDEAL_MAX = 160;
// Mirrors postRepository/pageRepository's own slugify() output exactly — a
// slug that doesn't match this was never produced by this system (e.g.
// imported from elsewhere, or edited directly in the DB) and can break on
// case-sensitive hosting or contain characters that need URL-encoding.
const VALID_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface AuditableRecord {
  id: string;
  slug: string;
  title: string;
  status: string;
  currentRevision: { title: string; metadata: unknown } | null;
  featuredMedia: { altText: string | null } | null;
}

function checkRecord(resourceType: "post" | "page", record: AuditableRecord): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const isLive = LIVE_STATUSES.has(record.status);
  const meta = (record.currentRevision?.metadata ?? {}) as Partial<SeoMetadataInput>;
  const displayTitle = record.currentRevision?.title || record.title;

  function push(severity: SeoIssueSeverity, code: string, message: string) {
    issues.push({ resourceType, resourceId: record.id, resourceTitle: displayTitle, slug: record.slug, status: record.status, severity, code, message });
  }

  if (!meta.metaTitle) {
    push(isLive ? "critical" : "warning", "missing_meta_title", "No SEO title set — search engines will fall back to the content title, which may not be optimized.");
  } else if (meta.metaTitle.length > META_TITLE_IDEAL_MAX) {
    push("warning", "meta_title_too_long", `SEO title is ${meta.metaTitle.length} characters — search engines typically truncate titles beyond ~${META_TITLE_IDEAL_MAX}.`);
  }

  if (!meta.metaDescription) {
    push(isLive ? "critical" : "warning", "missing_meta_description", "No meta description set — search engines will auto-generate a snippet from the page content instead.");
  } else if (meta.metaDescription.length > META_DESCRIPTION_IDEAL_MAX) {
    push("warning", "meta_description_too_long", `Meta description is ${meta.metaDescription.length} characters — likely to be truncated beyond ~${META_DESCRIPTION_IDEAL_MAX}.`);
  } else if (meta.metaDescription.length < META_DESCRIPTION_IDEAL_MIN) {
    push("warning", "meta_description_too_short", `Meta description is only ${meta.metaDescription.length} characters — likely too short to be a useful search-result snippet.`);
  }

  if (record.featuredMedia && !record.featuredMedia.altText) {
    push("warning", "missing_featured_image_alt_text", "Featured image has no alt text — hurts accessibility and image search visibility.");
  }

  if (isLive && !meta.ogImage && !record.featuredMedia) {
    push("warning", "missing_social_image", "No social share image (Open Graph image or featured image) set — links shared on social platforms will show no preview image.");
  }

  if (!VALID_SLUG_PATTERN.test(record.slug)) {
    push("warning", "invalid_slug_format", `Slug "${record.slug}" contains characters outside lowercase letters, numbers, and hyphens — may behave inconsistently across hosting/CDN layers.`);
  }

  return issues;
}

interface DedupableRecord {
  resourceType: "post" | "page";
  id: string;
  slug: string;
  title: string;
  status: string;
  value: string;
}

function findDuplicateField(records: DedupableRecord[], code: string, label: string): SeoIssue[] {
  const byValue = new Map<string, DedupableRecord[]>();
  for (const r of records) {
    const key = r.value.trim().toLowerCase();
    if (!key) continue;
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key)!.push(r);
  }
  const issues: SeoIssue[] = [];
  for (const group of byValue.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      issues.push({
        resourceType: r.resourceType,
        resourceId: r.id,
        resourceTitle: r.title,
        slug: r.slug,
        status: r.status,
        severity: "warning",
        code,
        message: `SEO ${label} is identical to ${group.length - 1} other post/page in this organization — duplicate ${label}s compete with each other in search results.`,
      });
    }
  }
  return issues;
}

export const seoAuditService = {
  async runAudit(organizationId: string): Promise<SeoIssue[]> {
    const [posts, pages] = await Promise.all([postRepository.listForSeoAudit(organizationId), pageRepository.listForSeoAudit(organizationId)]);

    const issues: SeoIssue[] = [];
    const titleIndex: DedupableRecord[] = [];
    const descriptionIndex: DedupableRecord[] = [];

    function indexRecord(resourceType: "post" | "page", record: AuditableRecord) {
      const meta = (record.currentRevision?.metadata ?? {}) as Partial<SeoMetadataInput>;
      const title = record.currentRevision?.title || record.title;
      const base = { resourceType, id: record.id, slug: record.slug, title, status: record.status };
      if (meta.metaTitle) titleIndex.push({ ...base, value: meta.metaTitle });
      if (meta.metaDescription) descriptionIndex.push({ ...base, value: meta.metaDescription });
    }

    for (const post of posts) {
      issues.push(...checkRecord("post", post));
      indexRecord("post", post);
    }
    for (const page of pages) {
      issues.push(...checkRecord("page", page));
      indexRecord("page", page);
    }

    issues.push(...findDuplicateField(titleIndex, "duplicate_meta_title", "title"));
    issues.push(...findDuplicateField(descriptionIndex, "duplicate_meta_description", "description"));

    return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  },
};
