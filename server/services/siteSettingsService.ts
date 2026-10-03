/**
 * Phase 3 (Site Identity + Global Styles) — draft/publish/revert workflow
 * built on the existing `SystemSetting` key/value store (no new table,
 * see siteSettingsSchemas.ts's header comment). Mirrors the
 * mutate-a-draft / explicit-publish / explicit-revert shape Page and
 * Template already use (pageService.ts, templateService.ts), but mapped
 * onto SystemSetting's simpler single-row-per-key primitive via a naming
 * convention instead of a parallel revision table:
 *   - `<key>`       — the PUBLISHED value (what publicSiteService reads).
 *   - `<key>.draft` — the DRAFT value the Control Center UI edits.
 * Publishing copies draft -> published (and keeps draft in sync so the
 * UI's "unsaved changes" state clears). Reverting discards draft edits by
 * resetting draft back to the current published value.
 */
import { systemSettingRepository } from "../repositories/systemSettingRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { assertFeaturedMediaUsable } from "./mediaService";
import { siteIdentitySchema, globalStylesSchema, SITE_IDENTITY_MEDIA_FIELDS, type SiteIdentityInput, type GlobalStylesInput } from "../schemas/siteSettingsSchemas";
import type { SanitizedUser } from "../types/domain";
import type { RequestMeta } from "./authService";
import type { Prisma } from "@prisma/client";

const SITE_IDENTITY_KEY = "site.identity";
const SITE_IDENTITY_DRAFT_KEY = "site.identity.draft";
const GLOBAL_STYLES_KEY = "theme.global_styles";
const GLOBAL_STYLES_DRAFT_KEY = "theme.global_styles.draft";

export interface SettingsGroupState<T> {
  draft: T;
  published: T;
  isDirty: boolean;
  updatedAt: Date | null;
  publishedAt: Date | null;
}

async function loadGroup<T>(
  organizationId: string,
  publishedKey: string,
  draftKey: string,
  schema: { parse: (v: unknown) => T }
): Promise<SettingsGroupState<T>> {
  const [publishedRow, draftRow] = await Promise.all([
    systemSettingRepository.findByKey(organizationId, publishedKey),
    systemSettingRepository.findByKey(organizationId, draftKey),
  ]);
  const published = schema.parse(publishedRow?.value ?? {});
  const draft = schema.parse(draftRow?.value ?? publishedRow?.value ?? {});
  return {
    draft,
    published,
    isDirty: JSON.stringify(draft) !== JSON.stringify(published),
    updatedAt: draftRow?.updatedAt ?? publishedRow?.updatedAt ?? null,
    publishedAt: publishedRow?.updatedAt ?? null,
  };
}

async function saveDraft(organizationId: string, key: string, value: unknown, updatedById: string) {
  return systemSettingRepository.upsert({ organizationId, key, value: value as Prisma.InputJsonValue, type: "JSON", updatedById });
}

/** Re-validates any media fields present in a Site Identity payload — reused at both draft-save and publish time, since a reference valid when drafted could have been archived/deleted since. */
async function assertSiteIdentityMediaUsable(input: SiteIdentityInput, organizationId: string): Promise<void> {
  for (const field of SITE_IDENTITY_MEDIA_FIELDS) {
    const mediaId = input[field];
    if (mediaId) await assertFeaturedMediaUsable(mediaId, organizationId);
  }
}

async function publishGroup<T>(
  caller: SanitizedUser,
  publishedKey: string,
  draftKey: string,
  schema: { parse: (v: unknown) => T },
  revalidate: (value: T) => Promise<void>,
  auditResourceType: string,
  meta: RequestMeta
): Promise<T> {
  const organizationId = caller.organizationId;
  const draftRow = await systemSettingRepository.findByKey(organizationId, draftKey);
  const value = schema.parse(draftRow?.value ?? {});
  await revalidate(value);

  await Promise.all([
    saveDraft(organizationId, publishedKey, value, caller.id),
    saveDraft(organizationId, draftKey, value, caller.id),
  ]);

  await auditLogRepository.record({
    organizationId,
    actorUserId: caller.id,
    actorType: "USER",
    action: "SETTINGS_PUBLISHED",
    resourceType: auditResourceType,
    resourceId: publishedKey,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });

  return value;
}

