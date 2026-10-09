/**
 * Landing page management (Step 12, docs/MARKETING_LANDING_PAGES.md). Landing pages are CMS `Page` rows (`landingBuilder = true`) with
 * `ContentRevision` history; this service owns their lifecycle so the generic CMS endpoints never touch them.
 *
 * Revisions: `Page.currentRevisionId` is the WORKING draft; `Page.landingLiveRevisionId` is what the public site serves. Editing a live page
 * therefore never changes the live page: it clones a new DRAFT revision, which goes live only when an approver approves it
 * (landingApprovalService). Unpublish clears the live pointer and stamps `landingUnpublishedAt` so the public URL answers 410.
 */
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Page, ContentRevision } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { config } from "../../config/env";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { redirectService } from "../redirectService";
import { assertFeaturedMediaUsable } from "../mediaService";
import { hashToken } from "../../utils/crypto";
import {
  landingDocumentSchema, type LandingDocument, type LandingSeoInput, type LandingTemplateKey,
} from "../../schemas/landingSchemas";
import { collectLandingMediaIds, flattenLandingText, isReservedLandingSlug, landingPublishIssues, type PublishIssue } from "./landingContent";
import { buildTemplateDocument, LANDING_TEMPLATES } from "./landingTemplates";
import { syncLandingForm } from "./landingForm";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";

export type LandingStatus = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";

type PageWithRev = Page & { currentRevision: ContentRevision | null };

export const landingPath = (slug: string) => `/lp/${slug}`;
export const landingPublicUrl = (slug: string): string | null => (config.publicSiteBaseUrl ? `${config.publicSiteBaseUrl.replace(/\/+$/, "")}${landingPath(slug)}` : null);

const hasPermission = (u: SanitizedUser, key: string) => u.role.key === "SUPER_ADMIN" || u.role.permissions.includes(key);

/** SEO stored in `ContentRevision.metadata`. Builder-owned shape (not the strict generic SEO schema). */
interface StoredSeo { metaTitle?: string; metaDescription?: string; ogImageMediaId?: string | null; robotsDirective?: string }
export function readSeo(metadata: unknown): { metaTitle?: string; metaDescription?: string; ogImageMediaId: string | null; noindex: boolean } {
  const m = (metadata && typeof metadata === "object" ? metadata : {}) as StoredSeo;
  return { metaTitle: m.metaTitle, metaDescription: m.metaDescription, ogImageMediaId: m.ogImageMediaId ?? null, noindex: (m.robotsDirective ?? "").startsWith("noindex") };
}
const writeSeo = (seo: ReturnType<typeof readSeo>): Prisma.InputJsonValue => ({
  ...(seo.metaTitle ? { metaTitle: seo.metaTitle } : {}), ...(seo.metaDescription ? { metaDescription: seo.metaDescription } : {}), ...(seo.ogImageMediaId ? { ogImageMediaId: seo.ogImageMediaId } : {}),
  robotsDirective: seo.noindex ? "noindex, nofollow" : "index, follow",
});

export function readDocument(rev: Pick<ContentRevision, "editorBlocks"> | null): LandingDocument {
  const parsed = landingDocumentSchema.safeParse(rev?.editorBlocks ?? { version: 1, blocks: [] });
  return parsed.success ? parsed.data : ({ version: 1, blocks: [] } as LandingDocument);
}

export function deriveStatus(page: Pick<Page, "status" | "landingLiveRevisionId" | "landingUnpublishedAt">): LandingStatus {
  if (page.status === "ARCHIVED") return "ARCHIVED";
  if (page.landingLiveRevisionId) return "PUBLISHED";
  if (page.status === "IN_REVIEW") return "IN_REVIEW";
  return page.landingUnpublishedAt ? "UNPUBLISHED" : "DRAFT";
}

function slugifyTitle(title: string): string {
  const base = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return base.length >= 3 ? base : "landing-page";
}

async function assertSlugAvailable(organizationId: string, slug: string, selfId?: string): Promise<void> {
  if (isReservedLandingSlug(slug)) throw new ValidationError(`"${slug}" is a reserved address and cannot be used for a landing page.`);
  const dup = await prisma.page.findFirst({ where: { organizationId, slug }, select: { id: true } }); // includes soft-deleted pages: their address stays claimed (410)
  if (dup && dup.id !== selfId) throw new ConflictError(`The address "${slug}" is already used by another page.`);
}

