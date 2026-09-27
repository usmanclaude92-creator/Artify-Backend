/** Redirect management (Phase 5 — docs/SEO_ARCHITECTURE.md). Organization-scoped, mirrors categoryService.ts's shape. */
import { redirectRepository } from "../repositories/redirectRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateRedirectInput, UpdateRedirectInput } from "../schemas/redirectSchemas";
import type { RequestMeta } from "./authService";
import type { Redirect } from "@prisma/client";

function isUniqueConstraintError(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

async function loadRedirectOrThrow(id: string, organizationId: string): Promise<Redirect> {
  const redirect = await redirectRepository.findByIdInOrg(id, organizationId);
  if (!redirect) throw new NotFoundError("Redirect not found.");
  return redirect;
}

export const redirectService = {
  async listRedirects(
    organizationId: string,
    filters: { search?: string },
    page: number,
    limit: number,
    sort: string,
    order: "asc" | "desc"
  ): Promise<{ rows: Redirect[]; total: number }> {
    return redirectRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getRedirect(organizationId: string, id: string): Promise<Redirect> {
    return loadRedirectOrThrow(id, organizationId);
  },

  async createRedirect(caller: SanitizedUser, input: CreateRedirectInput, meta: RequestMeta = {}): Promise<Redirect> {
    const organizationId = caller.organizationId;
    const dup = await redirectRepository.findByFromPathInOrg(organizationId, input.fromPath);
    if (dup) throw new ConflictError(`A redirect from "${input.fromPath}" already exists.`, { existingRedirectId: dup.id });

    let redirect: Redirect;
    try {
      redirect = await redirectRepository.create({
        organizationId,
        fromPath: input.fromPath,
        toPath: input.toPath,
        statusCode: input.statusCode,
        createdById: caller.id,
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A redirect from this path already exists.") : err;
    }

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "REDIRECT_CREATED",
      resourceType: "redirect",
      resourceId: redirect.id,
      afterData: { fromPath: redirect.fromPath, toPath: redirect.toPath, statusCode: redirect.statusCode },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return redirect;
  },

  async updateRedirect(caller: SanitizedUser, id: string, input: UpdateRedirectInput, meta: RequestMeta = {}): Promise<Redirect> {
    const organizationId = caller.organizationId;
    const existing = await loadRedirectOrThrow(id, organizationId);

    const patch: Record<string, unknown> = {};
    if (input.toPath !== undefined) patch.toPath = input.toPath;
    if (input.statusCode !== undefined) patch.statusCode = input.statusCode;

    const updated = await redirectRepository.update(id, patch);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "REDIRECT_UPDATED",
      resourceType: "redirect",
      resourceId: id,
      beforeData: { toPath: existing.toPath, statusCode: existing.statusCode },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async deleteRedirect(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    const existing = await loadRedirectOrThrow(id, organizationId);

    await redirectRepository.delete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "REDIRECT_DELETED",
      resourceType: "redirect",
      resourceId: id,
      beforeData: { fromPath: existing.fromPath, toPath: existing.toPath },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  /**
   * Called by postService/pageService when a live (ever-published) piece
   * of content's slug changes. Auto-created redirects are attributed to
   * SYSTEM in the audit log (the caller already gets a POST_UPDATED/
   * PAGE_UPDATED entry for the slug change itself) and chain-collapse: if
   * some other redirect already pointed at the old path, it's repointed
   * straight at the new one instead of hopping through a dead link.
   */
  async autoRedirectOnSlugChange(params: {
    organizationId: string;
    fromPath: string;
    toPath: string;
    resourceType: "post" | "page";
    resourceId: string;
  }): Promise<void> {
    if (params.fromPath === params.toPath) return;
    await redirectRepository.upsertForResource(params);
    await redirectRepository.repointChainedRedirects(params.organizationId, params.fromPath, params.toPath);
  },
};
