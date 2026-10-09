/**
 * System Health (Step 13). Every check returns a status, a plain reason and the time it ran. Nothing is estimated: a signal the app does not
 * have (e.g. an error-rate log store) is reported "unknown" with the reason, never as a made-up green. Env checks report present/missing only.
 */
import { prisma } from "../../db/prisma";
import { config } from "../../config/env";
import { notificationService } from "../notificationService";
import { userRepository } from "../../repositories/userRepository";
import { HEARTBEATS } from "./heartbeat";

export type HealthStatus = "ok" | "warn" | "red" | "disabled" | "unknown";
export interface HealthCheck {
  key: string; group: "Platform" | "Scheduler" | "Connectors" | "Queues" | "Storage" | "Logs" | "Configuration";
  label: string; status: HealthStatus; reason: string; checkedAt: string; value?: string | number | null;
}

export const ALERT_AFTER_RED_MS = 15 * 60_000; // a check must stay red this long before anyone is told
export const ALERT_COOLDOWN_MS = 6 * 3600_000; // at most one grouped notification per user per cooldown
const LATE_FACTOR = 3;

type Result = Omit<HealthCheck, "key" | "group" | "label" | "checkedAt">;
const mk = (key: string, group: HealthCheck["group"], label: string, r: Result, at: Date): HealthCheck => ({ key, group, label, checkedAt: at.toISOString(), ...r });
const ago = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : ms < 172_800_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} d`);

async function dbChecks(at: Date): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ms = Date.now() - t0;
    out.push(mk("db_latency", "Platform", "Database latency", { status: ms > 1500 ? "red" : ms > 300 ? "warn" : "ok", reason: `Round trip ${ms} ms (warn above 300 ms, red above 1500 ms).`, value: ms }, at));
  } catch {
    out.push(mk("db_latency", "Platform", "Database latency", { status: "red", reason: "The database did not answer a SELECT 1.", value: null }, at));
    return out;
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ used: bigint; max: string }>>`SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS used, current_setting('max_connections') AS max`;
    const used = Number(rows[0]?.used ?? 0), max = Number(rows[0]?.max ?? 0);
    const pct = max > 0 ? Math.round((used / max) * 100) : 0;
    out.push(mk("db_connections", "Platform", "Database connections", { status: pct >= 90 ? "red" : pct >= 70 ? "warn" : "ok", reason: `${used} of ${max} connections in use (${pct}%). Warn from 70%, red from 90%.`, value: pct }, at));
  } catch {
    out.push(mk("db_connections", "Platform", "Database connections", { status: "unknown", reason: "Connection statistics are not readable with this database role." }, at));
  }
  return out;
}

async function schedulerChecks(at: Date): Promise<HealthCheck[]> {
  const rows = new Map((await prisma.jobHeartbeat.findMany()).map((r) => [r.key, r]));
  const out: HealthCheck[] = [];
  for (const spec of HEARTBEATS) {
    const label = spec.label;
    if (spec.key === "listening_poll" && !config.socialListeningPolling) { out.push(mk(`hb_${spec.key}`, "Scheduler", label, { status: "disabled", reason: "Polling is switched off (SOCIAL_LISTENING_POLLING is not true). Webhooks still work." }, at)); continue; }
    if (spec.key === "critical_export" && process.env.BACKUP_EXPORT_ENABLED !== "true") { out.push(mk(`hb_${spec.key}`, "Scheduler", label, { status: "disabled", reason: "The scheduled export is off (BACKUP_EXPORT_ENABLED is not true)." }, at)); continue; }
    const hb = rows.get(spec.key);
    if (!hb?.lastFinishedAt) { out.push(mk(`hb_${spec.key}`, "Scheduler", label, { status: "unknown", reason: `No run recorded yet. ${spec.note ?? ""}`.trim() }, at)); continue; }
    const age = at.getTime() - hb.lastFinishedAt.getTime();
    const limit = spec.expectedEverySeconds * 1000 * (spec.expectedEverySeconds >= 86400 ? 1.2 : LATE_FACTOR);
    if (hb.lastStatus === "error") { out.push(mk(`hb_${spec.key}`, "Scheduler", label, { status: "red", reason: `Last run ${ago(age)} ago reported an error${hb.lastError ? ` (${hb.lastError})` : ""}.`, value: age }, at)); continue; }
    out.push(mk(`hb_${spec.key}`, "Scheduler", label, age > limit ? { status: "red", reason: `LATE: last finished ${ago(age)} ago, expected every ${ago(spec.expectedEverySeconds * 1000)}. ${spec.note ?? ""}`.trim(), value: age } : { status: "ok", reason: `Last finished ${ago(age)} ago (expected every ${ago(spec.expectedEverySeconds * 1000)}).`, value: age }, at));
  }
  return out;
}

async function connectorChecks(orgId: string, at: Date): Promise<HealthCheck[]> {
  const accounts = await prisma.socialAccount.findMany({ where: { organizationId: orgId, status: { not: "DISCONNECTED" } }, select: { provider: true, status: true, tokenExpiresAt: true, displayName: true } });
  const providers: Array<[string, string]> = [["FACEBOOK", "Facebook"], ["INSTAGRAM", "Instagram"], ["LINKEDIN", "LinkedIn"]];
  const out: HealthCheck[] = [];
  for (const [id, name] of providers) {
    const mine = accounts.filter((a) => a.provider.toUpperCase() === id);
    if (mine.length === 0) { out.push(mk(`token_${id.toLowerCase()}`, "Connectors", `${name} token`, { status: "disabled", reason: `No ${name} account is connected.` }, at)); continue; }
    const bad = mine.filter((a) => a.status !== "CONNECTED");
    if (bad.length) { out.push(mk(`token_${id.toLowerCase()}`, "Connectors", `${name} token`, { status: "red", reason: `${bad.length} of ${mine.length} account(s) need attention (${bad.map((a) => a.status).join(", ")}). Reconnect in Social → Accounts.` }, at)); continue; }
    const dated = mine.filter((a) => a.tokenExpiresAt);
    if (dated.length === 0) { out.push(mk(`token_${id.toLowerCase()}`, "Connectors", `${name} token`, { status: "unknown", reason: `Connected, but ${name} did not report an expiry date for this token, so days left cannot be shown.` }, at)); continue; }
    const days = Math.floor((Math.min(...dated.map((a) => a.tokenExpiresAt!.getTime())) - at.getTime()) / 86_400_000);
    out.push(mk(`token_${id.toLowerCase()}`, "Connectors", `${name} token`, { status: days < 0 ? "red" : days < 7 ? "red" : days < 14 ? "warn" : "ok", reason: days < 0 ? "The token has expired." : `Soonest expiry in ${days} day(s). Red under 7 days, warn under 14.`, value: days }, at));
  }
  return out;
}

async function queueChecks(orgId: string, at: Date): Promise<HealthCheck[]> {
  const day = new Date(at.getTime() - 24 * 3600_000);
  const stuck = new Date(at.getTime() - 3 * 86_400_000);
  const [failed, uncertain, staleApprovals, staleSocial] = await Promise.all([
    prisma.socialPost.count({ where: { organizationId: orgId, deletedAt: null, status: "FAILED", updatedAt: { gte: day } } }),
    prisma.socialPostTarget.count({ where: { status: "UNCERTAIN", post: { organizationId: orgId, deletedAt: null } } }),
    prisma.automationApproval.count({ where: { organizationId: orgId, status: "PENDING", requestedAt: { lt: stuck } } }),
    prisma.socialPost.count({ where: { organizationId: orgId, deletedAt: null, status: "PENDING_APPROVAL", updatedAt: { lt: stuck } } }),
  ]);
  return [
    mk("q_publish_failed", "Queues", "Failed social posts (24 h)", { status: failed > 0 ? "red" : "ok", reason: failed ? `${failed} post(s) failed to publish in the last 24 hours. See Social → Failures.` : "No failed publishes in the last 24 hours.", value: failed }, at),
    mk("q_uncertain", "Queues", "Uncertain social posts", { status: uncertain > 0 ? "red" : "ok", reason: uncertain ? `${uncertain} target(s) are UNCERTAIN: the network may or may not have published them. Check each one before retrying.` : "No uncertain posts.", value: uncertain }, at),
    mk("q_stuck_approvals", "Queues", "Approvals waiting over 3 days", { status: staleApprovals + staleSocial > 0 ? "warn" : "ok", reason: staleApprovals + staleSocial ? `${staleApprovals + staleSocial} approval request(s) have waited more than 3 days (workflow/content/landing: ${staleApprovals}, social: ${staleSocial}).` : "No approval has waited more than 3 days.", value: staleApprovals + staleSocial }, at),
  ];
}

async function storageChecks(orgId: string, at: Date): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  try {
    const rows = await prisma.$queryRaw<Array<{ bytes: bigint | null; n: bigint }>>`SELECT COALESCE(SUM(size_bytes), 0) AS bytes, COUNT(*) AS n FROM media_assets WHERE organization_id = ${orgId} AND status IN ('ACTIVE','ARCHIVED')`;
    const mb = Math.round(Number(rows[0]?.bytes ?? 0) / 1_048_576 * 10) / 10;
    out.push(mk("storage_media", "Storage", "Media library size", { status: "ok", reason: `${rows[0]?.n ?? 0} file(s), ${mb} MB. No quota is configured in the app, so there is no threshold; check your storage plan limit.`, value: mb }, at));
  } catch {
    out.push(mk("storage_media", "Storage", "Media library size", { status: "unknown", reason: "Could not read media usage." }, at));
  }
  try {
    const rows = await prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`;
    const mb = Math.round(Number(rows[0]?.bytes ?? 0) / 1_048_576 * 10) / 10;
    out.push(mk("storage_db", "Storage", "Database size", { status: "ok", reason: `${mb} MB on disk. The plan's database size limit is not readable from here, so there is no threshold.`, value: mb }, at));
  } catch {
    out.push(mk("storage_db", "Storage", "Database size", { status: "unknown", reason: "Database size is not readable with this role." }, at));
  }
  return out;
}

