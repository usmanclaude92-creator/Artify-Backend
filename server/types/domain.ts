/**
 * Identity domain types. Ported from the Phase 0 audit's
 * artifysolscom/server/types/index.ts (docs/MIGRATION_PLAN.md — REUSE),
 * adapted to the Prisma-backed RoleName enum (SCREAMING_SNAKE in the DB,
 * human-readable label in the UI via ROLE_LABELS below).
 *
 * Scope note: PermissionKey stays a flat string union for Phase 1 — see
 * prisma/schema.prisma's User.permissions comment for why the full
 * role_permissions join table is deferred to Phase 3.
 */
import type { RoleName as PrismaRoleName, User as PrismaUser } from "@prisma/client";

export type RoleName = PrismaRoleName;

export const ROLE_LABELS: Readonly<Record<RoleName, string>> = {
  SUPER_ADMINISTRATOR: "Super Administrator",
  SYSTEM_ADMINISTRATOR: "System Administrator",
  COMPANY_ADMINISTRATOR: "Company Administrator",
  MANAGER: "Manager",
  CONTENT_MANAGER: "Content Manager",
  MARKETING_MANAGER: "Marketing Manager",
  SALES_MANAGER: "Sales Manager",
  FINANCE_MANAGER: "Finance Manager",
  AI_MANAGER: "AI Manager",
  SUPPORT_USER: "Support User",
  EMPLOYEE: "Employee",
  CUSTOMER: "Customer",
  READ_ONLY: "Read Only",
};

/**
 * Permission catalog. Mirrors the Phase 0 prototype's PermissionKey union
 * plus the additional groups Phase 1 §18 asks the foundation to support
 * (users.*, clients.*, content.*, billing.*, settings.manage, audit.read).
 */
export const PERMISSION_KEYS = [
  "users.read",
  "users.create",
  "users.update",
  "users.delete",
  "clients.read",
  "clients.create",
  "clients.update",
  "content.read",
  "content.create",
  "content.publish",
  "products.read",
  "products.manage",
  "billing.read",
  "billing.manage",
  "leads.read",
  "leads.manage",
  "ai.agents.read",
  "ai.agents.execute",
  "ai.agents.configure",
  "ai.tasks.read",
  "ai.tasks.approve",
  "notifications.send",
  "audit.read",
  "settings.manage",
  "company.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/** A User row with the password hash stripped — the only shape allowed to leave the service layer. */
export type SanitizedUser = Omit<PrismaUser, "passwordHash">;

export function sanitizeUser(user: PrismaUser): SanitizedUser {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}

export interface AuthenticatedSession {
  token: string;
  userId: string;
  companyId: string;
  role: RoleName;
  permissions: PermissionKey[];
  expiresAt: Date;
}
