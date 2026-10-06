/**
 * Publishing controls. Layers (all must allow before ANY attempt, re-read from the database every time):
 *   env SOCIAL_PUBLISHING_DISABLED  →  global kill switch  →  global enabled  →  workspace kill switch  →  workspace enabled.
 * Dry-run is the OR of the global and workspace flags. Defaults: everything OFF and dry-run ON.
 */
import { prisma } from "../../../db/prisma";
import { config } from "../../../config/env";
import { AuthorizationError } from "../../../core/errors";
import { auditLogRepository } from "../../../repositories/auditLogRepository";
import { DEFAULT_GRACE_MINUTES, DEFAULT_MAX_ATTEMPTS } from "./publishPolicy";
import type { SanitizedUser } from "../../../types/domain";
import type { RequestMeta } from "../../authService";

export interface GlobalControls { enabled: boolean; dryRun: boolean; killSwitch: boolean }
export interface WorkspaceControls extends GlobalControls { graceMinutes: number; maxAttempts: number }

export type PublishGate = { allowed: true; dryRun: boolean } | { allowed: false; reason: "env_disabled" | "global_kill_switch" | "global_off" | "workspace_kill_switch" | "workspace_off" };

/** Pure gate evaluation (exported for tests). */
export function evaluateGate(envDisabled: boolean, global: GlobalControls, ws: GlobalControls): PublishGate {
  if (envDisabled) return { allowed: false, reason: "env_disabled" };
  if (global.killSwitch) return { allowed: false, reason: "global_kill_switch" };
  if (!global.enabled) return { allowed: false, reason: "global_off" };
  if (ws.killSwitch) return { allowed: false, reason: "workspace_kill_switch" };
  if (!ws.enabled) return { allowed: false, reason: "workspace_off" };
  return { allowed: true, dryRun: global.dryRun || ws.dryRun };
}

const GLOBAL_DEFAULT: GlobalControls = { enabled: false, dryRun: true, killSwitch: false };
const WS_DEFAULT: WorkspaceControls = { enabled: false, dryRun: true, killSwitch: false, graceMinutes: DEFAULT_GRACE_MINUTES, maxAttempts: DEFAULT_MAX_ATTEMPTS };

const isAdmin = (u: SanitizedUser) => u.role.key === "ADMIN" || u.role.key === "SUPER_ADMIN";

export const publishingSettingsService = {
  async getGlobal(): Promise<GlobalControls> {
    const row = await prisma.socialPublishingGlobal.findUnique({ where: { id: "global" } });
    return row ? { enabled: row.enabled, dryRun: row.dryRun, killSwitch: row.killSwitch } : GLOBAL_DEFAULT;
  },

  async getWorkspace(organizationId: string): Promise<WorkspaceControls> {
    const row = await prisma.socialPublishingSetting.findUnique({ where: { organizationId } });
    return row ? { enabled: row.enabled, dryRun: row.dryRun, killSwitch: row.killSwitch, graceMinutes: row.graceMinutes, maxAttempts: row.maxAttempts } : WS_DEFAULT;
  },

  /** Read fresh on every call — never cached — so a kill switch takes effect before the very next attempt. */
  async gate(organizationId: string): Promise<PublishGate> {
    const [global, ws] = await Promise.all([this.getGlobal(), this.getWorkspace(organizationId)]);
    return evaluateGate(config.socialPublishingDisabled, global, ws);
  },

  async view(organizationId: string) {
    const [global, workspace] = await Promise.all([this.getGlobal(), this.getWorkspace(organizationId)]);
    const gate = evaluateGate(config.socialPublishingDisabled, global, workspace);
    return { global, workspace, envDisabled: config.socialPublishingDisabled, effective: gate.allowed ? { publishing: true, dryRun: gate.dryRun } : { publishing: false, reason: gate.reason } };
  },

  async updateWorkspace(caller: SanitizedUser, input: Partial<WorkspaceControls>, meta: RequestMeta = {}) {
    if (!isAdmin(caller)) throw new AuthorizationError("Only administrators can change publishing settings.");
    const before = await this.getWorkspace(caller.organizationId);
    const data = { ...input, updatedById: caller.id };
    await prisma.socialPublishingSetting.upsert({ where: { organizationId: caller.organizationId }, create: { organizationId: caller.organizationId, ...data }, update: data });
    const after = await this.getWorkspace(caller.organizationId);
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: input.killSwitch === true && !before.killSwitch ? "SOCIAL_PUBLISHING_KILL_SWITCH_ENGAGED" : "SOCIAL_PUBLISHING_SETTINGS_CHANGED",
      resourceType: "social_publishing_setting", beforeData: before as unknown as Record<string, unknown>, afterData: after as unknown as Record<string, unknown>, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return this.view(caller.organizationId);
  },

  async updateGlobal(caller: SanitizedUser, input: Partial<GlobalControls>, meta: RequestMeta = {}) {
    if (caller.role.key !== "SUPER_ADMIN") throw new AuthorizationError("Only a super administrator can change global publishing settings.");
    const before = await this.getGlobal();
    await prisma.socialPublishingGlobal.upsert({ where: { id: "global" }, create: { id: "global", ...GLOBAL_DEFAULT, ...input, updatedById: caller.id }, update: { ...input, updatedById: caller.id } });
    const after = await this.getGlobal();
    await auditLogRepository.record({
      organizationId: caller.organizationId, actorUserId: caller.id, actorType: "USER", action: input.killSwitch === true && !before.killSwitch ? "SOCIAL_PUBLISHING_GLOBAL_KILL_SWITCH_ENGAGED" : "SOCIAL_PUBLISHING_GLOBAL_CHANGED",
      resourceType: "social_publishing_global", resourceId: "global", beforeData: before as unknown as Record<string, unknown>, afterData: after as unknown as Record<string, unknown>, ipAddress: meta.ip, userAgent: meta.userAgent,
    });
    return this.view(caller.organizationId);
  },
};
