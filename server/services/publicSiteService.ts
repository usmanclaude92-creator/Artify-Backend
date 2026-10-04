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
import { productRepository } from "../repositories/productRepository";
import { navigationMenuRepository } from "../repositories/navigationMenuRepository";
import { redirectRepository } from "../repositories/redirectRepository";
import { mediaRepository } from "../repositories/mediaRepository";
import { templatePartRepository } from "../repositories/templatePartRepository";
import { normalizeRegions } from "../utils/templateStructure";
import type { MenuItemInput } from "../schemas/navigationMenuSchemas";
import { siteSettingsService } from "./siteSettingsService";
import { SITE_IDENTITY_MEDIA_FIELDS } from "../schemas/siteSettingsSchemas";
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
 *
 * Phase 4 — adds a fully resolved `regions` map alongside the existing raw
 * `structure` field (kept verbatim for backward compatibility): each
 * region's assigned Template Part is resolved to its own PUBLISHED
 * content, with the exact same two-level "PUBLISHED template part +
 * PUBLISHED revision" safety check applied recursively (a region pointing
 * at a draft/archived/deleted part is silently omitted — never a broken
 * reference, never draft content leaking to an anonymous caller). This is
 * "Page -> assigned template -> template parts -> editor content" from
 * the public side; Global Styles are deliberately NOT duplicated in here —
 * a consumer fetches /public/site-settings once and applies the same
 * tokens everywhere, rather than this payload re-embedding them per page.
 */
async function projectPageTemplate(page: PageWithPublicRelations) {
  const template = page.template;
  if (!template || template.status !== "PUBLISHED") return null;
  const revision = template.currentRevision;
  if (!revision || revision.status !== "PUBLISHED") return null;

  const regionEntries = normalizeRegions(revision.structure);
  const organizationId = page.organizationId;
  const regions = await Promise.all(
    regionEntries.map(async (r) => {
      if (!r.templatePartId) return [r.key, null] as const;
      const part = await templatePartRepository.findByIdInOrg(r.templatePartId, organizationId);
      if (!part || part.status !== "PUBLISHED" || !part.currentRevision || part.currentRevision.status !== "PUBLISHED") {
        return [r.key, null] as const;
      }
      return [r.key, { type: part.type, slug: part.slug, content: part.currentRevision.content as Record<string, unknown> }] as const;
    })
  );

  return { type: template.type, slug: template.slug, structure: revision.structure, regions: Object.fromEntries(regions) };
}

/**
 * Phase 9 (Forms + Landing Pages + Conversion) — the public block
 * renderer has no authenticated media-read path (unlike the Control
 * Center's own Site Editor, which fetches signed read URLs per image via
 * mediaApi), and there is no public-by-id media endpoint to add one
 * without risking leaking arbitrary internal media. So every `mediaId`/
 * `avatarMediaId` an editorBlocks tree references is resolved here,
 * server-side, to the same public-safe projection (ACTIVE + PUBLIC only)
 * every other public media reference already uses — the public response
 * carries a real `resolvedUrl` next to the id, never the id alone.
 */
async function resolveBlockMedia(block: Record<string, unknown>, organizationId: string): Promise<Record<string, unknown>> {
  const props = { ...(block.props as Record<string, unknown>) };
  if (block.type === "image" && typeof props.mediaId === "string" && props.mediaId) {
    const media = await mediaRepository.findByIdInOrg(props.mediaId, organizationId);
    const projected = await projectPublicMedia(media);
    props.resolvedUrl = projected?.url ?? null;
  }
  if (block.type === "testimonial" && typeof props.avatarMediaId === "string" && props.avatarMediaId) {
    const media = await mediaRepository.findByIdInOrg(props.avatarMediaId, organizationId);
    const projected = await projectPublicMedia(media);
    props.resolvedAvatarUrl = projected?.url ?? null;
  }
  const next: Record<string, unknown> = { ...block, props };
  if (Array.isArray(block.children)) {
    next.children = await Promise.all((block.children as Record<string, unknown>[]).map((c) => resolveBlockMedia(c, organizationId)));
  }
  return next;
}

