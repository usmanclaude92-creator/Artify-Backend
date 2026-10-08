/**
 * Keeps one system-managed `Form` per landing page in step with its lead-form block, so submissions flow through the existing
 * publicFormService pipeline (validation, honeypot, Lead create/merge, automation event, notifications, analytics event) unchanged.
 * The form is ACTIVE only while the page is live; it is hidden from the Forms list (`landingPageId` is set).
 */
import type { Page, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import type { LandingDocument } from "../../schemas/landingSchemas";

export const landingFormSlug = (pageId: string) => `lp-${pageId.replace(/-/g, "").slice(0, 12)}`;

export async function syncLandingForm(page: Pick<Page, "id" | "organizationId" | "title" | "createdById">, doc: LandingDocument | null, live: boolean): Promise<string | null> {
  const existing = await prisma.form.findUnique({ where: { landingPageId: page.id } });
  const block = doc?.blocks.find((b) => b.type === "lp_form");
  if (!doc || !block || block.type !== "lp_form" || !live) {
    if (existing && existing.status !== "ARCHIVED") await prisma.form.update({ where: { id: existing.id }, data: { status: "ARCHIVED" } });
    return existing?.id ?? null;
  }
  const p = block.props;
  const fields = [
    ...p.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, ...(f.options ? { options: f.options } : {}) })),
    ...(p.consent.enabled ? [{ key: "consent", label: "Consent", type: "checkbox", required: true }] : []),
  ];
  const data = {
    name: `Landing: ${page.title}`.slice(0, 200), status: "ACTIVE" as const, fields: fields as unknown as Prisma.InputJsonValue, successMessage: p.successMessage,
    notifyUserIds: (page.createdById ? [page.createdById] : []) as unknown as Prisma.InputJsonValue,
  };
  if (existing) return (await prisma.form.update({ where: { id: existing.id }, data })).id;
  return (await prisma.form.create({ data: { ...data, organizationId: page.organizationId, slug: landingFormSlug(page.id), landingPageId: page.id, createdById: page.createdById } })).id;
}
