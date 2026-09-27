/**
 * Public form submission (Phase 9 MVP slice — docs/FORMS_ARCHITECTURE.md).
 * Reuses publicLeadService.ts's exact intake pattern rather than being a
 * parallel, CRM-disconnected record: every real (non-honeypot) submission
 * creates a Lead under the single configured
 * `PUBLIC_WEBSITE_ORGANIZATION_ID`, the same way the existing Contact/
 * Brief form already does — this just generalizes it to any
 * Control-Center-authored Form instead of the one hardcoded lead form.
 */
import { formRepository } from "../repositories/formRepository";
import { leadRepository } from "../repositories/leadRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { config } from "../config/env";
import { InfrastructureError, NotFoundError, ValidationError } from "../core/errors";
import type { PublicFormSubmitInput, FormField } from "../schemas/formSchemas";
import type { RequestMeta } from "./authService";
import type { Form } from "@prisma/client";

const DEFAULT_SUCCESS_MESSAGE = "Thank you — your submission has been received. We'll be in touch shortly.";

function buildNotes(form: Form, fields: FormField[], data: Record<string, string>, utm: Partial<PublicFormSubmitInput>): string {
  const lines: string[] = [`Submitted via form: ${form.name}`, ""];
  for (const field of fields) {
    const value = data[field.key];
    if (value) lines.push(`${field.label}: ${value}`);
  }
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

export const publicFormService = {
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

    const fields = form.fields as unknown as FormField[];
    for (const field of fields) {
      const value = input.data[field.key];
      if (field.required && (!value || !value.trim())) {
        throw new ValidationError(`"${field.label}" is required.`);
      }
    }

    const emailValue = input.data.email?.trim() || undefined;
    const nameValue = input.data.name?.trim() || undefined;
    const companyValue = input.data.company?.trim() || undefined;
    const phoneValue = input.data.phone?.trim() || undefined;

    const lead = await leadRepository.create({
      organizationId,
      companyName: companyValue || nameValue || emailValue || "Website form submission",
      contactName: nameValue,
      email: emailValue,
      phone: phoneValue,
      source: `form:${form.slug}${input.utmSource ? `:${input.utmSource}` : ""}`,
      notes: buildNotes(form, fields, input.data, input),
    });

    const submission = await formRepository.createSubmission({
      formId: form.id,
      organizationId,
      data: input.data,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmTerm: input.utmTerm,
      utmContent: input.utmContent,
      leadId: lead.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    await auditLogRepository.record({
      organizationId,
      actorType: "SYSTEM",
      actorName: "Public Website",
      action: "FORM_SUBMITTED",
      resourceType: "form_submission",
      resourceId: submission.id,
      afterData: { formId: form.id, formSlug: form.slug, leadId: lead.id },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    return { successMessage };
  },
};
