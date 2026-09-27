/**
 * Form management (Phase 9 MVP slice — docs/FORMS_ARCHITECTURE.md).
 * Every method is scoped to the caller's own session organization — never
 * a caller-supplied organizationId, same convention as every domain since
 * Phase 5. Public submission handling (the anonymous write path) lives in
 * publicFormService.ts, not here.
 */
import { formRepository, type FormFilters } from "../repositories/formRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../core/errors";
import type { SanitizedUser } from "../types/domain";
import type { CreateFormInput, UpdateFormInput } from "../schemas/formSchemas";
import type { RequestMeta } from "./authService";
import type { Form } from "@prisma/client";

async function loadFormOrThrow(id: string, organizationId: string): Promise<Form> {
  const form = await formRepository.findByIdInOrg(id, organizationId);
  if (!form) throw new NotFoundError("Form not found.");
  return form;
}

export const formService = {
  async listForms(organizationId: string, filters: FormFilters, page: number, limit: number, sort: string, order: "asc" | "desc") {
    return formRepository.list(organizationId, filters, page, limit, sort, order);
  },

  async getForm(organizationId: string, id: string): Promise<Form> {
    return loadFormOrThrow(id, organizationId);
  },

  async createForm(caller: SanitizedUser, input: CreateFormInput, meta: RequestMeta = {}): Promise<Form> {
    const organizationId = caller.organizationId;

    if (input.slug) {
      const dup = await formRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A form with slug "${input.slug}" already exists.`, { existingFormId: dup.id });
    }
    const slug = input.slug ?? (await formRepository.findUniqueSlugInOrg(organizationId, input.name));

    const form = await formRepository.create({
      organizationId,
      name: input.name,
      slug,
      fields: input.fields,
      successMessage: input.successMessage,
      createdById: caller.id,
    });

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "FORM_CREATED",
      resourceType: "form",
      resourceId: form.id,
      afterData: { name: form.name, slug: form.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return form;
  },

  async updateForm(caller: SanitizedUser, id: string, input: UpdateFormInput, meta: RequestMeta = {}): Promise<Form> {
    const organizationId = caller.organizationId;
    const existing = await loadFormOrThrow(id, organizationId);

    if (input.slug !== undefined && input.slug !== existing.slug) {
      const dup = await formRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A form with slug "${input.slug}" already exists.`, { existingFormId: dup.id });
    }

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.fields !== undefined) patch.fields = input.fields;
    if (input.successMessage !== undefined) patch.successMessage = input.successMessage;
    if (input.status !== undefined) patch.status = input.status;

    const updated = await formRepository.update(id, patch);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "FORM_UPDATED",
      resourceType: "form",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug, status: existing.status },
      afterData: { name: input.name, slug: input.slug, status: input.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return updated;
  },

  async deleteForm(caller: SanitizedUser, id: string, meta: RequestMeta = {}): Promise<void> {
    const organizationId = caller.organizationId;
    await loadFormOrThrow(id, organizationId);
    await formRepository.softDelete(id);

    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "FORM_DELETED",
      resourceType: "form",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });
  },

  async listSubmissions(organizationId: string, formId: string, page: number, limit: number) {
    await loadFormOrThrow(formId, organizationId);
    return formRepository.listSubmissions(formId, organizationId, page, limit);
  },
};
