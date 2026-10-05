/** Onboarding data access (Phase 6 — docs/CLIENT_ONBOARDING_ARCHITECTURE.md; extended Phase 13). One row per Client (@unique clientId). */
import type { ClientOnboarding, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { ONBOARDING_CHECKLIST_KEYS, type OnboardingStepKey, type OnboardingTemplateStep } from "../schemas/onboardingSchemas";

export interface ChecklistItem {
  key: string;
  label: string;
  completed: boolean;
  completedAt: string | null;
  completedById: string | null;
  // Phase 13 — per-step detail, all optional/backward-compatible: an
  // existing checklist row read before this phase simply has these as
  // `undefined`, which every consumer already treats the same as null.
  dueDate?: string | null;
  assignedTo?: string | null;
  notes?: string | null;
  requiresDocument?: boolean;
  documentMediaId?: string | null;
}

const STEP_LABELS: Record<OnboardingStepKey, string> = {
  CLIENT_VERIFIED: "Client verified",
  WORKSPACE_CREATED: "Workspace created",
  PRIMARY_CONTACT_CONFIRMED: "Primary contact confirmed",
  ADMINISTRATOR_INVITED: "Administrator invited",
  ADMINISTRATOR_ACCEPTED: "Administrator accepted",
  WORKSPACE_CONFIGURED: "Workspace configured",
  ONBOARDING_COMPLETED: "Onboarding completed",
};

export function defaultOnboardingTemplateSteps(): OnboardingTemplateStep[] {
  return ONBOARDING_CHECKLIST_KEYS.map((key) => ({ key, label: STEP_LABELS[key], requiresDocument: false }));
}

/** Phase 13 — builds a fresh checklist from an organization's own template (if configured), falling back to the Phase 6 system default. */
export function freshChecklist(steps?: OnboardingTemplateStep[]): ChecklistItem[] {
  return (steps && steps.length > 0 ? steps : defaultOnboardingTemplateSteps()).map((step) => ({
    key: step.key,
    label: step.label,
    completed: false,
    completedAt: null,
    completedById: null,
    dueDate: null,
    assignedTo: null,
    notes: null,
    requiresDocument: step.requiresDocument ?? false,
    documentMediaId: null,
  }));
}

export function nextIncompleteStep(checklist: ChecklistItem[]): string | null {
  return checklist.find((item) => !item.completed)?.key ?? null;
}

export interface OnboardingFilters {
  status?: string;
  search?: string;
  ownerId?: string;
  overdue?: boolean;
}

function buildWhere(organizationId: string, filters: OnboardingFilters): Prisma.ClientOnboardingWhereInput {
  const where: Prisma.ClientOnboardingWhereInput = { organizationId };
  if (filters.status) where.status = filters.status as Prisma.EnumOnboardingStatusFilter["equals"];
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.overdue) {
    where.dueDate = { lt: new Date() };
    where.status = { notIn: ["COMPLETED", "CANCELLED"] };
  }
  if (filters.search) {
    where.client = { name: { contains: filters.search, mode: "insensitive" } };
  }
  return where;
}

export const clientOnboardingRepository = {
  async list(organizationId: string, filters: OnboardingFilters, page: number, limit: number) {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.clientOnboarding.findMany({
        where,
        include: { client: { include: { workspaceOrganization: true } } },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.clientOnboarding.count({ where }),
    ]);
    return { rows, total };
  },

  async findByIdInOrg(id: string, organizationId: string) {
    return prisma.clientOnboarding.findFirst({
      where: { id, organizationId },
      include: { client: { include: { workspaceOrganization: true } } },
    });
  },

  async findByClientId(clientId: string): Promise<ClientOnboarding | null> {
    return prisma.clientOnboarding.findUnique({ where: { clientId } });
  },

  async create(data: {
    organizationId: string;
    clientId: string;
    createdById: string;
    steps?: OnboardingTemplateStep[];
    ownerId?: string;
    dueDate?: Date;
  }): Promise<ClientOnboarding> {
    const checklist = freshChecklist(data.steps);
    return prisma.clientOnboarding.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        createdById: data.createdById,
        status: "IN_PROGRESS",
        startedAt: new Date(),
        checklist: checklist as unknown as Prisma.InputJsonValue,
        currentStep: checklist[0]!.key,
        ownerId: data.ownerId,
        dueDate: data.dueDate,
      },
    });
  },

  async update(id: string, data: Prisma.ClientOnboardingUpdateInput): Promise<ClientOnboarding> {
    return prisma.clientOnboarding.update({ where: { id }, data });
  },

  /** Phase 13 dashboard — real counts only, computed server-side (never fabricated). */
  async dashboardStats(organizationId: string, callerId: string) {
    const [active, inProgress, overdue, allOpen] = await Promise.all([
      prisma.clientOnboarding.count({ where: { organizationId, status: { in: ["IN_PROGRESS", "READY"] } } }),
      prisma.clientOnboarding.count({ where: { organizationId, status: "IN_PROGRESS" } }),
      prisma.clientOnboarding.count({
        where: { organizationId, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueDate: { lt: new Date() } },
      }),
      prisma.clientOnboarding.findMany({
        where: { organizationId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        select: { checklist: true },
      }),
    ]);

    // "Pending actions for me" and "documents awaiting action" both need
    // to look inside the JSON checklist — at this data volume (one row
    // per onboarding client, not per step), scanning in-process is simpler
    // and cheaper than a second query shape, and matches the existing
    // byStage-style in-app reduction used elsewhere (opportunityRepository).
    let pendingForCaller = 0;
    let documentsAwaiting = 0;
    for (const row of allOpen) {
      const checklist = row.checklist as unknown as ChecklistItem[];
      for (const item of checklist) {
        if (item.completed) continue;
        if (item.assignedTo === callerId) pendingForCaller++;
        if (item.requiresDocument && !item.documentMediaId) documentsAwaiting++;
      }
    }

    return { active, inProgress, overdue, pendingForCaller, documentsAwaiting };
  },
};
