/**
 * Anonymous landing-page API (`/api/v1/public/landing*`). Every response is an explicit projection: no ids of other
 * workspaces, no draft data, no approval/author information. Only the LIVE revision is ever served, except through a
 * valid preview token (working draft, never cached, never indexable).
 */
import { prisma } from "../../db/prisma";
import { config } from "../../config/env";
import { NotFoundError, ValidationError } from "../../core/errors";
import { hashToken } from "../../utils/crypto";
import { projectPublicMedia } from "../publicSiteService";
import { publicFormService } from "../publicFormService";
import type { RequestMeta } from "../authService";
import type { LandingBlock, LandingDocument, PublicLandingSubmitInput } from "../../schemas/landingSchemas";
import { collectLandingMediaIds } from "./landingContent";
import { landingFormSlug } from "./landingForm";
import { landingPath, readDocument, readSeo } from "./landingPageService";

export interface PublicLandingMedia { url: string; alt: string; width: number | null; height: number | null }
export interface PublicLandingPage {
  slug: string;
  title: string;
  seo: { title: string; description: string | null; noindex: boolean; ogImageUrl: string | null };
  blocks: LandingBlock[];
  /** mediaId → resolved public media (ACTIVE + PUBLIC only). Blocks keep their `mediaId`; a missing entry means "render without the image". */
  media: Record<string, PublicLandingMedia>;
  updatedAt: string;
  preview: boolean;
}

export type LandingLookup =
  | { kind: "ok"; page: PublicLandingPage }
  | { kind: "gone" }
  | { kind: "redirect"; toPath: string }
  | { kind: "notfound" };

const orgId = () => config.publicWebsiteOrganizationId;

async function project(
  page: { slug: string; title: string; updatedAt: Date },
  rev: { title: string; editorBlocks: unknown; metadata: unknown; createdAt: Date },
  preview: boolean,
): Promise<PublicLandingPage> {
  const doc: LandingDocument = readDocument({ editorBlocks: rev.editorBlocks } as never);
  const seo = readSeo(rev.metadata);
  const ids = [...collectLandingMediaIds(doc), ...(seo.ogImageMediaId ? [seo.ogImageMediaId] : [])];
  const assets = ids.length ? await prisma.mediaAsset.findMany({ where: { id: { in: ids }, organizationId: orgId() } }) : [];
  const media: Record<string, PublicLandingMedia> = {};
  let ogImageUrl: string | null = null;
  for (const a of assets) {
    const m = await projectPublicMedia(a);
    if (!m) continue;
    media[a.id] = { url: m.url, alt: m.altText ?? "", width: m.width ?? null, height: m.height ?? null };
    if (a.id === seo.ogImageMediaId) ogImageUrl = m.url;
  }
  return {
    slug: page.slug,
    title: rev.title,
    seo: { title: seo.metaTitle || rev.title, description: seo.metaDescription ?? null, noindex: preview ? true : seo.noindex, ogImageUrl },
    blocks: doc.blocks,
    media,
    updatedAt: page.updatedAt.toISOString(),
    preview,
  };
}