// Phase 2 (Site Editor) — additive, same backward-compatible pattern as
// `template` above: a page with no editor composition (the overwhelming
// majority of existing pages) gets `editorBlocks: null` exactly as
// before, and the public renderer's safe fallback (render `body` HTML) is
// unaffected. Only a page whose current revision has a genuinely saved
// block document gets a non-null value here — never partial/unsaved
// editor state, since this reads the same persisted revision `body` does.
async function projectPageEditorBlocks(revision: PageWithPublicRelations["currentRevision"], organizationId: string): Promise<Record<string, unknown> | null> {
  const blocks = revision?.editorBlocks as Record<string, unknown> | null | undefined;
  if (!blocks || !Array.isArray(blocks.blocks) || blocks.blocks.length === 0) return null;
  const resolvedBlocks = await Promise.all((blocks.blocks as Record<string, unknown>[]).map((b) => resolveBlockMedia(b, organizationId)));
  return { ...blocks, blocks: resolvedBlocks };
}

/**
 * Phase 8 (Advanced SEO Control Center) — global -> content SEO
 * precedence: a post/page's own metaTitle/metaDescription/ogImage always
 * wins; only a field left genuinely unset falls back to the
 * organization-wide defaults configured on Site Identity (Phase 3's
 * defaultMetaTitle/defaultMetaDescription/socialImageMediaId). Without
 * this, those Site Identity fields were dead config for every post/page —
 * set in the Control Center but never actually read by anything serving
 * individual content. The featured image (if any) still outranks the
 * site-wide social image, exactly like the explicit-ogImage case.
 */
async function applySeoDefaults(seo: Record<string, unknown>, organizationId: string, hasFeaturedMedia: boolean): Promise<Record<string, unknown>> {
  if (seo.metaTitle && seo.metaDescription && (seo.ogImage || hasFeaturedMedia)) return seo;
  const identity = await siteSettingsService.getPublishedSiteIdentity(organizationId);
  const result = { ...seo };
  if (!result.metaTitle && identity.defaultMetaTitle) result.metaTitle = identity.defaultMetaTitle;
  if (!result.metaDescription && identity.defaultMetaDescription) result.metaDescription = identity.defaultMetaDescription;
  if (!result.ogImage && !hasFeaturedMedia && identity.socialImageMediaId) {
    const media = await mediaRepository.findByIdInOrg(identity.socialImageMediaId, organizationId);
    const projected = await projectPublicMedia(media);
    if (projected) result.ogImage = projected.url;
  }
  return result;
}

async function projectPage(page: PageWithPublicRelations) {
  const revision = page.currentRevision;
  const featuredMedia = await projectPublicMedia(page.featuredMedia);
  return {
    slug: page.slug,
    title: page.title,
    body: revision?.body ?? "",
    excerpt: revision?.excerpt ?? null,
    editorBlocks: await projectPageEditorBlocks(revision, page.organizationId),
    seo: await applySeoDefaults((revision?.metadata as Record<string, unknown> | undefined) ?? {}, page.organizationId, !!featuredMedia),
    featuredMedia,
    pageType: page.pageType,
    isHomepage: page.isHomepage,
    template: await projectPageTemplate(page),
    publishedAt: page.publishedAt,
    updatedAt: page.updatedAt,
  };
}

export interface PublicMenuItem {
  label: string;
  url: string;
  openInNewTab: boolean;
  children: PublicMenuItem[];
}

/**
 * Phase 5 — resolves a navigation menu item's link target to a real URL,
 * same "safe handling of broken links" requirement as the Template region
 * resolution above: an item whose target no longer resolves (unpublished/
 * deleted/cross-org) is silently dropped, never surfaced as a broken
 * link or a thrown error. `custom` links pass their URL through verbatim
 * (already required present by navigationMenuSchemas.ts).
 */
