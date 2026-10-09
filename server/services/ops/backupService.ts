/**
 * Backups (Step 13).
 *  1. Provider view: what Supabase reports about backups (needs a Management API token; otherwise "not available here", never guessed).
 *  2. Optional scheduled logical export of critical tables: allowlisted tables only, secret-like keys stripped from every row, gzip +
 *     AES-256-GCM (key from BACKUP_EXPORT_KEY) into private object storage, retention, and a verify step (the "restore test").
 *     Credential vault contents (social_account_credentials, integrations, api keys, sessions, tokens) are NOT in the allowlist.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { prisma } from "../../db/prisma";
import { getStorageProvider } from "../../storage";
import { testStorageProvider } from "../../storage/testStorageProvider";
import { auditLogRepository } from "../../repositories/auditLogRepository";
import { ConflictError, NotFoundError } from "../../core/errors";

const MAGIC = Buffer.from("AEX1");
const MAX_ROWS_PER_TABLE = 50_000;
const MAX_BYTES = 40 * 1024 * 1024;

/** Organization-scoped tables included in the export. Anything not listed here is never exported. */
export const EXPORT_TABLES = [
  "organizations", "users", "organization_memberships", "system_settings",
  "leads", "contacts", "clients", "opportunities", "campaigns", "forms", "form_submissions", "consent_records",
  "pages", "posts", "case_studies", "templates", "template_parts", "navigation_menus", "redirects", "categories", "tags", "authors", "media_assets",
  "products", "industries",
  "social_accounts", "social_brand_voices", "social_workspace_settings", "social_content_plans", "social_posts",
] as const;

/** Tables that hold credentials or session material. Listed so a test can prove they are excluded. */
export const NEVER_EXPORTED = ["social_account_credentials", "social_oauth_states", "social_connect_sessions", "integrations", "api_keys", "sessions", "password_reset_tokens", "email_verification_tokens", "auth_handoff_codes", "landing_preview_tokens", "webhook_endpoints", "webhook_deliveries"] as const;

const SECRET_KEY = /(password|secret|token|hash|credential|api_?key|ciphertext|private_?key|signing|authorization)/i;
const KEY_EXCEPTIONS = new Set(["token_expires_at", "tokenExpiresAt"]);

export function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k) && !KEY_EXCEPTIONS.has(k)) continue;
      out[k] = scrubSecrets(v);
    }
    return out;
  }
  return value;
}

const env = () => ({
  enabled: process.env.BACKUP_EXPORT_ENABLED === "true",
  key: process.env.BACKUP_EXPORT_KEY ?? "",
  retentionDays: Math.max(7, Number(process.env.BACKUP_EXPORT_RETENTION_DAYS) || 30),
  token: process.env.SUPABASE_ACCESS_TOKEN ?? "",
  ref: process.env.SUPABASE_PROJECT_REF ?? "",
});

function aesKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "artify-export-salt", "artify/critical-export/v1", 32));
}
export function encryptExport(plain: Buffer, secret: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aesKey(secret), iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}
export function decryptExport(blob: Buffer, secret: string): Buffer {
  if (!blob.subarray(0, 4).equals(MAGIC)) throw new Error("Not an export file.");
  const d = createDecipheriv("aes-256-gcm", aesKey(secret), blob.subarray(4, 16));
  d.setAuthTag(blob.subarray(16, 32));
  return Buffer.concat([d.update(blob.subarray(32)), d.final()]);
}