export const publicLandingService = {
  isConfigured: () => orgId().length > 0,

  async getBySlug(slug: string): Promise<LandingLookup> {
    if (!orgId()) return { kind: "notfound" };
    const page = await prisma.page.findFirst({ where: { organizationId: orgId(), slug, landingBuilder: true, deletedAt: null } });
    if (!page) {
      // A renamed page leaves a redirect from its old address.
      const redirect = await prisma.redirect.findFirst({ where: { organizationId: orgId(), fromPath: landingPath(slug), isActive: true } });
      if (redirect?.toPath.startsWith("/lp/")) return { kind: "redirect", toPath: redirect.toPath };
      return { kind: "notfound" };
    }
    if (page.status !== "ARCHIVED" && page.landingLiveRevisionId) {
      const rev = await prisma.contentRevision.findUnique({ where: { id: page.landingLiveRevisionId } });
      if (rev) return { kind: "ok", page: await project(page, rev, false) };
    }
    // Existed and was taken offline (or archived after publishing) -> 410. A draft that was never published is simply not found.
    if (page.landingUnpublishedAt || (page.status === "ARCHIVED" && page.publishedAt)) return { kind: "gone" };
    return { kind: "notfound" };
  },

  /** Working draft for a valid, unexpired, unrevoked preview token. The token is only ever compared by hash. */
  async getPreview(token: string): Promise<PublicLandingPage> {
    if (!orgId() || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new NotFoundError("Preview not found.");
    const row = await prisma.landingPreviewToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { page: { include: { currentRevision: true } } } });
    if (!row || row.revokedAt || row.expiresAt <= new Date() || row.page.deletedAt || !row.page.landingBuilder || row.page.organizationId !== orgId() || !row.page.currentRevision) {
      throw new NotFoundError("Preview not found or expired.");
    }
    return project(row.page, row.page.currentRevision, true);
  },

  /** For the sitemap: published AND indexable pages only. */
  async listIndexable(): Promise<Array<{ slug: string; path: string; updatedAt: string }>> {
    if (!orgId()) return [];
    const pages = await prisma.page.findMany({
      where: { organizationId: orgId(), landingBuilder: true, deletedAt: null, status: { not: "ARCHIVED" }, landingLiveRevisionId: { not: null } },
      orderBy: { slug: "asc" }, take: 500,
    });
    if (pages.length === 0) return [];
    const revs = await prisma.contentRevision.findMany({ where: { id: { in: pages.map((p) => p.landingLiveRevisionId!) } }, select: { id: true, metadata: true, publishedAt: true } });
    const byId = new Map(revs.map((r) => [r.id, r]));
    return pages
      .filter((p) => !readSeo(byId.get(p.landingLiveRevisionId!)?.metadata).noindex)
      .map((p) => ({ slug: p.slug, path: landingPath(p.slug), updatedAt: (byId.get(p.landingLiveRevisionId!)?.publishedAt ?? p.updatedAt).toISOString() }));
  },

  /**
   * Lead form submit. Field keys and consent rules come from the LIVE form block (synced into the managed Form), never from the
   * request. First touch / last touch attribution and the page path are recorded server-side on the lead.
   */
  async submit(slug: string, input: PublicLandingSubmitInput, meta: RequestMeta = {}): Promise<{ message: string; redirectUrl: string | null }> {
    if (!orgId()) throw new NotFoundError("Landing page not found.");
    const page = await prisma.page.findFirst({ where: { organizationId: orgId(), slug, landingBuilder: true, deletedAt: null, status: { not: "ARCHIVED" }, landingLiveRevisionId: { not: null } } });
    if (!page) throw new NotFoundError("Landing page not found.");
    const rev = await prisma.contentRevision.findUnique({ where: { id: page.landingLiveRevisionId! } });
    const block = readDocument(rev).blocks.find((b) => b.type === "lp_form");
    if (!block || block.type !== "lp_form") throw new NotFoundError("This page has no form.");

    const allowed = new Set([...block.props.fields.map((f) => f.key), ...(block.props.consent.enabled ? ["consent"] : [])]);
    const unknown = Object.keys(input.data).filter((k) => !allowed.has(k));
    if (unknown.length > 0) throw new ValidationError("The form contains fields that this page does not have.");

    const last = input.lastTouch ?? {};
    const first = input.firstTouch ?? input.lastTouch ?? null;
    const path = landingPath(slug);
    const { successMessage } = await publicFormService.submit(
      landingFormSlug(page.id),
      {
        data: input.data,
        website: input.website,
        utmSource: last.utmSource, utmMedium: last.utmMedium, utmCampaign: last.utmCampaign, utmTerm: last.utmTerm, utmContent: last.utmContent,
        landingPagePath: path,
      },
      meta,
      {
        sourceTag: `landing:${slug}${last.utmSource ? `:${last.utmSource}` : ""}`.slice(0, 120),
        landingPagePath: path,
        referrer: last.referrer || meta.referrer,
        firstTouch: first ? { ...first, landingPath: first.landingPath || path } : null,
        requireConsent: block.props.consent.enabled,
      },
    );
    return { message: successMessage, redirectUrl: block.props.redirectUrl ?? null };
  },
};
