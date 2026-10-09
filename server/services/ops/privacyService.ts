/**
 * Data privacy tooling (Step 13): person lookup, export bundle, erasure preview, request, and (via privacyApprovalService) two-person execution.
 * - A request never stores the email: it stores the IDs of the records found, a keyed HMAC pseudonym of the subject, counts and the reason.
 * - Erasure = anonymisation in place (names, contact data, free text, IP/user agent, attribution removed) so CRM reports and foreign keys stay valid.
 * - The consent register and audit log are kept; privacy audit entries carry IDs and counts only and are immutable (DB trigger).
 */
import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { config } from "../../config/env";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { ConflictError, ValidationError } from "../../core/errors";
import { toCsv } from "../../utils/csv";
import { scrubSecrets } from "./backupService";
import type { SanitizedUser } from "../../types/domain";
import type { RequestMeta } from "../authService";

export function normalizeEmail(raw: string): string {
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ValidationError("Enter a valid email address.");
  return e;
}
export const subjectRef = (orgId: string, email: string): string => createHmac("sha256", config.sessionSecret).update(`privacy-subject:${orgId}:${email}`).digest("hex").slice(0, 20);
export const maskEmail = (e: string | null | undefined) => (e ? e.replace(/^(.).*(@.*)$/, "$1***$2") : null);

export interface TargetIds { leads: string[]; contacts: string[]; clients: string[]; submissions: string[]; conversations: string[]; consent: string[] }
const EMPTY: TargetIds = { leads: [], contacts: [], clients: [], submissions: [], conversations: [], consent: [] };

async function resolveTargets(orgId: string, email: string): Promise<{ ids: TargetIds; staff: boolean }> {
  const [leads, contacts, clients, subs, staff] = await Promise.all([
    prisma.lead.findMany({ where: { organizationId: orgId, email: { equals: email, mode: "insensitive" } }, select: { id: true } }),
    prisma.contact.findMany({ where: { organizationId: orgId, email: { equals: email, mode: "insensitive" } }, select: { id: true } }),
    prisma.client.findMany({ where: { organizationId: orgId, email: { equals: email, mode: "insensitive" } }, select: { id: true } }),
    prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM form_submissions WHERE organization_id = ${orgId} AND lower(data ->> 'email') = ${email}`,
    prisma.user.count({ where: { email: { equals: email, mode: "insensitive" }, memberships: { some: { organizationId: orgId } } } }),
  ]);
  const leadIds = leads.map((l) => l.id), contactIds = contacts.map((c) => c.id);
  const bySubmissionLead = leadIds.length ? await prisma.formSubmission.findMany({ where: { organizationId: orgId, leadId: { in: leadIds } }, select: { id: true } }) : [];
  const submissions = [...new Set([...subs.map((s) => s.id), ...bySubmissionLead.map((s) => s.id)])];
  const convs = await prisma.socialConversation.findMany({
    where: { organizationId: orgId, OR: [{ participantHandle: { equals: email, mode: "insensitive" } }, { participantExternalId: { equals: email, mode: "insensitive" } }, ...(leadIds.length ? [{ leadId: { in: leadIds } }] : []), ...(contactIds.length ? [{ contactId: { in: contactIds } }] : [])] },
    select: { id: true },
  });
  const consent = await prisma.consentRecord.findMany({ where: { organizationId: orgId, OR: [...(leadIds.length ? [{ leadId: { in: leadIds } }] : []), ...(submissions.length ? [{ submissionId: { in: submissions } }] : [])] }, select: { id: true } });
  return { ids: { leads: leadIds, contacts: contactIds, clients: clients.map((c) => c.id), submissions, conversations: convs.map((c) => c.id), consent: consent.map((c) => c.id) }, staff: staff > 0 };
}

export interface PersonRecords {
  contacts: unknown[]; leads: unknown[]; clients: unknown[]; consent: unknown[]; submissions: unknown[];
  conversations: unknown[]; messages: unknown[]; audit: Array<{ id: string; action: string; resourceType: string | null; resourceId: string | null; createdAt: Date }>;
}

async function loadRecords(orgId: string, ids: TargetIds, email: string): Promise<PersonRecords & { auditSnapshotsWithEmail: number }> {
  const [contacts, leads, clients, consent, submissions, conversations, messages, audit, snaps] = await Promise.all([
    ids.contacts.length ? prisma.contact.findMany({ where: { id: { in: ids.contacts }, organizationId: orgId } }) : [],
    ids.leads.length ? prisma.lead.findMany({ where: { id: { in: ids.leads }, organizationId: orgId } }) : [],
    ids.clients.length ? prisma.client.findMany({ where: { id: { in: ids.clients }, organizationId: orgId }, select: { id: true, name: true, email: true, phone: true, address: true, notes: true, createdAt: true } }) : [],
    ids.consent.length ? prisma.consentRecord.findMany({ where: { id: { in: ids.consent }, organizationId: orgId }, orderBy: { capturedAt: "asc" } }) : [],
    ids.submissions.length ? prisma.formSubmission.findMany({ where: { id: { in: ids.submissions }, organizationId: orgId } }) : [],
    ids.conversations.length ? prisma.socialConversation.findMany({ where: { id: { in: ids.conversations }, organizationId: orgId } }) : [],
    ids.conversations.length ? prisma.socialMessage.findMany({ where: { conversationId: { in: ids.conversations }, organizationId: orgId }, select: { id: true, conversationId: true, direction: true, authorKind: true, body: true, createdAt: true } }) : [],
    prisma.auditLog.findMany({ where: { organizationId: orgId, resourceId: { in: [...ids.leads, ...ids.contacts, ...ids.clients, ...ids.submissions, ...ids.conversations] } }, orderBy: { createdAt: "asc" }, take: 500, select: { id: true, action: true, resourceType: true, resourceId: true, createdAt: true } }),
    prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM audit_logs WHERE organization_id = ${orgId} AND (before_data::text ILIKE ${"%" + email + "%"} OR after_data::text ILIKE ${"%" + email + "%"} OR metadata::text ILIKE ${"%" + email + "%"})`,
  ]);
  return { contacts, leads, clients, consent, submissions, conversations, messages, audit, auditSnapshotsWithEmail: Number(snaps[0]?.n ?? 0) };
}