async function putBlob(key: string, data: Buffer): Promise<void> {
  const p = getStorageProvider();
  if (p.name === "test") { testStorageProvider.seedObject(key, data, "application/octet-stream"); return; }
  const up = await p.createSignedUploadUrl({ key, contentType: "application/octet-stream", maxSizeBytes: data.length });
  const res = await fetch(up.url, { method: up.method, headers: up.headers, body: new Uint8Array(data) });
  if (!res.ok) throw new Error(`Storage upload failed (${res.status}).`);
}
async function getBlob(key: string): Promise<Buffer> {
  const p = getStorageProvider();
  if (p.name === "test") { const b = testStorageProvider.getBytes(key); if (!b) throw new Error("Export file is missing from storage."); return b; }
  const url = await p.createSignedReadUrl({ key, expiresInSeconds: 120 });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Storage download failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

async function tableRows(table: string, orgId: string): Promise<unknown[]> {
  if (!(EXPORT_TABLES as readonly string[]).includes(table)) throw new Error("table not allowed");
  const col = (await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name IN ('organization_id','id')`, table)).map((c) => c.column_name);
  if (!col.includes("organization_id") && table !== "organizations") return [];
  const where = table === "organizations" ? `t."id" = $1` : `t."organization_id" = $1`;
  const rows = await prisma.$queryRawUnsafe<Array<{ r: unknown }>>(`SELECT to_jsonb(t) AS r FROM "${table}" t WHERE ${where} LIMIT ${MAX_ROWS_PER_TABLE}`, orgId);
  return rows.map((x) => scrubSecrets(x.r));
}

async function revisions(orgId: string): Promise<unknown[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ r: unknown }>>(
    `SELECT to_jsonb(c) AS r FROM content_revisions c WHERE c.page_id IN (SELECT id FROM pages WHERE organization_id=$1) OR c.post_id IN (SELECT id FROM posts WHERE organization_id=$1) LIMIT ${MAX_ROWS_PER_TABLE}`, orgId);
  return rows.map((x) => scrubSecrets(x.r));
}

export interface ProviderBackupInfo {
  available: boolean; reason?: string;
  region?: string | null; pitrEnabled?: boolean | null; walgEnabled?: boolean | null;
  backups?: Array<{ at: string | null; status: string | null; physical: boolean | null }>;
  lastBackupAt?: string | null; earliestRecoveryAt?: string | null; latestRecoveryAt?: string | null;
}

export const backupService = {
  exportConfigStatus() {
    const e = env();
    return {
      enabled: e.enabled, keyConfigured: e.key.length >= 32, retentionDays: e.retentionDays,
      problems: [!e.enabled ? "BACKUP_EXPORT_ENABLED is not true: no scheduled export runs." : null, e.key.length < 32 ? "BACKUP_EXPORT_KEY is missing or shorter than 32 characters: exports are refused." : null].filter(Boolean) as string[],
    };
  },

  /** What the provider says. Never throws; never includes the token. */
  async providerInfo(): Promise<ProviderBackupInfo> {
    const e = env();
    if (!e.token || !e.ref) return { available: false, reason: "Not available here: set SUPABASE_ACCESS_TOKEN (a Supabase account access token) and SUPABASE_PROJECT_REF to let this page read the provider's backup list. Until then, check Supabase Dashboard → Database → Backups." };
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(e.ref)}/database/backups`, { headers: { Authorization: `Bearer ${e.token}` }, signal: AbortSignal.timeout(8000) });
      if (res.status === 401 || res.status === 403) return { available: false, reason: "The provider refused the access token (expired, revoked or without access to this project)." };
      if (!res.ok) return { available: false, reason: `The provider API answered ${res.status}. Backups may not be offered on this plan.` };
      const j = (await res.json()) as { region?: string; walg_enabled?: boolean; pitr_enabled?: boolean; backups?: Array<{ inserted_at?: string; status?: string; is_physical_backup?: boolean }>; physical_backup_data?: { earliest_physical_backup_date_unix?: number; latest_physical_backup_date_unix?: number } };
      const backups = (j.backups ?? []).map((b) => ({ at: b.inserted_at ?? null, status: b.status ?? null, physical: b.is_physical_backup ?? null }));
      const done = backups.filter((b) => b.at).sort((a, b) => (b.at! > a.at! ? 1 : -1));
      const unix = (n?: number) => (n ? new Date(n * 1000).toISOString() : null);
      return {
        available: true, region: j.region ?? null, pitrEnabled: j.pitr_enabled ?? null, walgEnabled: j.walg_enabled ?? null, backups,
        lastBackupAt: done[0]?.at ?? null, earliestRecoveryAt: unix(j.physical_backup_data?.earliest_physical_backup_date_unix), latestRecoveryAt: unix(j.physical_backup_data?.latest_physical_backup_date_unix),
      };
    } catch {
      return { available: false, reason: "The provider API could not be reached." };
    }
  },

  async listExports(orgId: string) {
    return prisma.dataExport.findMany({ where: { organizationId: orgId, kind: "critical" }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, status: true, sizeBytes: true, rowCounts: true, error: true, createdAt: true, expiresAt: true, verifiedAt: true } });
  },

  /** Builds, encrypts and stores one export. Refuses without a strong key. */
  async runCriticalExport(orgId: string, createdById: string | null = null, now = new Date()) {
    const e = env();
    if (e.key.length < 32) throw new ConflictError("BACKUP_EXPORT_KEY is not configured (32+ characters), so no export can be made.");
    const row = await prisma.dataExport.create({ data: { organizationId: orgId, kind: "critical", status: "RUNNING", createdById, expiresAt: new Date(now.getTime() + e.retentionDays * 86_400_000) } });
    try {
      const tables: Record<string, unknown[]> = {};
      const skipped: string[] = [];
      for (const t of EXPORT_TABLES) { const r = await tableRows(t, orgId); if (r.length === 0 && !(await hasOrgColumn(t))) skipped.push(t); tables[t] = r; }
      tables.content_revisions = await revisions(orgId);
      const rowCounts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
      const plain = gzipSync(Buffer.from(JSON.stringify({ format: "artify-critical-export", version: 1, createdAt: now.toISOString(), organizationId: orgId, rowCounts, skippedTables: skipped, tables })));
      if (plain.length > MAX_BYTES) throw new Error("Export is larger than the supported size.");
      const blob = encryptExport(plain, e.key);
      const sha256 = createHash("sha256").update(blob).digest("hex");
      const key = `private/backups/${orgId}/${now.toISOString().replace(/[:.]/g, "-")}-${row.id.slice(0, 8)}.aex`;
      await putBlob(key, blob);
      const done = await prisma.dataExport.update({ where: { id: row.id }, data: { status: "SUCCEEDED", storageKey: key, sizeBytes: blob.length, sha256, rowCounts } });
      await auditLogRepository.record({ organizationId: orgId, actorUserId: createdById ?? undefined, actorType: createdById ? "USER" : "SYSTEM", action: "OPS_EXPORT_CREATED", resourceType: "data_export", resourceId: row.id, afterData: { rowCounts, sizeBytes: blob.length } });
      await backupService.applyRetention(orgId, now);
      return done;
    } catch (err) {
      await prisma.dataExport.update({ where: { id: row.id }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 300) : "export failed" } });
      throw err;
    }
  },

  /** Deletes expired exports (files and rows), always keeping the three newest successful ones. */
  async applyRetention(orgId: string, now = new Date()): Promise<number> {
    const keep = new Set((await prisma.dataExport.findMany({ where: { organizationId: orgId, kind: "critical", status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true } })).map((r) => r.id));
    const old = await prisma.dataExport.findMany({ where: { organizationId: orgId, kind: "critical", expiresAt: { lt: now } } });
    let n = 0;
    for (const o of old) {
      if (keep.has(o.id)) continue;
      if (o.storageKey) await getStorageProvider().deleteObject(o.storageKey).catch(() => undefined);
      await prisma.dataExport.delete({ where: { id: o.id } });
      n += 1;
    }
    return n;
  },

  /** Restore test, automated part: download, decrypt, check integrity, counts and that no secret-like key slipped in. */
  async verifyExport(orgId: string, id: string) {
    const row = await prisma.dataExport.findFirst({ where: { id, organizationId: orgId } });
    if (!row || !row.storageKey) throw new NotFoundError("Export not found.");
    const e = env();
    if (e.key.length < 32) throw new ConflictError("BACKUP_EXPORT_KEY is not configured, so the export cannot be decrypted.");
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
    let ok = false;
    try {
      const blob = await getBlob(row.storageKey);
      checks.push({ name: "File checksum matches", ok: createHash("sha256").update(blob).digest("hex") === row.sha256 });
      const parsed = JSON.parse(gunzipSync(decryptExport(blob, e.key)).toString("utf8")) as { rowCounts: Record<string, number>; tables: Record<string, unknown[]> };
      checks.push({ name: "Decrypts and parses", ok: true });
      const counts = row.rowCounts as Record<string, number> | null;
      checks.push({ name: "Row counts match the record", ok: !!counts && Object.keys(counts).every((k) => parsed.tables[k]?.length === counts[k]) });
      const leaked: string[] = [];
      const walk = (v: unknown, path: string) => { if (Array.isArray(v)) v.forEach((x) => walk(x, path)); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (SECRET_KEY.test(k) && !KEY_EXCEPTIONS.has(k)) leaked.push(`${path}.${k}`); walk(x, path); } };
      for (const [t, rows] of Object.entries(parsed.tables)) walk(rows.slice(0, 200), t);
      checks.push({ name: "No credential-like fields present", ok: leaked.length === 0, detail: leaked.slice(0, 3).join(", ") || undefined });
      ok = checks.every((c) => c.ok);
    } catch (err) {
      checks.push({ name: "Decrypts and parses", ok: false, detail: err instanceof Error ? err.message : "failed" });
    }
    if (ok) await prisma.dataExport.update({ where: { id }, data: { verifiedAt: new Date() } });
    return { ok, checks };
  },
};

async function hasOrgColumn(table: string): Promise<boolean> {
  const r = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='organization_id'`, table);
  return Number(r[0]?.n ?? 0) > 0;
}