async function uniqueSlug(organizationId: string, title: string): Promise<string> {
  const base = slugifyTitle(title);
  for (let n = 1; n < 200; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (isReservedLandingSlug(candidate)) continue;
    if (!(await prisma.page.findFirst({ where: { organizationId, slug: candidate }, select: { id: true } }))) return candidate;
  }
  throw new ConflictError("Could not find a free address; choose one manually.");
}

export async function assertMediaUsable(doc: LandingDocument, organizationId: string): Promise<void> {
  for (const id of collectLandingMediaIds(doc)) {
    try {
      await assertFeaturedMediaUsable(id, organizationId);
    } catch (err) {
      throw new ValidationError(`An image in the page is not usable: ${(err as Error).message.replace("featuredMediaId", "the image")}`);
    }
  }
}

async function loadPage(organizationId: string, id: string): Promise<PageWithRev> {
  const page = await prisma.page.findFirst({ where: { id, organizationId, deletedAt: null, landingBuilder: true }, include: { currentRevision: true } });
  if (!page) throw new NotFoundError("Landing page not found.");
  return page;
}

export const pendingApprovalFor = (organizationId: string, pageId: string) =>
  prisma.automationApproval.findFirst({ where: { organizationId, entityType: "landing_page", entityId: pageId, status: "PENDING" }, select: { id: true, requestedAt: true, requesterId: true } });

async function audit(caller: SanitizedUser | null, organizationId: string, action: string, pageId: string, meta: RequestMeta, extra: Record<string, unknown> = {}) {
  await auditLogRepository.record({
    organizationId, actorUserId: caller?.id, actorType: caller ? "USER" : "SYSTEM", action, resourceType: "landing_page", resourceId: pageId, afterData: extra,
    ipAddress: meta.ip, userAgent: meta.userAgent,
  });
}

/** The editor's view of a page: everything needed to render the builder, and nothing from other workspaces. */
async function toView(page: PageWithRev) {
  const rev = page.currentRevision;
  const document = readDocument(rev);
  const seo = readSeo(rev?.metadata);
  const status = deriveStatus(page);
  const pending = await pendingApprovalFor(page.organizationId, page.id);
  const live = page.landingLiveRevisionId ? await prisma.contentRevision.findUnique({ where: { id: page.landingLiveRevisionId }, select: { id: true, version: true, publishedAt: true } }) : null;
  const issues: PublishIssue[] = landingPublishIssues({ title: rev?.title ?? page.title, document: rev?.editorBlocks ?? { version: 1, blocks: [] }, seo });
  return {
    id: page.id, title: page.title, slug: page.slug, status, templateKey: page.landingTemplateKey, document, seo,
    version: rev?.version ?? 1, updatedAt: page.updatedAt, createdAt: page.createdAt, publishedAt: page.publishedAt, unpublishedAt: page.landingUnpublishedAt,
    live: live ? { revisionId: live.id, version: live.version, publishedAt: live.publishedAt } : null,
    hasUnpublishedChanges: !!live && page.currentRevisionId !== live.id,
    pendingApproval: pending ? { id: pending.id, requestedAt: pending.requestedAt } : null,
    publishIssues: issues, canPublishNow: issues.length === 0,
    path: landingPath(page.slug), publicUrl: status === "PUBLISHED" ? landingPublicUrl(page.slug) : null,
  };
}