async function resolveMenuItem(item: MenuItemInput, organizationId: string): Promise<PublicMenuItem | null> {
  let url: string | null = null;
  switch (item.linkType) {
    case "custom":
      url = item.url ?? null;
      break;
    case "page": {
      const page = item.targetId ? await pageRepository.findPublishedByIdInOrg(item.targetId, organizationId) : null;
      url = page ? `/${page.slug}` : null;
      break;
    }
    case "post": {
      const post = item.targetId ? await postRepository.findPublishedByIdInOrg(item.targetId, organizationId) : null;
      url = post ? `/blog/${post.slug}` : null;
      break;
    }
    case "category": {
      const category = item.targetId ? await categoryRepository.findByIdInOrg(item.targetId, organizationId) : null;
      url = category ? `/blog?category=${category.slug}` : null;
      break;
    }
    case "tag": {
      const tag = item.targetId ? await tagRepository.findByIdInOrg(item.targetId, organizationId) : null;
      url = tag ? `/blog?tag=${tag.slug}` : null;
      break;
    }
    case "product": {
      const product = item.targetId ? await productRepository.findById(item.targetId) : null;
      url = product && product.status === "ACTIVE" ? `/ai-solutions/${product.slug}` : null;
      break;
    }
  }

  if (!url) return null;

  const children = (
    await Promise.all((item.children ?? []).map((child) => resolveMenuItem(child, organizationId)))
  ).filter((c): c is PublicMenuItem => c !== null);

  return { label: item.label, url, openInNewTab: item.openInNewTab, children };
}

function projectAuthor(author: PostWithPublicRelations["author"]) {
  if (!author) return null;
  return { name: `${author.user.firstName} ${author.user.lastName}`.trim(), bio: author.bio, avatarUrl: author.avatarUrl };
}

async function projectPost(post: PostWithPublicRelations) {
  const revision = post.currentRevision;
  const featuredMedia = await projectPublicMedia(post.featuredMedia);
  return {
    slug: post.slug,
    title: post.title,
    body: revision?.body ?? "",
    excerpt: revision?.excerpt ?? null,
    seo: await applySeoDefaults((revision?.metadata as Record<string, unknown> | undefined) ?? {}, post.organizationId, !!featuredMedia),
    category: post.category ? { slug: post.category.slug, name: post.category.name } : null,
    tags: post.tags.map((t) => ({ slug: t.tag.slug, name: t.tag.name })),
    author: projectAuthor(post.author),
    featuredMedia,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
  };
}

/**
 * Phase 3 (Site Identity) — resolves each `*MediaId` reference to the same
 * public-safe projection (`url`/`altText`/`caption`/dimensions, ACTIVE +
 * PUBLIC only) every other public media field already uses, rather than
 * leaking an internal MediaAsset id to an anonymous caller.
 */
async function projectSiteIdentityMedia(
  identity: Awaited<ReturnType<typeof siteSettingsService.getPublishedSiteIdentity>>,
  organizationId: string
): Promise<Record<(typeof SITE_IDENTITY_MEDIA_FIELDS)[number], PublicMedia | null>> {
  const entries = await Promise.all(
    SITE_IDENTITY_MEDIA_FIELDS.map(async (field) => {
      const mediaId = identity[field];
      if (!mediaId) return [field, null] as const;
      const media = await mediaRepository.findByIdInOrg(mediaId, organizationId);
      return [field, await projectPublicMedia(media)] as const;
    })
  );
  return Object.fromEntries(entries) as Record<(typeof SITE_IDENTITY_MEDIA_FIELDS)[number], PublicMedia | null>;
}

