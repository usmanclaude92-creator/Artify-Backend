/**
 * Public website CMS projection (Phase 11 — docs/PUBLIC_API_ARCHITECTURE.md,
 * docs/PUBLIC_WEBSITE_ARCHITECTURE.md). Read-only, unauthenticated. Every
 * method here resolves the single configured `PUBLIC_WEBSITE_ORGANIZATION_ID`
 * (never a caller-supplied organizationId) and returns only PUBLISHED
 * content, projected down to public-safe fields — no internal ids beyond
 * the resource's own id/slug, no author user account details beyond a
 * display name/avatar/bio, no storage keys/buckets, no draft/revision
 * history, no audit metadata.
 */
import { pageRepository, type PageWithPublicRelations } from "../repositories/pageRepository";
import { postRepository, type PostWithPublicRelations } from "../repositories/postRepository";
import { categoryRepository } from "../repositories/categoryRepository";
import { tagRepository } from "../repositories/tagRepository";
import { redirectRepository } from "../repositories/redirectRepository";
import { getStorageProvider } from "../storage";
import { config } from "../config/env";
import { NotFoundError } from "../core/errors";
import type { MediaAsset } from "@prisma/client";

export interface PublicMedia {
  url: string;
  altText: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
}

/**
 * The only public media projection this codebase exposes: `ACTIVE` +
 * `PUBLIC` visibility only (§9). A `PRIVATE` or non-`ACTIVE` featured
 * image is treated as "no featured image" for a public caller, never
 * surfaced as an error or a broken link. Storage key/bucket/provider,
 * organizationId, and uploader are never included.
 */
async function projectPublicMedia(media: MediaAsset | null): Promise<PublicMedia | null> {
  if (!media || media.status !== "ACTIVE" || media.visibility !== "PUBLIC") return null;
  const provider = getStorageProvider();
  // Prefer a stable, non-expiring URL. This matters specifically here (as
  // opposed to the Control Center's own interactive media previews, which
  // legitimately want a short-lived signed URL): this URL is embedded in
  // og:image, JSON-LD, and the sitemap, none of which get refreshed on any
  // schedule a 15-minute (or even 24-hour) signed URL could keep up with —
  // a social crawler or search engine can fetch it hours or days later.
  const url = provider.getPublicUrl(media.storageKey) ??
    (await provider.createSignedReadUrl({ key: media.storageKey, expiresInSeconds: config.mediaPublicSignedUrlTtlSeconds }));
  return { url, altText: media.altText, caption: media.caption, width: media.width, height: media.height };
}

function hasPublicWebsiteOrganization(): boolean {
  return config.publicWebsiteOrganizationId.length > 0;
}

/**
 * Phase 1 (Website module) — `template` is null unless a genuinely
 * PUBLISHED template is assigned and its own current revision is
 * PUBLISHED too (an archived or draft-forked template is treated as "no
 * template," never surfaced as broken). This is the safe, backward-
 * compatible rendering strategy required by
 * docs/control-center-public-site-integration.md: existing pages
 * (templateId null) are completely unaffected, and artifysolscom does not
 * yet consume this field — this only makes it available for the future
 * Site Editor / template-driven renderer to read, without changing how
 * any page renders today.
 */
function projectPageTemplate(page: PageWithPublicRelations) {
  const template = page.template;
  if (!template || template.status !== "PUBLISHED") return null;
  const revision = template.currentRevision;
  if (!revision || revision.status !== "PUBLISHED") return null;
  return { type: template.type, slug: template.slug, structure: revision.structure as Record<string, unknown> };
}

// Phase 2 (Site Editor) — additive, same backward-compatible pattern as
// `template` above: a page with no editor composition (the overwhelming
// majority of existing pages) gets `editorBlocks: null` exactly as
// before, and the public renderer's safe fallback (render `body` HTML) is
// unaffected. Only a page whose current revision has a genuinely saved
// block document gets a non-null value here — never partial/unsaved
// editor state, since this reads the same persisted revision `body` does.
function projectPageEditorBlocks(revision: PageWithPublicRelations["currentRevision"]): Record<string, unknown> | null {
  const blocks = revision?.editorBlocks as Record<string, unknown> | null | undefined;
  if (!blocks || !Array.isArray(blocks.blocks) || blocks.blocks.length === 0) return null;
  return blocks;
}