async function logChecks(orgId: string, at: Date): Promise<HealthCheck[]> {
  const day = new Date(at.getTime() - 24 * 3600_000);
  const failures = await prisma.auditLog.count({ where: { organizationId: orgId, result: "FAILURE", createdAt: { gte: day } } });
  return [
    mk("logs_error_rate", "Logs", "API error rate", { status: "unknown", reason: "The app does not store its own request logs, so an error rate cannot be computed here. Runtime logs are in Vercel (retention depends on your Vercel plan)." }, at),
    mk("logs_audit_failures", "Logs", "Failed audited actions (24 h)", { status: failures > 50 ? "warn" : "ok", reason: `${failures} audited action(s) ended in FAILURE in the last 24 hours (login failures included). This is a proxy, not an error rate.`, value: failures }, at),
  ];
}

/** Variable NAMES only. The value is never read into the response. */
export const ENV_CHECKLIST: Array<{ name: string; required: boolean; purpose: string }> = [
  { name: "DATABASE_URL", required: true, purpose: "Database connection" },
  { name: "SESSION_SECRET", required: true, purpose: "Session and key derivation" },
  { name: "CORS_ORIGINS", required: true, purpose: "Allowed website origins" },
  { name: "CRON_SECRET", required: true, purpose: "Scheduler authentication (tick endpoints)" },
  { name: "PUBLIC_WEBSITE_ORGANIZATION_ID", required: true, purpose: "Workspace served by the public website" },
  { name: "PUBLIC_SITE_BASE_URL", required: false, purpose: "Public links (landing pages, previews, UTM links)" },
  { name: "INTEGRATIONS_ENCRYPTION_KEY", required: false, purpose: "Integration credential encryption (falls back to SESSION_SECRET)" },
  { name: "SOCIAL_VAULT_KEYS", required: false, purpose: "Social token vault key ring (falls back to a derived key)" },
  { name: "REDIS_URL", required: false, purpose: "Shared rate-limit store (limits fall back to per-instance memory without it)" },
  { name: "OBJECT_STORAGE_PROVIDER", required: false, purpose: "Media and export storage" },
  { name: "EMAIL_PROVIDER", required: false, purpose: "Transactional email" },
  { name: "META_APP_ID", required: false, purpose: "Facebook/Instagram connection" },
  { name: "LINKEDIN_CLIENT_ID", required: false, purpose: "LinkedIn connection" },
  { name: "BACKUP_EXPORT_KEY", required: false, purpose: "Encryption key for scheduled exports (required to enable them)" },
  { name: "SUPABASE_ACCESS_TOKEN", required: false, purpose: "Lets the Backups page read the provider's backup list" },
  { name: "SUPABASE_PROJECT_REF", required: false, purpose: "Project reference for the backup list" },
];

