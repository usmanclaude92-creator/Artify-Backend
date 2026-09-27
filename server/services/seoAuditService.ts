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

  return issues;
}

function findDuplicateTitles(records: { resourceType: "post" | "page"; id: string; slug: string; title: string; status: string; metaTitle: string }[]): SeoIssue[] {
  const byTitle = new Map<string, typeof records>();
  for (const r of records) {
    const key = r.metaTitle.trim().toLowerCase();
    if (!key) continue;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key)!.push(r);
  }
  const issues: SeoIssue[] = [];
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      issues.push({
        resourceType: r.resourceType,
        resourceId: r.id,
        resourceTitle: r.title,
        slug: r.slug,
        status: r.status,
        severity: "warning",
        code: "duplicate_meta_title",
        message: `SEO title is identical to ${group.length - 1} other post/page in this organization — duplicate titles compete with each other in search results.`,
      });
    }
  }
  return issues;
}

export const seoAuditService = {
  async runAudit(organizationId: string): Promise<SeoIssue[]> {
    const [posts, pages] = await Promise.all([postRepository.listForSeoAudit(organizationId), pageRepository.listForSeoAudit(organizationId)]);

    const issues: SeoIssue[] = [];
    const titleIndex: { resourceType: "post" | "page"; id: string; slug: string; title: string; status: string; metaTitle: string }[] = [];

    for (const post of posts) {
      issues.push(...checkRecord("post", post));
      const meta = (post.currentRevision?.metadata ?? {}) as Partial<SeoMetadataInput>;
      if (meta.metaTitle) titleIndex.push({ resourceType: "post", id: post.id, slug: post.slug, title: post.currentRevision?.title || post.title, status: post.status, metaTitle: meta.metaTitle });
    }
    for (const page of pages) {
      issues.push(...checkRecord("page", page));
      const meta = (page.currentRevision?.metadata ?? {}) as Partial<SeoMetadataInput>;
      if (meta.metaTitle) titleIndex.push({ resourceType: "page", id: page.id, slug: page.slug, title: page.currentRevision?.title || page.title, status: page.status, metaTitle: meta.metaTitle });
    }

    issues.push(...findDuplicateTitles(titleIndex));

    return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  },
};