export const publicSiteService = {
  isConfigured: hasPublicWebsiteOrganization,

  /**
   * Phase 3 (Site Identity + Global Styles) — published-only, resolved for
   * safe anonymous consumption. Returns `null` when no public org is
   * configured (same "not yet set up" signal every other method here uses,
   * per `/public/site`'s `configured` flag) — never partial/fabricated
   * data. A freshly-configured organization that has never published
   * anything still gets a complete object: the schema's own defaults
   * (siteSettingsSchemas.ts) are the current artifysolscom values, so the
   * public site sees no change until something is genuinely published.
   */
  async getSiteSettings() {
    if (!hasPublicWebsiteOrganization()) return null;
    const organizationId = config.publicWebsiteOrganizationId;
    const [identity, globalStyles] = await Promise.all([
      siteSettingsService.getPublishedSiteIdentity(organizationId),
      siteSettingsService.getPublishedGlobalStyles(organizationId),
    ]);
    const media = await projectSiteIdentityMedia(identity, organizationId);
    const {
      logoMediaId: _logoMediaId,
      logoDarkMediaId: _logoDarkMediaId,
      logoMobileMediaId: _logoMobileMediaId,
      faviconMediaId: _faviconMediaId,
      socialImageMediaId: _socialImageMediaId,
      ...rest
    } = identity;
    return {
      identity: {
        ...rest,
        logo: media.logoMediaId,
        logoDark: media.logoDarkMediaId,
        logoMobile: media.logoMobileMediaId,
        favicon: media.faviconMediaId,
        socialImage: media.socialImageMediaId,
      },
      globalStyles,
    };
  },

  async getPageBySlug(slug: string) {
    if (!hasPublicWebsiteOrganization()) throw new NotFoundError("Page not found.");
    const page = await pageRepository.findPublishedBySlugWithMedia(config.publicWebsiteOrganizationId, slug);
    if (!page) throw new NotFoundError("Page not found.");
    return projectPage(page);
  },

  /**
   * Phase 5 — "Homepage resolves dynamically." Returns `null` (never an
   * error) when no public org is configured OR no page is currently
   * designated as the homepage OR that page isn't PUBLISHED — a caller
   * (artifysolscom) is expected to fall back to its own existing static
   * homepage in every one of those cases, exactly the same safe-fallback
   * contract `template`/`editorBlocks` already use elsewhere in this file.
   * This is what "prevent accidental blank/broken homepage" means on the
   * public side: resolution can never produce a broken page, only "not
   * configured yet."
   */
  async getHomepage() {
    if (!hasPublicWebsiteOrganization()) return null;
    const page = await pageRepository.findPublishedHomepageWithMedia(config.publicWebsiteOrganizationId);
    if (!page) return null;
    return projectPage(page);
  },

  /**
   * Phase 5 — the org's active (most recently published) menu for a given
   * location (PRIMARY/HEADER/FOOTER/MOBILE/CUSTOM), with every item's link
   * target resolved to a real URL and broken ones silently dropped. Returns
   * `null` when none is configured/published — same safe-fallback contract
   * as getHomepage above.
   */
  async getNavigationMenu(type: string) {
    if (!hasPublicWebsiteOrganization()) return null;
    const organizationId = config.publicWebsiteOrganizationId;
    const menu = await navigationMenuRepository.findPublishedByTypeInOrg(organizationId, type);
    if (!menu || !menu.currentRevision || menu.currentRevision.status !== "PUBLISHED") return null;

    const rawItems = Array.isArray(menu.currentRevision.items) ? (menu.currentRevision.items as unknown as MenuItemInput[]) : [];
    const items = (await Promise.all(rawItems.map((item) => resolveMenuItem(item, organizationId)))).filter((i): i is PublicMenuItem => i !== null);

    return { type: menu.type, slug: menu.slug, name: menu.name, items };
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
    if (!redirect || !redirect.isActive) return null;
    return { toPath: redirect.toPath, statusCode: redirect.statusCode };
  },
};