function envChecks(at: Date): HealthCheck[] {
  const present = (n: string) => !!process.env[n] && process.env[n]!.trim().length > 0;
  const missingRequired = ENV_CHECKLIST.filter((e) => e.required && !present(e.name));
  const items = ENV_CHECKLIST.map((e) => ({ name: e.name, required: e.required, purpose: e.purpose, present: present(e.name) }));
  return [
    { key: "env_required", group: "Configuration", label: "Required configuration", checkedAt: at.toISOString(), status: missingRequired.length ? "red" : "ok", reason: missingRequired.length ? `Missing: ${missingRequired.map((e) => e.name).join(", ")}.` : "All required variables are set.", value: `${items.filter((i) => i.required && i.present).length}/${items.filter((i) => i.required).length}`, ...({ items } as object) } as HealthCheck,
  ];
}

export const healthService = {
  /** Runs every check for an organization. Pure read; also what the page shows. */
  async run(orgId: string, now = new Date()): Promise<HealthCheck[]> {
    const parts = await Promise.all([dbChecks(now), schedulerChecks(now), connectorChecks(orgId, now), queueChecks(orgId, now), storageChecks(orgId, now), logChecks(orgId, now)]);
    return [...parts.flat(), ...envChecks(now)];
  },

  /** Run + persist results and return them with "red since". Called by the scheduler tick and by the page. */
  async runAndStore(orgId: string, now = new Date()) {
    const checks = await healthService.run(orgId, now);
    const existing = new Map((await prisma.healthCheckResult.findMany({ where: { organizationId: orgId } })).map((r) => [r.key, r]));
    for (const c of checks) {
      const prev = existing.get(c.key);
      const redSince = c.status === "red" ? prev?.redSince ?? now : null;
      await prisma.healthCheckResult.upsert({
        where: { organizationId_key: { organizationId: orgId, key: c.key } },
        create: { organizationId: orgId, key: c.key, status: c.status, reason: c.reason, checkedAt: now, redSince },
        update: { status: c.status, reason: c.reason, checkedAt: now, redSince, ...(c.status !== "red" ? { lastAlertedAt: null } : {}) },
      });
    }
    const since = new Map((await prisma.healthCheckResult.findMany({ where: { organizationId: orgId } })).map((r) => [r.key, r.redSince]));
    return checks.map((c) => ({ ...c, redSince: since.get(c.key)?.toISOString() ?? null }));
  },

  /**
   * Alerting: checks that have stayed red for ALERT_AFTER_RED_MS and were not alerted in the last ALERT_COOLDOWN_MS are grouped into ONE
   * notification per admin (bell). Returns how many checks were included (0 = nothing sent).
   */
  async alertIfNeeded(orgId: string, now = new Date()): Promise<{ alerted: number; recipients: number }> {
    const rows = await prisma.healthCheckResult.findMany({ where: { organizationId: orgId, status: "red", redSince: { lte: new Date(now.getTime() - ALERT_AFTER_RED_MS) } } });
    const due = rows.filter((r) => !r.lastAlertedAt || now.getTime() - r.lastAlertedAt.getTime() >= ALERT_COOLDOWN_MS);
    if (due.length === 0) return { alerted: 0, recipients: 0 };
    const label = new Map(HEARTBEATS.map((h) => [`hb_${h.key}`, h.label]));
    const names = due.map((r) => label.get(r.key) ?? r.key.replace(/^(q_|token_|hb_)/, "").replace(/_/g, " "));
    const recipients = await userRepository.listActiveByRoleKeysInOrg(orgId, ["ADMIN", "SUPER_ADMIN"]);
    const message = `${due.length} health check(s) have been red for over ${Math.round(ALERT_AFTER_RED_MS / 60_000)} minutes: ${names.slice(0, 5).join(", ")}${names.length > 5 ? `, and ${names.length - 5} more` : ""}. Open Administration → System Health.`;
    await Promise.all(recipients.map((u) => notificationService.notify({ organizationId: orgId, userId: u.id, type: "system_health_alert", title: "System health needs attention", message, entityType: "system_health" })));
    await prisma.healthCheckResult.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { lastAlertedAt: now } });
    return { alerted: due.length, recipients: recipients.length };
  },
};