async function revertGroup<T>(
  caller: SanitizedUser,
  publishedKey: string,
  draftKey: string,
  schema: { parse: (v: unknown) => T },
  auditResourceType: string,
  meta: RequestMeta
): Promise<T> {
  const organizationId = caller.organizationId;
  const publishedRow = await systemSettingRepository.findByKey(organizationId, publishedKey);
  const value = schema.parse(publishedRow?.value ?? {});

  await saveDraft(organizationId, draftKey, value, caller.id);

  await auditLogRepository.record({
    organizationId,
    actorUserId: caller.id,
    actorType: "USER",
    action: "SETTINGS_REVERTED",
    resourceType: auditResourceType,
    resourceId: draftKey,
    ipAddress: meta.ip,
    userAgent: meta.userAgent,
  });

  return value;
}

export const siteSettingsService = {
  async getSiteIdentity(organizationId: string): Promise<SettingsGroupState<SiteIdentityInput>> {
    return loadGroup(organizationId, SITE_IDENTITY_KEY, SITE_IDENTITY_DRAFT_KEY, siteIdentitySchema);
  },

  async getGlobalStyles(organizationId: string): Promise<SettingsGroupState<GlobalStylesInput>> {
    return loadGroup(organizationId, GLOBAL_STYLES_KEY, GLOBAL_STYLES_DRAFT_KEY, globalStylesSchema);
  },

  /** Published-only, single-row reads for publicSiteService — no draft lookup needed for an anonymous public request. */
  async getPublishedSiteIdentity(organizationId: string): Promise<SiteIdentityInput> {
    const row = await systemSettingRepository.findByKey(organizationId, SITE_IDENTITY_KEY);
    return siteIdentitySchema.parse(row?.value ?? {});
  },

  async getPublishedGlobalStyles(organizationId: string): Promise<GlobalStylesInput> {
    const row = await systemSettingRepository.findByKey(organizationId, GLOBAL_STYLES_KEY);
    return globalStylesSchema.parse(row?.value ?? {});
  },

  async saveSiteIdentityDraft(caller: SanitizedUser, input: SiteIdentityInput, meta: RequestMeta = {}): Promise<SiteIdentityInput> {
    const organizationId = caller.organizationId;
    await assertSiteIdentityMediaUsable(input, organizationId);
    await saveDraft(organizationId, SITE_IDENTITY_DRAFT_KEY, input, caller.id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SETTINGS_UPDATED",
      resourceType: "site_identity",
      resourceId: SITE_IDENTITY_DRAFT_KEY,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return input;
  },

  async saveGlobalStylesDraft(caller: SanitizedUser, input: GlobalStylesInput, meta: RequestMeta = {}): Promise<GlobalStylesInput> {
    const organizationId = caller.organizationId;
    await saveDraft(organizationId, GLOBAL_STYLES_DRAFT_KEY, input, caller.id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SETTINGS_UPDATED",
      resourceType: "global_styles",
      resourceId: GLOBAL_STYLES_DRAFT_KEY,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return input;
  },

  async publishSiteIdentity(caller: SanitizedUser, meta: RequestMeta = {}): Promise<SiteIdentityInput> {
    return publishGroup(
      caller,
      SITE_IDENTITY_KEY,
      SITE_IDENTITY_DRAFT_KEY,
      siteIdentitySchema,
      (value) => assertSiteIdentityMediaUsable(value, caller.organizationId),
      "site_identity",
      meta
    );
  },

  async publishGlobalStyles(caller: SanitizedUser, meta: RequestMeta = {}): Promise<GlobalStylesInput> {
    return publishGroup(caller, GLOBAL_STYLES_KEY, GLOBAL_STYLES_DRAFT_KEY, globalStylesSchema, async () => undefined, "global_styles", meta);
  },

  async revertSiteIdentityDraft(caller: SanitizedUser, meta: RequestMeta = {}): Promise<SiteIdentityInput> {
    return revertGroup(caller, SITE_IDENTITY_KEY, SITE_IDENTITY_DRAFT_KEY, siteIdentitySchema, "site_identity", meta);
  },

  async revertGlobalStylesDraft(caller: SanitizedUser, meta: RequestMeta = {}): Promise<GlobalStylesInput> {
    return revertGroup(caller, GLOBAL_STYLES_KEY, GLOBAL_STYLES_DRAFT_KEY, globalStylesSchema, "global_styles", meta);
  },
};
