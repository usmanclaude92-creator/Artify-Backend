/**
 * Public form submission (Phase 9 MVP slice — docs/FORMS_ARCHITECTURE.md —
 * extended by Phase 9 full: Forms + Landing Pages + Conversion).
 * Reuses publicLeadService.ts's exact intake pattern rather than being a
 * parallel, CRM-disconnected record: every real (non-honeypot) submission
 * creates or updates a Lead under the single configured
 * `PUBLIC_WEBSITE_ORGANIZATION_ID`, the same way the existing Contact/
 * Brief form already does — this just generalizes it to any
 * Control-Center-authored Form instead of the one hardcoded lead form.
 */
import { formRepository } from "../repositories/formRepository";
import { leadRepository } from "../repositories/leadRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { notificationService } from "./notificationService";
import { config } from "../config/env";
import { InfrastructureError, NotFoundError, ValidationError } from "../core/errors";
import type { PublicFormSubmitInput, FormField } from "../schemas/formSchemas";
import type { RequestMeta } from "./authService";
import type { Form } from "@prisma/client";

const DEFAULT_SUCCESS_MESSAGE = "Thank you — your submission has been received. We'll be in touch shortly.";

/** A field whose visibleWhen condition (if any) isn't met by the submitted data is inactive — never required, regardless of its own `required` flag, since a real visitor never saw it. */
function isFieldActive(field: FormField, data: Record<string, string | string[]>): boolean {
  if (!field.visibleWhen) return true;
  return data[field.visibleWhen.fieldKey] === field.visibleWhen.equals;
}