export const landingPageService = {
  templates: () => LANDING_TEMPLATES,

  async list(caller: SanitizedUser, q: { page: number; limit: number; search?: string; status?: LandingStatus }) {
    const where: Prisma.PageWhereInput = {
      organizationId: caller.organizationId, landingBuilder: true, deletedAt: null,
      ...(q.search ? { OR: [{ title: { contains: q.search, mode: "insensitive" } }, { slug: { contains: q.search, mode: "insensitive" } }] } : {}),
      ...(q.status === "ARCHIVED" ? { status: "ARCHIVED" }
        : q.status === "PUBLISHED" ? { status: { not: "ARCHIVED" }, landingLiveRevisionId: { not: null } }
        : q.status === "IN_REVIEW" ? { status: "IN_REVIEW", landingLiveRevisionId: null }
        : q.status === "UNPUBLISHED" ? { status: "DRAFT", landingLiveRevisionId: null, landingUnpublishedAt: { not: null } }
        : q.status === "DRAFT" ? { status: "DRAFT", landingLiveRevisionId: null, landingUnpublishedAt: null } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.page.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (q.page - 1) * q.limit, take: q.limit, include: { currentRevision: { select: { version: true, metadata: true } } } }),
      prisma.page.count({ where }),
    ]);
    const pendingIds = new Set((await prisma.automationApproval.findMany({ where: { organizationId: caller.organizationId, entityType: "landing_page", status: "PENDING", entityId: { in: rows.map((r) => r.id) } }, select: { entityId: true } })).map((a) => a.entityId));
    return {
      rows: rows.map((p) => ({
        id: p.id, title: p.title, slug: p.slug, status: deriveStatus(p), path: landingPath(p.slug), templateKey: p.landingTemplateKey, updatedAt: p.updatedAt, publishedAt: p.publishedAt,
        hasUnpublishedChanges: !!p.landingLiveRevisionId && p.currentRevisionId !== p.landingLiveRevisionId, pendingApproval: pendingIds.has(p.id), version: p.currentRevision?.version ?? 1,
        noindex: readSeo(p.currentRevision?.metadata).noindex,
      })),
      total, page: q.page, limit: q.limit,
    };
  },

  async get(caller: SanitizedUser, id: string) {
    return toView(await loadPage(caller.organizationId, id));
  },

  async create(caller: SanitizedUser, input: { title: string; slug?: string; templateKey: LandingTemplateKey }, meta: RequestMeta = {}) {
    const organizationId = caller.organizationId;
    const slug = input.slug ?? (await uniqueSlug(organizationId, input.title));
    if (input.slug) await assertSlugAvailable(organizationId, slug);
    const doc = landingDocumentSchema.parse(buildTemplateDocument(input.templateKey));
    const pageId = await prisma.$transaction(async (tx) => {
      const page = await tx.page.create({ data: { organizationId, slug, title: input.title, status: "DRAFT", createdById: caller.id, pageType: "LANDING", landingBuilder: true, landingTemplateKey: input.templateKey } });
      const rev = await tx.contentRevision.create({
        data: { pageId: page.id, version: 1, status: "DRAFT", title: input.title, body: flattenLandingText(doc), metadata: writeSeo({ ogImageMediaId: null, noindex: false }), editorBlocks: doc as unknown as Prisma.InputJsonValue, createdById: caller.id },
      });
      await tx.page.update({ where: { id: page.id }, data: { currentRevisionId: rev.id } });
      return page.id;
    });
    await audit(caller, organizationId, "LANDING_PAGE_CREATED", pageId, meta, { slug, templateKey: input.templateKey });
    return toView(await loadPage(organizationId, pageId));
  },

  async update(caller: SanitizedUser, id: string, input: { title?: string; slug?: string; document?: LandingDocument; seo?: LandingSeoInput; expectedUpdatedAt?: Date }, meta: RequestMeta = {}) {
    const organizationId = caller.organizationId;
    const page = await loadPage(organizationId, id);
    if (page.status === "ARCHIVED") throw new ConflictError("An archived landing page must be restored before it can be edited.");
    if (await pendingApprovalFor(organizationId, id)) throw new ConflictError("This page is waiting for approval. Withdraw the request to edit it.");
    if (input.expectedUpdatedAt && page.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) throw new ConflictError("This page was changed by someone else. Reload to see the latest version.");
    const rev = page.currentRevision;
    if (!rev) throw new ConflictError("This page has no revision to edit.");

    // Address change: live pages need publish rights (it changes the public URL at once) and leave a redirect behind.
    let slugPatch: string | undefined;
    if (input.slug !== undefined && input.slug !== page.slug) {
      await assertSlugAvailable(organizationId, input.slug, id);
      if (page.landingLiveRevisionId && !hasPermission(caller, "marketing.landing.publish")) throw new AuthorizationError("Changing the address of a live page needs publish permission.");
      slugPatch = input.slug;
    }
    if (input.document) await assertMediaUsable(input.document, organizationId);
    if (input.seo?.ogImageMediaId) await assertFeaturedMediaUsable(input.seo.ogImageMediaId, organizationId).catch((e: Error) => { throw new ValidationError(`The social image is not usable: ${e.message.replace("featuredMediaId", "the image")}`); });

    const seoNow = readSeo(rev.metadata);
    const seoNext = input.seo
      ? { metaTitle: input.seo.metaTitle !== undefined ? input.seo.metaTitle || undefined : seoNow.metaTitle, metaDescription: input.seo.metaDescription !== undefined ? input.seo.metaDescription || undefined : seoNow.metaDescription,
          ogImageMediaId: input.seo.ogImageMediaId !== undefined ? input.seo.ogImageMediaId : seoNow.ogImageMediaId, noindex: input.seo.noindex ?? seoNow.noindex }
      : seoNow;
    const title = input.title ?? rev.title;
    const doc = input.document ?? readDocument(rev);
    const fork = rev.id === page.landingLiveRevisionId || rev.status === "PUBLISHED";

    await prisma.$transaction(async (tx) => {
      let currentRevisionId = page.currentRevisionId;
      const data = { title, body: flattenLandingText(doc), metadata: writeSeo(seoNext), editorBlocks: doc as unknown as Prisma.InputJsonValue };
      if (fork) {
        const last = await tx.contentRevision.findFirst({ where: { pageId: id }, orderBy: { version: "desc" }, select: { version: true } });
        const created = await tx.contentRevision.create({ data: { ...data, pageId: id, version: (last?.version ?? rev.version) + 1, status: "DRAFT", createdById: caller.id } });
        currentRevisionId = created.id;
      } else {
        await tx.contentRevision.update({ where: { id: rev.id }, data });
      }
      await tx.page.update({ where: { id }, data: { title, currentRevisionId, ...(slugPatch ? { slug: slugPatch } : {}) } });
    });

    if (slugPatch && page.publishedAt) {
      await redirectService.autoRedirectOnSlugChange({ organizationId, fromPath: landingPath(page.slug), toPath: landingPath(slugPatch), resourceType: "landing_page", resourceId: id });
    }
    await audit(caller, organizationId, "LANDING_PAGE_UPDATED", id, meta, { fields: Object.keys(input).filter((k) => k !== "expectedUpdatedAt"), slugChanged: !!slugPatch, forkedRevision: fork });
    return toView(await loadPage(organizationId, id));
  },

  async listRevisions(caller: SanitizedUser, id: string) {
    const page = await loadPage(caller.organizationId, id);
    const rows = await prisma.contentRevision.findMany({ where: { pageId: id }, orderBy: { version: "desc" }, take: 100, include: { createdBy: { select: { firstName: true, lastName: true } } } });
    return rows.map((r) => ({
      id: r.id, version: r.version, title: r.title, createdAt: r.createdAt, publishedAt: r.publishedAt, createdBy: r.createdBy ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim() : null,
      isCurrent: r.id === page.currentRevisionId, isLive: r.id === page.landingLiveRevisionId, blocks: readDocument(r).blocks.length,
    }));
  },

  /** Restore = clone an earlier revision into a NEW working draft (history is append-only); it goes live only through approval. */
  async restoreRevision(caller: SanitizedUser, id: string, revisionId: string, meta: RequestMeta = {}) {
    const organizationId = caller.organizationId;
    const page = await loadPage(organizationId, id);
    if (page.status === "ARCHIVED") throw new ConflictError("An archived landing page must be restored first.");
    if (await pendingApprovalFor(organizationId, id)) throw new ConflictError("This page is waiting for approval. Withdraw the request first.");
    const target = await prisma.contentRevision.findFirst({ where: { id: revisionId, pageId: id } });
    if (!target) throw new NotFoundError("Revision not found.");
    await prisma.$transaction(async (tx) => {
      const last = await tx.contentRevision.findFirst({ where: { pageId: id }, orderBy: { version: "desc" }, select: { version: true } });
      const created = await tx.contentRevision.create({
        data: { pageId: id, version: (last?.version ?? 0) + 1, status: "DRAFT", title: target.title, body: target.body, excerpt: target.excerpt, metadata: (target.metadata ?? {}) as Prisma.InputJsonValue, editorBlocks: (target.editorBlocks ?? undefined) as Prisma.InputJsonValue | undefined, createdById: caller.id },
      });
      await tx.page.update({ where: { id }, data: { currentRevisionId: created.id, title: target.title } });
    });
    await audit(caller, organizationId, "LANDING_PAGE_REVISION_RESTORED", id, meta, { fromVersion: target.version });
    return toView(await loadPage(organizationId, id));
  },

  /** Takes a live page offline at once (the address then answers 410). Needs publish permission. The draft stays; going live again needs approval. */
  async unpublish(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    const organizationId = caller.organizationId;
    const page = await loadPage(organizationId, id);
    if (!page.landingLiveRevisionId) throw new ConflictError("This page is not live.");
    await prisma.page.update({ where: { id }, data: { status: "DRAFT", landingLiveRevisionId: null, landingUnpublishedAt: new Date() } });
    await syncLandingForm(page, null, false);
    await audit(caller, organizationId, "LANDING_PAGE_UNPUBLISHED", id, meta, { slug: page.slug });
    return toView(await loadPage(organizationId, id));
  },

  async archive(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    const organizationId = caller.organizationId;
    const page = await loadPage(organizationId, id);
    if (page.status === "ARCHIVED") throw new ConflictError("This page is already archived.");
    const wasLive = !!page.landingLiveRevisionId;
    if (wasLive && !hasPermission(caller, "marketing.landing.publish")) throw new AuthorizationError("Archiving a live page needs publish permission.");
    await prisma.automationApproval.updateMany({ where: { organizationId, entityType: "landing_page", entityId: id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), decisionReason: "Page archived" } });
    await prisma.page.update({ where: { id }, data: { status: "ARCHIVED", landingLiveRevisionId: null, ...(wasLive || page.publishedAt ? { landingUnpublishedAt: new Date() } : {}) } });
    await syncLandingForm(page, null, false);
    await audit(caller, organizationId, "LANDING_PAGE_ARCHIVED", id, meta, { wasLive });
    return toView(await loadPage(organizationId, id));
  },

  async unarchive(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    const organizationId = caller.organizationId;
    const page = await loadPage(organizationId, id);
    if (page.status !== "ARCHIVED") throw new ConflictError("This page is not archived.");
    await prisma.page.update({ where: { id }, data: { status: "DRAFT" } });
    await audit(caller, organizationId, "LANDING_PAGE_UNARCHIVED", id, meta);
    return toView(await loadPage(organizationId, id));
  },

  /** A private link to the exact public rendering of the WORKING draft. Only a hash is stored; the raw token is returned once. */
  async createPreview(caller: SanitizedUser, id: string, ttlHours: number, meta: RequestMeta = {}) {
    const organizationId = caller.organizationId;
    await loadPage(organizationId, id);
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
    await prisma.landingPreviewToken.create({ data: { pageId: id, tokenHash: hashToken(token), expiresAt, createdById: caller.id } });
    await audit(caller, organizationId, "LANDING_PAGE_PREVIEW_CREATED", id, meta, { expiresAt });
    const base = config.publicSiteBaseUrl ? config.publicSiteBaseUrl.replace(/\/+$/, "") : null;
    return { token, expiresAt, url: base ? `${base}/lp-preview/${token}` : null, path: `/lp-preview/${token}` };
  },

  async revokePreviews(caller: SanitizedUser, id: string, meta: RequestMeta = {}) {
    await loadPage(caller.organizationId, id);
    const res = await prisma.landingPreviewToken.updateMany({ where: { pageId: id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
    await audit(caller, caller.organizationId, "LANDING_PAGE_PREVIEWS_REVOKED", id, meta, { count: res.count });
    return { revoked: res.count };
  },

  /** `https://<site>/lp/<slug>?utm_*` for Composer posts: only for a LIVE page, with validated parameters. `url` is null when PUBLIC_SITE_BASE_URL is not configured (the relative `path` is always returned). */
  async utmLink(caller: SanitizedUser, id: string, p: { source: string; medium: string; campaign: string; term?: string; content?: string }) {
    const page = await loadPage(caller.organizationId, id);
    if (!page.landingLiveRevisionId) throw new ConflictError("Only a live landing page can be linked. Publish it first.");
    const base = landingPublicUrl(page.slug);
    const q = new URLSearchParams({ utm_source: p.source, utm_medium: p.medium, utm_campaign: p.campaign });
    if (p.term) q.set("utm_term", p.term);
    if (p.content) q.set("utm_content", p.content);
    return { url: base ? `${base}?${q.toString()}` : null, path: `${landingPath(page.slug)}?${q.toString()}` };
  },

  /** Live pages for pickers (Composer UTM helper): slug, title, address. Nothing else. */
  async listLive(caller: SanitizedUser) {
    const rows = await prisma.page.findMany({ where: { organizationId: caller.organizationId, landingBuilder: true, deletedAt: null, landingLiveRevisionId: { not: null }, status: { not: "ARCHIVED" } }, orderBy: { title: "asc" }, take: 100, select: { id: true, title: true, slug: true } });
    return rows.map((r) => ({ ...r, path: landingPath(r.slug), url: landingPublicUrl(r.slug) }));
  },

  /** For the approval flow. */
  loadPage,
  toView,
};