const counts = (r: PersonRecords) => ({ contacts: r.contacts.length, leads: r.leads.length, clients: r.clients.length, consentRecords: r.consent.length, formSubmissions: r.submissions.length, socialConversations: r.conversations.length, socialMessages: r.messages.length, auditReferences: r.audit.length });

async function audit(orgId: string, actor: SanitizedUser | null, action: string, resourceId: string, afterData: Record<string, unknown>, meta: RequestMeta) {
  await auditLogRepository.record({ organizationId: orgId, actorUserId: actor?.id, actorType: actor ? "USER" : "SYSTEM", action, resourceType: "privacy_request", resourceId, afterData, ipAddress: meta.ip, userAgent: meta.userAgent });
}

/** Creates the approval (Approvals center source `privacy`) that gates a privacy request, and links it. `requesterId` is null for requests that come from Meta's callback, not from a person. */
export async function createPrivacyApproval(orgId: string, requestId: string, requesterId: string | null, description: string, ref: string) {
  const workflow = (await prisma.automationWorkflow.findFirst({ where: { organizationId: orgId, category: "CONTENT_APPROVAL" } })) ??
    (await prisma.automationWorkflow.create({ data: { organizationId: orgId, name: "Content Approval", description: "System workflow anchoring approval requests.", category: "CONTENT_APPROVAL", status: "ACTIVE", triggerType: "MANUAL", steps: [] } }));
  const execution = await prisma.automationExecution.create({ data: { organizationId: orgId, workflowId: workflow.id, workflowVersion: workflow.currentVersion, status: "WAITING_APPROVAL", triggerType: "MANUAL", entityType: "privacy_erasure", entityId: requestId, correlationId: requestId, initiatedById: requesterId } });
  const approval = await prisma.automationApproval.create({ data: { organizationId: orgId, executionId: execution.id, workflowId: workflow.id, stepId: "privacy-erasure", action: "erase_personal_data", description, entityType: "privacy_erasure", entityId: requestId, requesterId, status: "PENDING", payload: { requestId, subjectRef: ref } } });
  await prisma.privacyRequest.update({ where: { id: requestId }, data: { approvalId: approval.id } });
  return approval;
}