function valueToDisplay(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function buildNotes(form: Form, fields: FormField[], data: Record<string, string | string[]>, utm: Partial<PublicFormSubmitInput>, consentGiven: boolean | null): string {
  const lines: string[] = [`Submitted via form: ${form.name}`, ""];
  for (const field of fields) {
    const value = data[field.key];
    if (value !== undefined && value !== "") lines.push(`${field.label}: ${valueToDisplay(value)}`);
  }
  if (consentGiven !== null) lines.push("", `Consent to be contacted: ${consentGiven ? "given" : "declined"}.`);
  const utmParts = [
    utm.utmSource && `source=${utm.utmSource}`,
    utm.utmMedium && `medium=${utm.utmMedium}`,
    utm.utmCampaign && `campaign=${utm.utmCampaign}`,
    utm.utmTerm && `term=${utm.utmTerm}`,
    utm.utmContent && `content=${utm.utmContent}`,
  ].filter(Boolean);
  if (utmParts.length > 0) lines.push("", `UTM: ${utmParts.join(", ")}`);
  return lines.join("\n");
}

/** Public-safe field projection — never leaks more than a renderer needs (no internal validation internals beyond what the visitor-facing form itself needs to enforce). */
function projectFormForPublic(form: Form) {
  return {
    id: form.id,
    name: form.name,
    slug: form.slug,
    fields: form.fields,
    successMessage: form.successMessage || DEFAULT_SUCCESS_MESSAGE,
  };
}

async function loadActiveFormOrThrow(where: { id: string } | { slug: string }, organizationId: string): Promise<Form> {
  const form = "id" in where ? await formRepository.findByIdInOrg(where.id, organizationId) : await formRepository.findBySlugInOrg(organizationId, where.slug);
  if (!form || form.status !== "ACTIVE") throw new NotFoundError("Form not found.");
  return form;
}

export const publicFormService = {
  /** Backs the public `GET /public/forms/:slug` (and by-id) read used by the public site's actual form renderer — the Control Center's authoring UI already has its own authenticated read via formService.getForm. */
  async getFormForRender(slugOrId: { slug: string } | { id: string }) {
    const organizationId = config.publicWebsiteOrganizationId;
    if (!organizationId) throw new InfrastructureError("Public form intake is not configured.");
    const form = await loadActiveFormOrThrow(slugOrId, organizationId);
    return projectFormForPublic(form);
  },

  /**
   * A non-empty `website` field (the honeypot) means the caller is almost
   * certainly a bot — still resolves and returns the form's real
   * successMessage (§8's "accepted-but-discarded" contract from
   * publicLeadService), but writes nothing.
   */
  async submit(slug: string, input: PublicFormSubmitInput, meta: RequestMeta = {}): Promise<{ successMessage: string }> {
    const organizationId = config.publicWebsiteOrganizationId;
    if (!organizationId) {
      throw new InfrastructureError("Public form intake is not configured.");
    }

    const form = await formRepository.findBySlugInOrg(organizationId, slug);
    if (!form || form.status !== "ACTIVE") {
      throw new NotFoundError("Form not found.");
    }
    const successMessage = form.successMessage || DEFAULT_SUCCESS_MESSAGE;

    if (input.website) {
      return { successMessage };
    }

    const data = input.data as Record<string, string | string[]>;
    const fields = form.fields as unknown as FormField[];
    let consentGiven: boolean | null = null;

    for (const field of fields) {
      const value = data[field.key];
      const active = isFieldActive(field, data);

      if (field.type === "multiselect") {
        if (value !== undefined && !Array.isArray(value)) throw new ValidationError(`"${field.label}" must be a list of values.`);
      } else if (Array.isArray(value)) {
        throw new ValidationError(`"${field.label}" must be a single value.`);
      }

      if (active && field.required) {
        const isEmpty = value === undefined || (typeof value === "string" ? !value.trim() : value.length === 0);
        if (isEmpty) throw new ValidationError(`"${field.label}" is required.`);
      }

      if (value !== undefined && (field.type === "select" || field.type === "radio") && typeof value === "string" && value) {
        if (!field.options?.some((o) => o.value === value)) throw new ValidationError(`"${field.label}" has an invalid selection.`);
      }
      if (value !== undefined && field.type === "multiselect" && Array.isArray(value)) {
        const allowed = new Set((field.options ?? []).map((o) => o.value));
        if (!value.every((v) => allowed.has(v))) throw new ValidationError(`"${field.label}" has an invalid selection.`);
      }
      if (value !== undefined && field.type === "number" && typeof value === "string" && value.trim()) {
        const n = Number(value);
        if (Number.isNaN(n)) throw new ValidationError(`"${field.label}" must be a number.`);
        if (field.min !== undefined && n < field.min) throw new ValidationError(`"${field.label}" must be at least ${field.min}.`);
        if (field.max !== undefined && n > field.max) throw new ValidationError(`"${field.label}" must be at most ${field.max}.`);
      }
      if (field.type === "checkbox" && field.key === "consent") {
        consentGiven = typeof value === "string" && (value === "true" || value === "on" || value === "yes");
      }
    }

    const emailValue = typeof data.email === "string" ? data.email.trim() || undefined : undefined;
    const nameValue = typeof data.name === "string" ? data.name.trim() || undefined : undefined;
    const companyValue = typeof data.company === "string" ? data.company.trim() || undefined : undefined;
    const phoneValue = typeof data.phone === "string" ? data.phone.trim() || undefined : undefined;
    const sourceTag = `form:${form.slug}${input.utmSource ? `:${input.utmSource}` : ""}`;
    const notes = buildNotes(form, fields, data, input, consentGiven);

    // Duplicate handling: an open (not yet CONVERTED/LOST) Lead with the
    // same email in this org gets this submission folded into it rather
    // than spawning a second, disconnected row for the same person
    // resubmitting (e.g. a "request a demo" form filled twice).
    const attribution = {
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmTerm: input.utmTerm,
      utmContent: input.utmContent,
      landingPagePath: input.landingPagePath,
      referrer: meta.referrer,
      consentGiven: consentGiven ?? undefined,
      formId: form.id,
    };

    let leadId: string;
    if (emailValue) {
      const existingLeads = await leadRepository.findByEmailInOrg(organizationId, emailValue);
      if (existingLeads.length > 0) {
        const existing = existingLeads[0]!;
        const updated = await leadRepository.update(existing.id, {
          contactName: nameValue ?? existing.contactName,
          phone: phoneValue ?? existing.phone,
          source: sourceTag,
          notes: existing.notes ? `${existing.notes}\n\n---\n\n${notes}` : notes,
          ...attribution,
        });
        leadId = updated.id;
      } else {
        const lead = await leadRepository.create({
          organizationId,
          companyName: companyValue || nameValue || emailValue || "Website form submission",
          contactName: nameValue,
          email: emailValue,
          phone: phoneValue,
          source: sourceTag,
          notes,
          ...attribution,
        });
        leadId = lead.id;
      }
    } else {
      const lead = await leadRepository.create({
        organizationId,
        companyName: companyValue || nameValue || "Website form submission",
        contactName: nameValue,
        phone: phoneValue,
        source: sourceTag,
        notes,
        ...attribution,
      });
      leadId = lead.id;
    }

    const submission = await formRepository.createSubmission({
      formId: form.id,
      organizationId,
      data: input.data,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmTerm: input.utmTerm,
      utmContent: input.utmContent,
      leadId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      consentGiven: consentGiven ?? undefined,
      landingPagePath: input.landingPagePath,
      referrer: meta.referrer,
    });

    await auditLogRepository.record({
      organizationId,
      actorType: "SYSTEM",
      actorName: "Public Website",
      action: "FORM_SUBMITTED",
      resourceType: "form_submission",
      resourceId: submission.id,
      afterData: { formId: form.id, formSlug: form.slug, leadId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    // Best-effort in-app notification to whoever this Form is configured
    // to notify — never fails the submission itself (notificationService.
    // notify() already swallows its own errors), and never claims an email
    // was sent (this codebase has no mail transport).
    const notifyUserIds = (form.notifyUserIds as unknown as string[] | null) ?? [];
    for (const userId of notifyUserIds) {
      await notificationService.notify({
        organizationId,
        userId,
        type: "FORM_SUBMITTED",
        title: `New submission: ${form.name}`,
        message: nameValue || emailValue ? `From ${nameValue ?? emailValue}` : "A new form submission was received.",
      });
    }

    return { successMessage };
  },
};