async function projectPage(page: PageWithPublicRelations) {
  const revision = page.currentRevision;
  return {
    slug: page.slug,
    title: page.title,
    body: revision?.body ?? "",
    editorBlocks: projectPageEditorBlocks(revision),
    seo: (revision?.metadata as Record<string, unknown> | undefined) ?? {},
    featuredMedia: await projectPublicMedia(page.featuredMedia),
    pageType: page.pageType,
    isHomepage: page.isHomepage,
    template: projectPageTemplate(page),
    publishedAt: page.publishedAt,
    updatedAt: page.updatedAt,
  };
}

function projectAuthor(author: PostWithPublicRelations["author"]) {
  if (!author) return null;
  return { name: `${author.user.firstName} ${author.user.lastName}`.trim(), bio: author.bio, avatarUrl: author.avatarUrl };
}

async function projectPost(post: PostWithPublicRelations) {
  const revision = post.currentRevision;
  return {
    slug: post.slug,
    title: post.title,
    body: revision?.body ?? "",
    seo: (revision?.metadata as Record<string, unknown> | undefined) ?? {},
    category: post.category ? { slug: post.category.slug, name: post.category.name } : null,
    tags: post.tags.map((t) => ({ slug: t.tag.slug, name: t.tag.name })),
    author: projectAuthor(post.author),
    featuredMedia: await projectPublicMedia(post.featuredMedia),
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
  };
}

export const publicSiteService = {
  isConfigured: hasPublicWebsiteOrganization,

  async getPageBySlug(slug: string) {
    if (!hasPublicWebsiteOrganization()) throw new NotFoundError("Page not found.");
    const page = await pageRepository.findPublishedBySlugWithMedia(config.publicWebsiteOrganizationId, slug);
    if (!page) throw new NotFoundError("Page not found.");
    return projectPage(page);
  },

  async listPosts(filters: { search?: string; categorySlug?: string; tagSlug?: string }, page: number, limit: number, sort: string, order: "asc" | "desc") {
    if (!hasPublicWebsiteOrganization()) return { rows: [], total: 0 };
    const organizationId = config.publicWebsiteOrganizationId;

    let categoryId: string | undefined;
    if (filters.categorySlug) {
      const category = await categoryRepository.findBySlugInOrg(organizationId, filters.categorySlug);
      if (!category) return { rows: [], total: 0 };
      categoryId = category.id;
    }
    let tagId: string | undefined;
    if (filters.tagSlug) {
      const tag = await tagRepository.findBySlugInOrg(organizationId, filters.tagSlug);
      if (!tag) return { rows: [], total: 0 };
      tagId = tag.id;
    }

    const { rows, total } = await postRepository.listPublished(organizationId, { search: filters.search, categoryId, tagId }, page, limit, sort, order);
    return { rows: await Promise.all(rows.map(projectPost)), total };
  },

  async getPostBySlug(slug: string) {
    if (!hasPublicWebsiteOrganization()) throw new NotFoundError("Post not found.");
    const post = await postRepository.findPublishedBySlugWithMedia(config.publicWebsiteOrganizationId, slug);
    if (!post) throw new NotFoundError("Post not found.");
    return projectPost(post);
  },

  async listCategories() {
    if (!hasPublicWebsiteOrganization()) return [];
    const categories = await categoryRepository.list(config.publicWebsiteOrganizationId);
    return categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description }));
  },

  async listTags() {
    if (!hasPublicWebsiteOrganization()) return [];
    const tags = await tagRepository.list(config.publicWebsiteOrganizationId);
    return tags.map((t) => ({ slug: t.slug, name: t.name }));
  },

  /**
   * Phase 5 — called by the public site when a slug it's rendering (e.g.
   * `/blog/old-slug`) 404s, before it shows a hard not-found page. Returns
   * null rather than throwing on a miss — "no redirect exists" is not an
   * error, it's the common case.
   */
  async getRedirectForPath(path: string): Promise<{ toPath: string; statusCode: number } | null> {
    if (!hasPublicWebsiteOrganization()) return null;
    const redirect = await redirectRepository.findByFromPathInOrg(config.publicWebsiteOrganizationId, path);
    if (!redirect) return null;
    return { toPath: redirect.toPath, statusCode: redirect.statusCode };
  },
};