export const privacyService = {
  /** Everything held about a person. Viewing personal data is itself audited (pseudonym + counts only). */
  async lookup(caller: SanitizedUser, rawEmail: string, meta: RequestMeta = {}) {
    const orgId = caller.organizationId, email = normalizeEmail(rawEmail);
    const { ids, staff } = await resolveTargets(orgId, email);
    const records = await loadRecords(orgId, ids, email);
    const ref = subjectRef(orgId, email);
    await audit(orgId, caller, "PRIVACY_LOOKUP", ref, { subjectRef: ref, counts: counts(records) }, meta);
    return { subjectRef: ref, staffAccount: staff, found: Object.values(counts(records)).some((n) => n > 0), counts: counts(records), auditSnapshotsContainingEmail: records.auditSnapshotsWithEmail, records: scrubSecrets(records) as PersonRecords };
  },

  /** Export bundle (JSON or one long-format CSV). Needs privacy.export; audited. */
  async exportBundle(caller: SanitizedUser, rawEmail: string, format: "json" | "csv", meta: RequestMeta = {}) {
    const orgId = caller.organizationId, email = normalizeEmail(rawEmail);
    const { ids } = await resolveTargets(orgId, email);
    const records = scrubSecrets(await loadRecords(orgId, ids, email)) as PersonRecords & { auditSnapshotsWithEmail: number };
    const ref = subjectRef(orgId, email);
    await audit(orgId, caller, "PRIVACY_EXPORT_CREATED", ref, { subjectRef: ref, format, counts: counts(records) }, meta);
    const bundle = { format: "artify-subject-export", version: 1, generatedAt: new Date().toISOString(), subject: { email }, retention: "See Administration → Data Privacy → Retention policy.", ...records };
    if (format === "json") return { filename: `subject-export-${ref}.json`, contentType: "application/json", body: JSON.stringify(bundle, null, 2) };
    const rows: unknown[][] = [];
    for (const [section, list] of Object.entries(records)) {
      if (!Array.isArray(list)) continue;
      for (const rec of list as Array<Record<string, unknown>>) for (const [field, value] of Object.entries(rec)) rows.push([section, String(rec.id ?? ""), field, value !== null && typeof value === "object" ? JSON.stringify(value) : value]);
    }
    return { filename: `subject-export-${ref}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(["section", "record_id", "field", "value"], rows) };
  },

  /** What an erasure would change, table by table. Pure read. */
  async preview(caller: SanitizedUser, rawEmail: string) {
    const orgId = caller.organizationId, email = normalizeEmail(rawEmail);
    const { ids, staff } = await resolveTargets(orgId, email);
    const records = await loadRecords(orgId, ids, email);
    return {
      subjectRef: subjectRef(orgId, email), staffAccount: staff, erasable: !staff && (ids.leads.length + ids.contacts.length + ids.clients.length + ids.submissions.length + ids.conversations.length) > 0,
      blocker: staff ? "This email belongs to a staff account. Staff accounts are managed in Users, not erased here." : null,
      changes: [
        { table: "leads", rows: ids.leads.length, action: "Anonymise", detail: "Contact name, email, phone, notes, attribution and referrer removed; company name replaced; the lead is archived." },
        { table: "contacts", rows: ids.contacts.length, action: "Anonymise", detail: "Name replaced, email, phone and job title removed; the contact is archived." },
        { table: "clients", rows: ids.clients.length, action: "Clear contact fields", detail: "Email and phone removed. The business name is not changed (review manually if the client is the person)." },
        { table: "form_submissions", rows: ids.submissions.length, action: "Anonymise", detail: "Submitted answers replaced, IP address, user agent, referrer and first-touch data removed." },
        { table: "social_messages", rows: records.messages.length, action: "Delete", detail: "Message text of matched conversations deleted." },
        { table: "social_conversations", rows: ids.conversations.length, action: "Anonymise", detail: "Participant name, handle and id removed." },
        { table: "consent_records", rows: ids.consent.length, action: "Keep", detail: "Source, status and time only; contains no personal data." },
        { table: "audit_logs", rows: records.audit.length, action: "Keep", detail: `Immutable record. ${records.auditSnapshotsWithEmail} entr${records.auditSnapshotsWithEmail === 1 ? "y holds" : "ies hold"} the email inside a change snapshot and cannot be rewritten here.` },
      ],
      counts: counts(records),
    };
  },

  /** Creates the request and its approval. Stores IDs and counts only. */
  async requestErasure(caller: SanitizedUser, rawEmail: string, reason: string, meta: RequestMeta = {}) {
    const orgId = caller.organizationId, email = normalizeEmail(rawEmail);
    const why = reason.trim();
    if (why.length < 10) throw new ValidationError("A reason of at least 10 characters is required.");
    const { ids, staff } = await resolveTargets(orgId, email);
    if (staff) throw new ConflictError("This email belongs to a staff account and cannot be erased here.");
    const records = await loadRecords(orgId, ids, email);
    if (ids.leads.length + ids.contacts.length + ids.clients.length + ids.submissions.length + ids.conversations.length === 0) throw new ConflictError("Nothing is held about this email, so there is nothing to erase.");
    const ref = subjectRef(orgId, email);
    if (await prisma.privacyRequest.findFirst({ where: { organizationId: orgId, subjectRef: ref, kind: "ERASURE", status: "PENDING_APPROVAL" } })) throw new ConflictError("An erasure request for this person is already waiting for approval.");

    const req = await prisma.privacyRequest.create({ data: { organizationId: orgId, kind: "ERASURE", status: "PENDING_APPROVAL", subjectRef: ref, reason: why.slice(0, 500), requestedById: caller.id, targetIds: ids as unknown as Prisma.InputJsonValue, previewCounts: counts(records) } });
    const approval = await createPrivacyApproval(orgId, req.id, caller.id, `Erase personal data (subject ${ref})`, ref);
    await audit(orgId, caller, "PRIVACY_ERASURE_REQUESTED", req.id, { subjectRef: ref, counts: counts(records) }, meta);
    return { requestId: req.id, approvalId: approval.id, subjectRef: ref, counts: counts(records) };
  },

  async listRequests(orgId: string) {
    return prisma.privacyRequest.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, kind: true, status: true, subjectRef: true, reason: true, requestedById: true, approvedById: true, previewCounts: true, resultCounts: true, createdAt: true, decidedAt: true, executedAt: true } });
  },

  /** Approver's view: what the request will touch, read live from the CRM (the request itself holds no personal data). */
  async describeRequest(orgId: string, requestId: string) {
    const r = await prisma.privacyRequest.findFirst({ where: { id: requestId, organizationId: orgId } });
    if (!r) throw new ConflictError("Request not found.");
    if (r.kind === "META_DELETION") return { id: r.id, status: r.status, reason: r.reason, subjectRef: r.subjectRef, counts: r.previewCounts, maskedEmails: [] as Array<string | null> };
    const ids = (r.targetIds as unknown as TargetIds | null) ?? EMPTY;
    const [leads, contacts] = await Promise.all([
      ids.leads.length ? prisma.lead.findMany({ where: { id: { in: ids.leads }, organizationId: orgId }, select: { id: true, email: true, source: true, createdAt: true } }) : [],
      ids.contacts.length ? prisma.contact.findMany({ where: { id: { in: ids.contacts }, organizationId: orgId }, select: { id: true, email: true } }) : [],
    ]);
    return { id: r.id, status: r.status, reason: r.reason, subjectRef: r.subjectRef, counts: r.previewCounts, maskedEmails: [...new Set([...leads.map((l) => maskEmail(l.email)), ...contacts.map((c) => maskEmail(c.email))].filter(Boolean))] };
  },

  /** Executes an approved request in one transaction. Called only by privacyApprovalService. Idempotent on retry (already anonymised rows are rewritten identically). */
  async execute(orgId: string, requestId: string) {
    const r = await prisma.privacyRequest.findFirst({ where: { id: requestId, organizationId: orgId } });
    if (!r) throw new ConflictError("Request not found.");
    const ids = (r.targetIds as unknown as TargetIds | null) ?? EMPTY;
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const leads = await tx.lead.updateMany({ where: { id: { in: ids.leads }, organizationId: orgId }, data: { companyName: "Erased", contactName: null, email: null, phone: null, notes: null, utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null, referrer: null, landingPagePath: null, firstTouch: Prisma.DbNull, deletedAt: now } });
      const contacts = await tx.contact.updateMany({ where: { id: { in: ids.contacts }, organizationId: orgId }, data: { firstName: "Erased", lastName: "Contact", email: null, phone: null, jobTitle: null, deletedAt: now } });
      const clients = await tx.client.updateMany({ where: { id: { in: ids.clients }, organizationId: orgId }, data: { email: null, phone: null } });
      const subs = await tx.formSubmission.updateMany({ where: { id: { in: ids.submissions }, organizationId: orgId }, data: { data: { erased: true }, ipAddress: null, userAgent: null, referrer: null, firstTouch: Prisma.DbNull, utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null } });
      const msgs = await tx.socialMessage.deleteMany({ where: { conversationId: { in: ids.conversations }, organizationId: orgId } });
      const convs = await tx.socialConversation.updateMany({ where: { id: { in: ids.conversations }, organizationId: orgId }, data: { participantName: null, participantHandle: null, participantExternalId: null } });
      return { leads: leads.count, contacts: contacts.count, clients: clients.count, formSubmissions: subs.count, socialMessages: msgs.count, socialConversations: convs.count };
    });
    return result;
  },
};
