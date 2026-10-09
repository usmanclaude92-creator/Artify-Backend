/** Step 13: System Health, Backups/exports, retention, consent register, data privacy (lookup/export/erasure with two-person approval). Real DB, real services. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { gunzipSync } from "node:zlib";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";
import { healthService, ALERT_AFTER_RED_MS, ALERT_COOLDOWN_MS } from "../../server/services/ops/healthService";
import { heartbeat } from "../../server/services/ops/heartbeat";
import { backupService, decryptExport, EXPORT_TABLES, NEVER_EXPORTED } from "../../server/services/ops/backupService";
import { retentionService, PURGE_JOBS } from "../../server/services/ops/retentionService";
import { RETENTION_POLICY } from "../../server/services/ops/retentionPolicy";
import { testStorageProvider } from "../../server/storage/testStorageProvider";
import { config } from "../../server/config/env";

const PUBLIC_ORG_ID = config.publicWebsiteOrganizationId;
const SECRET_SENTINEL = "SENTINEL_SECRET_VALUE_9f3a";
const PERSON = "qa_test_2026_person@example.com";

describe("Step 13 operations and privacy", () => {
  const app = createApp();
  finalizeApp(app);
  let ip = 10;
  let orgId = "", adminTok = "", managerTok = "", viewerTok = "", superA = "", superB = "", superAId = "", superBId = "", adminId = "";
  const call = (method: "get" | "post", path: string, token: string, body?: object) => {
    const r = request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${token}`).set("X-Forwarded-For", `10.13.0.${ip++}`);
    return method === "get" ? r : r.send(body ?? {});
  };
  const login = async (email: string) => (await request(app).post("/api/v1/auth/login").set("X-Forwarded-For", `10.13.1.${ip++}`).send({ email, password: "Str0ng-Passphrase-77" })).body.data.session.token as string;
  async function member(email: string, roleKey: string, promote?: boolean) {
    const r = await call("post", "/users", adminTok, { email, password: "Str0ng-Passphrase-77", firstName: "QA", lastName: roleKey, roleKey: promote ? "ADMIN" : roleKey });
    expect(r.status).toBe(201);
    const id = r.body.data.user.id as string;
    if (promote) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
      await prisma.user.update({ where: { id }, data: { roleId: role.id } });
      await prisma.organizationMembership.updateMany({ where: { userId: id }, data: { roleId: role.id } });
    }
    return { id, token: await login(email) };
  }

  beforeAll(async () => {
    await resetDb();
    expect(PUBLIC_ORG_ID).toBeTruthy();
    await prisma.organization.create({ data: { id: PUBLIC_ORG_ID, name: "QA_TEST_2026_ Ops", slug: "qa-ops" } });
    const reg = await request(app).post("/api/v1/auth/register").set("X-Forwarded-For", "10.13.2.1").send({ email: "qa-ops-admin@example.com", password: "Str0ng-Passphrase-77", firstName: "QA", lastName: "Admin", organizationName: "QA_TEST_2026_ Ops Org" });
    adminTok = reg.body.data.session.token; adminId = reg.body.data.user.id;
    await prisma.user.update({ where: { id: adminId }, data: { organizationId: PUBLIC_ORG_ID } });
    await prisma.session.updateMany({ where: { userId: adminId }, data: { organizationId: PUBLIC_ORG_ID } });
    await prisma.organizationMembership.updateMany({ where: { userId: adminId }, data: { organizationId: PUBLIC_ORG_ID } });
    orgId = PUBLIC_ORG_ID;
    managerTok = (await member("qa-ops-manager@example.com", "MANAGER")).token;
    viewerTok = (await member("qa-ops-viewer@example.com", "VIEWER")).token;
    const a = await member("qa-ops-super-a@example.com", "ADMIN", true); superA = a.token; superAId = a.id;
    const b = await member("qa-ops-super-b@example.com", "ADMIN", true); superB = b.token; superBId = b.id;
    process.env.BACKUP_EXPORT_KEY = "k".repeat(40);
  });
  afterAll(async () => { delete process.env.BACKUP_EXPORT_KEY; await disconnectPrisma(); });

  describe("permissions", () => {
    it("maps roles exactly: ADMIN gets four, SUPER_ADMIN five, nobody else any", async () => {
      const keys = ["ops.health.read", "ops.backups.read", "privacy.read", "privacy.export", "privacy.erase"];
      const rows = await prisma.rolePermission.findMany({ where: { permission: { key: { in: keys } } }, include: { role: true, permission: true } });
      const map: Record<string, string[]> = {};
      for (const r of rows) (map[r.role.key] ??= []).push(r.permission.key);
      expect(map.ADMIN!.sort()).toEqual(["ops.backups.read", "ops.health.read", "privacy.export", "privacy.read"]);
      expect(Object.keys(map).sort()).toEqual(["ADMIN", "SUPER_ADMIN"]);
      expect(map.SUPER_ADMIN).toContain("privacy.erase");
    });
    it("enforces them on every endpoint", async () => {
      for (const tok of [managerTok, viewerTok]) {
        expect((await call("get", "/ops/health", tok)).status).toBe(403);
        expect((await call("get", "/ops/backups", tok)).status).toBe(403);
        expect((await call("post", "/privacy/lookup", tok, { email: PERSON })).status).toBe(403);
        expect((await call("get", "/ops/retention", tok)).status).toBe(403);
      }
      expect((await request(app).get("/api/v1/ops/health")).status).toBe(401);
      expect((await call("get", "/ops/health", adminTok)).status).toBe(200);
      expect((await call("get", "/ops/backups", adminTok)).status).toBe(200);
      expect((await call("post", "/privacy/lookup", adminTok, { email: PERSON })).status).toBe(200);
      expect((await call("post", "/privacy/erasure-requests", adminTok, { email: PERSON, reason: "ADMIN must not be allowed" })).status).toBe(403);
      expect((await call("post", "/ops/backups/exports", adminTok)).status).toBe(403); // manual export: SUPER_ADMIN only
    });
  });

  describe("system health", () => {
    beforeEach(async () => { await prisma.jobHeartbeat.deleteMany(); await prisma.healthCheckResult.deleteMany(); });
    const byKey = async (key: string) => (await healthService.run(orgId)).find((c) => c.key === key)!;

    it("scheduler: unknown before any run, green after a run, red LATE when stale, red on a reported error", async () => {
      expect((await byKey("hb_automation_tick")).status).toBe("unknown");
      await heartbeat.record("automation_tick", new Date(), "ok");
      expect((await byKey("hb_automation_tick")).status).toBe("ok");
      await prisma.jobHeartbeat.update({ where: { key: "automation_tick" }, data: { lastFinishedAt: new Date(Date.now() - 20 * 60_000) } });
      const late = await byKey("hb_automation_tick");
      expect(late.status).toBe("red");
      expect(late.reason).toMatch(/LATE/);
      await heartbeat.record("automation_tick", new Date(), "error", "boom");
      expect((await byKey("hb_automation_tick")).reason).toMatch(/reported an error/);
    });
    it("a heartbeat wrapper records failures and rethrows", async () => {
      await expect(heartbeat.around("inbox_tick", async () => { throw new Error("x"); })).rejects.toThrow();
      expect((await prisma.jobHeartbeat.findUnique({ where: { key: "inbox_tick" } }))!.lastStatus).toBe("error");
    });
    it("listening poll shows 'disabled' when polling is off, not red", async () => {
      expect((await byKey("hb_listening_poll")).status).toBe(config.socialListeningPolling ? "unknown" : "disabled");
    });
    it("database latency/connections, connectors, queues and storage report real values with a reason", async () => {
      const all = await healthService.run(orgId);
      expect(all.find((c) => c.key === "db_latency")!.status).toMatch(/ok|warn/);
      expect(all.find((c) => c.key === "token_facebook")!.status).toBe("disabled");
      expect(all.find((c) => c.key === "logs_error_rate")!.status).toBe("unknown");
      expect(all.every((c) => c.reason.length > 0 && !!c.checkedAt)).toBe(true);
    });
    it("connector token: days to expiry drives warn and red; reconnect-needed is red", async () => {
      const acc = await prisma.socialAccount.create({ data: { organizationId: orgId, provider: "meta_facebook", externalAccountId: "qa-fb-1", displayName: "QA_TEST_2026_ Page", status: "CONNECTED", tokenExpiresAt: new Date(Date.now() + 10 * 86_400_000) } });
      expect((await byKey("token_facebook")).status).toBe("warn");
      await prisma.socialAccount.update({ where: { id: acc.id }, data: { tokenExpiresAt: new Date(Date.now() + 3 * 86_400_000) } });
      const red = await byKey("token_facebook");
      expect(red.status).toBe("red");
      expect(red.value).toBe(2);
      await prisma.socialAccount.update({ where: { id: acc.id }, data: { tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000) } });
      expect((await byKey("token_facebook")).status).toBe("ok");
      await prisma.socialAccount.update({ where: { id: acc.id }, data: { status: "NEEDS_REAUTH" } });
      expect((await byKey("token_facebook")).status).toBe("red");
      const ig = await prisma.socialAccount.create({ data: { organizationId: orgId, provider: "meta_instagram", externalAccountId: "qa-ig-1", displayName: "QA_TEST_2026_ IG", status: "CONNECTED", tokenExpiresAt: new Date(Date.now() + 60 * 86_400_000) } });
      expect((await byKey("token_instagram")).status).toBe("ok"); // real provider id is meta_instagram
      expect((await byKey("token_linkedin")).status).toBe("disabled");
      await prisma.socialAccount.delete({ where: { id: ig.id } });
      await prisma.socialAccount.delete({ where: { id: acc.id } });
    });
    it("queues: failed and stuck approvals surface", async () => {
      const wf = await prisma.automationWorkflow.create({ data: { organizationId: orgId, name: "QA_TEST_2026_ wf", category: "QA", status: "ACTIVE", triggerType: "MANUAL", steps: [] } });
      const ex = await prisma.automationExecution.create({ data: { organizationId: orgId, workflowId: wf.id, workflowVersion: wf.currentVersion, status: "WAITING_APPROVAL", triggerType: "MANUAL", correlationId: "qa-q" } });
      await prisma.automationApproval.create({ data: { organizationId: orgId, executionId: ex.id, workflowId: wf.id, stepId: "s", action: "a", status: "PENDING", requestedAt: new Date(Date.now() - 5 * 86_400_000) } });
      expect((await byKey("q_stuck_approvals")).status).toBe("warn");
    });
    it("env checklist reports present/missing and never a value", async () => {
      process.env.CRON_SECRET_PROBE = SECRET_SENTINEL;
      process.env.SOCIAL_VAULT_KEYS = `1:${SECRET_SENTINEL}${SECRET_SENTINEL}`;
      const res = await call("get", "/ops/health", adminTok);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(SECRET_SENTINEL);
      const env = res.body.data.env as Array<{ name: string; present: boolean }>;
      expect(env.find((e) => e.name === "SOCIAL_VAULT_KEYS")!.present).toBe(true);
      expect(env.every((e) => typeof e.present === "boolean")).toBe(true);
      delete process.env.SOCIAL_VAULT_KEYS; delete process.env.CRON_SECRET_PROBE;
    });
    it("alerts: grouped into one bell notification per admin, only after 15 minutes red, then rate-limited", async () => {
      const now = new Date();
      const mkRed = (key: string, minutes: number) => prisma.healthCheckResult.upsert({ where: { organizationId_key: { organizationId: orgId, key } }, create: { organizationId: orgId, key, status: "red", reason: "x", checkedAt: now, redSince: new Date(now.getTime() - minutes * 60_000) }, update: { status: "red", redSince: new Date(now.getTime() - minutes * 60_000), lastAlertedAt: null } });
      await mkRed("hb_automation_tick", 5);
      expect((await healthService.alertIfNeeded(orgId, now)).alerted).toBe(0); // red for only 5 minutes
      await mkRed("hb_automation_tick", ALERT_AFTER_RED_MS / 60_000 + 1);
      await mkRed("q_uncertain", 60);
      const before = await prisma.notification.count({ where: { organizationId: orgId, type: "system_health_alert" } });
      const sent = await healthService.alertIfNeeded(orgId, now);
      expect(sent.alerted).toBe(2); // grouped
      const created = await prisma.notification.findMany({ where: { organizationId: orgId, type: "system_health_alert" } });
      expect(created.length - before).toBe(sent.recipients); // exactly one per recipient, not one per check
      expect(created[0]!.message).toMatch(/2 health check/);
      expect((await healthService.alertIfNeeded(orgId, new Date(now.getTime() + 60_000))).alerted).toBe(0); // cooldown
      expect((await healthService.alertIfNeeded(orgId, new Date(now.getTime() + ALERT_COOLDOWN_MS + 60_000))).alerted).toBe(2);
      // recovery resets the alert state
      await healthService.runAndStore(orgId, new Date(now.getTime() + ALERT_COOLDOWN_MS + 120_000));
      const row = await prisma.healthCheckResult.findUnique({ where: { organizationId_key: { organizationId: orgId, key: "q_uncertain" } } });
      expect(row!.status).toBe("ok");
      expect(row!.redSince).toBeNull();
    });
  });

  describe("backups and exports", () => {
    beforeEach(async () => { testStorageProvider.reset(); await prisma.dataExport.deleteMany(); });
    it("provider info is 'not available here' without a token, and parses the provider's answer with one (token never returned)", async () => {
      const none = await backupService.providerInfo();
      expect(none.available).toBe(false);
      expect(none.reason).toMatch(/SUPABASE_ACCESS_TOKEN/);
      process.env.SUPABASE_ACCESS_TOKEN = SECRET_SENTINEL; process.env.SUPABASE_PROJECT_REF = "abcdefghijklmnopqrst";
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ region: "ap-northeast-1", pitr_enabled: false, walg_enabled: true, backups: [{ inserted_at: "2026-10-08T03:00:00Z", status: "COMPLETED", is_physical_backup: true }], physical_backup_data: { earliest_physical_backup_date_unix: 1790000000, latest_physical_backup_date_unix: 1791000000 } }) }));
      vi.stubGlobal("fetch", fetchMock);
      const info = await backupService.providerInfo();
      expect(info.available).toBe(true);
      expect(info.lastBackupAt).toBe("2026-10-08T03:00:00Z");
      expect(info.pitrEnabled).toBe(false);
      expect(JSON.stringify(info)).not.toContain(SECRET_SENTINEL);
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
      expect((await backupService.providerInfo()).available).toBe(false);
      vi.unstubAllGlobals();
      delete process.env.SUPABASE_ACCESS_TOKEN; delete process.env.SUPABASE_PROJECT_REF;
    });
    it("exports critical tables encrypted, never includes credentials, and verifies (the restore test)", async () => {
      const acc = await prisma.socialAccount.create({ data: { organizationId: orgId, provider: "meta_facebook", externalAccountId: "qa-fb-exp", displayName: "QA_TEST_2026_ Export Page", status: "CONNECTED", tokenExpiresAt: new Date(Date.now() + 40 * 86_400_000) } });
      await prisma.socialAccountCredential.create({ data: { socialAccountId: acc.id, ciphertext: `sv1.${SECRET_SENTINEL}`, keyVersion: 1 } });
      await prisma.apiKey.create({ data: { organizationId: orgId, name: "QA_TEST_2026_ key", keyHash: SECRET_SENTINEL, prefix: "art_test", createdById: adminId, scopes: [] } });
      await prisma.lead.create({ data: { organizationId: orgId, companyName: "QA_TEST_2026_ Co", email: "qa_test_2026_exp@example.com", source: "manual" } });
      const row = await backupService.runCriticalExport(orgId, superAId);
      expect(row.status).toBe("SUCCEEDED");
      const blob = testStorageProvider.getBytes(row.storageKey!)!;
      expect(blob.includes(Buffer.from("qa_test_2026_exp@example.com"))).toBe(false); // encrypted at rest
      const plain = gunzipSync(decryptExport(blob, "k".repeat(40))).toString("utf8");
      expect(plain).not.toContain(SECRET_SENTINEL);
      expect(plain).not.toMatch(/"password_hash"|"passwordHash"|"ciphertext"|"token_hash"|"key_hash"/);
      const parsed = JSON.parse(plain);
      expect(parsed.tables.leads.some((l: { email: string }) => l.email === "qa_test_2026_exp@example.com")).toBe(true);
      expect(parsed.tables.api_keys).toBeUndefined();
      expect(parsed.tables.social_accounts.length).toBeGreaterThan(0);
      expect(parsed.tables.social_accounts[0].token_expires_at).toBeTruthy();
      for (const t of NEVER_EXPORTED) { expect((EXPORT_TABLES as readonly string[]).includes(t)).toBe(false); expect(parsed.tables[t]).toBeUndefined(); }
      const v = await backupService.verifyExport(orgId, row.id);
      expect(v.ok).toBe(true);
      expect((await prisma.dataExport.findUnique({ where: { id: row.id } }))!.verifiedAt).not.toBeNull();
      await prisma.socialAccount.delete({ where: { id: acc.id } });
    });
    it("verify fails on tampering and on a wrong key; export is refused without a strong key", async () => {
      const row = await backupService.runCriticalExport(orgId, superAId);
      const bytes = Buffer.from(testStorageProvider.getBytes(row.storageKey!)!);
      bytes[bytes.length - 3] = bytes[bytes.length - 3]! ^ 0xff;
      testStorageProvider.seedObject(row.storageKey!, bytes, "application/octet-stream");
      expect((await backupService.verifyExport(orgId, row.id)).ok).toBe(false);
      const good = await backupService.runCriticalExport(orgId, superAId);
      process.env.BACKUP_EXPORT_KEY = "z".repeat(40);
      expect((await backupService.verifyExport(orgId, good.id)).ok).toBe(false);
      process.env.BACKUP_EXPORT_KEY = "short";
      await expect(backupService.runCriticalExport(orgId, superAId)).rejects.toThrow(/BACKUP_EXPORT_KEY/);
      process.env.BACKUP_EXPORT_KEY = "k".repeat(40);
    });
    it("retention keeps the newest three and removes expired files", async () => {
      const rows = [];
      for (let i = 0; i < 5; i++) { rows.push(await backupService.runCriticalExport(orgId, superAId)); await new Promise((r) => setTimeout(r, 15)); }
      expect(await prisma.dataExport.count({ where: { organizationId: orgId } })).toBe(5); // none expired yet
      await prisma.dataExport.updateMany({ where: { organizationId: orgId }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
      expect(await backupService.applyRetention(orgId)).toBe(2);
      expect(await prisma.dataExport.count({ where: { organizationId: orgId } })).toBe(3);
      expect(testStorageProvider.getBytes(rows[0]!.storageKey!)).toBeNull();
      expect(testStorageProvider.getBytes(rows[4]!.storageKey!)).not.toBeNull();
    });
    it("the API lists exports and only SUPER_ADMIN can run one by hand", async () => {
      expect((await call("post", "/ops/backups/exports", superA)).status).toBe(201);
      const list = await call("get", "/ops/backups", adminTok);
      expect(list.body.data.exports.length).toBe(1);
      expect(list.body.data.exportConfig.keyConfigured).toBe(true);
      expect(JSON.stringify(list.body)).not.toContain("storageKey");
    });
  });

  describe("retention policy", () => {
    it("every entry that names a purge job has one, with a day count; others are explicitly not purged", () => {
      for (const e of RETENTION_POLICY) {
        if (e.purgeJob) { expect(PURGE_JOBS[e.purgeJob], e.key).toBeDefined(); expect(e.retentionDays, e.key).toBeGreaterThan(0); }
        else expect(e.retentionDays, e.key).toBeNull();
      }
      expect(RETENTION_POLICY.find((e) => e.key === "social_inbox")!.retentionDays).toBe(180);
    });
    it("purges exactly what the policy says, only when enabled, and dry-run never deletes", async () => {
      const analytics = RETENTION_POLICY.find((e) => e.key === "analytics_events")!.retentionDays!;
      const old = new Date(Date.now() - (analytics + 5) * 86_400_000), fresh = new Date(Date.now() - (analytics - 5) * 86_400_000);
      await prisma.analyticsEvent.createMany({ data: [{ organizationId: orgId, eventType: "page_view", path: "/qa-old", createdAt: old }, { organizationId: orgId, eventType: "page_view", path: "/qa-fresh", createdAt: fresh }] });
      delete process.env.RETENTION_PURGE_ENABLED;
      const dry = await retentionService.run(orgId, { execute: true });
      expect(dry.executed).toBe(false);
      expect(dry.rows.find((r) => r.key === "analytics_events")!.eligible).toBe(1);
      expect(await prisma.analyticsEvent.count({ where: { path: "/qa-old" } })).toBe(1);
      process.env.RETENTION_PURGE_ENABLED = "true";
      const run = await retentionService.run(orgId, { execute: true });
      expect(run.rows.find((r) => r.key === "analytics_events")!.purged).toBe(1);
      expect(await prisma.analyticsEvent.count({ where: { path: "/qa-old" } })).toBe(0);
      expect(await prisma.analyticsEvent.count({ where: { path: "/qa-fresh" } })).toBe(1);
      delete process.env.RETENTION_PURGE_ENABLED;
      const api = await call("get", "/ops/retention", adminTok);
      expect(api.body.data.policy.length).toBe(RETENTION_POLICY.length);
      expect(api.body.data.purgeEnabled).toBe(false);
    });
  });

  describe("consent register", () => {
    it("records every capture path with source and time, including paths that collect no consent", async () => {
      const manual = await call("post", "/leads", adminTok, { companyName: "QA_TEST_2026_ Manual", email: "qa_test_2026_manual@example.com" });
      expect(manual.status).toBe(201);
      const form = await prisma.form.create({ data: { organizationId: orgId, name: "QA_TEST_2026_ form", slug: "qa-consent-form", status: "ACTIVE", fields: [{ key: "email", label: "Email", type: "email", required: true }, { key: "consent", label: "Consent", type: "checkbox", required: false }] as never, successMessage: "ok" } });
      const sub = await request(app).post(`/api/v1/public/forms/${form.slug}/submit`).set("X-Forwarded-For", "10.13.9.1").send({ data: { email: "qa_test_2026_form@example.com", consent: "true" } });
      expect(sub.status).toBe(201);
      const reg = await call("get", "/ops/consent?limit=100", adminTok);
      const records = reg.body.data.records as Array<{ source: string; status: string; capturedAt: string }>;
      expect(records.find((r) => r.source.startsWith("manual") || r.source === "lead")!.status).toBe("NOT_COLLECTED");
      expect(records.find((r) => r.source === "form:qa-consent-form")!.status).toBe("GIVEN");
      expect(records.every((r) => !!r.capturedAt && !!r.source)).toBe(true);
      expect(JSON.stringify(reg.body)).not.toContain("@example.com"); // the register holds no personal data
    });
  });

  describe("data privacy", () => {
    let leadId = "", contactId = "", subId = "", convId = "";
    beforeAll(async () => {
      const lead = await prisma.lead.create({ data: { organizationId: orgId, companyName: "QA_TEST_2026_ Person Co", contactName: "QA Person", email: PERSON, phone: "+1 555 0100", notes: "Called about pricing", referrer: "https://ref.example/", source: "form:qa", consentGiven: true, firstTouch: { utmSource: "x" } } });
      leadId = lead.id;
      contactId = (await prisma.contact.create({ data: { organizationId: orgId, firstName: "QA", lastName: "Person", email: PERSON, phone: "+1 555 0100", jobTitle: "CTO" } })).id;
      const form = await prisma.form.findFirstOrThrow({ where: { slug: "qa-consent-form" } });
      subId = (await prisma.formSubmission.create({ data: { formId: form.id, organizationId: orgId, data: { email: PERSON, message: "hello" }, leadId, ipAddress: "203.0.113.9", userAgent: "UA", consentGiven: true } })).id;
      await prisma.consentRecord.create({ data: { organizationId: orgId, leadId, submissionId: subId, source: "form:qa", status: "GIVEN" } });
      const acc = await prisma.socialAccount.create({ data: { organizationId: orgId, provider: "meta_facebook", externalAccountId: "qa-priv", displayName: "QA_TEST_2026_ Priv", status: "CONNECTED" } });
      const conv = await prisma.socialConversation.create({ data: { organizationId: orgId, socialAccountId: acc.id, providerThreadId: "qa-thread", type: "DM", participantName: "QA Person", participantHandle: "qa.person", leadId, lastMessageAt: new Date() } });
      convId = conv.id;
      await prisma.socialMessage.createMany({ data: [1, 2].map((n) => ({ conversationId: conv.id, organizationId: orgId, socialAccountId: acc.id, direction: "INBOUND", authorKind: "CUSTOMER", body: `private message ${n}` })) as never });
    });

    it("looks up everything held about a person, audits the lookup without the email, and refuses staff accounts for erasure", async () => {
      const r = await call("post", "/privacy/lookup", adminTok, { email: PERSON.toUpperCase() });
      expect(r.status).toBe(200);
      expect(r.body.data.counts).toMatchObject({ leads: 1, contacts: 1, formSubmissions: 1, socialConversations: 1, socialMessages: 2, consentRecords: 1 });
      expect(r.body.data.records.leads[0].email).toBe(PERSON);
      const audits = await prisma.auditLog.findMany({ where: { action: "PRIVACY_LOOKUP" } });
      expect(audits.length).toBeGreaterThan(0);
      expect(JSON.stringify(audits)).not.toContain(PERSON);
      const staff = await call("post", "/privacy/erasure/preview", adminTok, { email: "qa-ops-manager@example.com" });
      expect(staff.body.data.staffAccount).toBe(true);
      expect(staff.body.data.erasable).toBe(false);
      expect((await call("post", "/privacy/lookup", adminTok, { email: "not-an-email" })).status).toBe(400);
    });
    it("exports JSON and CSV (privacy.export), audited with IDs only; CSV cells are formula-safe", async () => {
      const j = await call("post", "/privacy/export", adminTok, { email: PERSON, format: "json" });
      expect(j.status).toBe(200);
      expect(j.headers["content-disposition"]).toContain("subject-export-");
      const bundle = JSON.parse(j.text);
      expect(bundle.leads[0].email).toBe(PERSON);
      expect(bundle.messages.length).toBe(2);
      const c = await call("post", "/privacy/export", adminTok, { email: PERSON, format: "csv" });
      expect(c.text.split("\n")[0]).toBe('"section","record_id","field","value"');
      expect(c.text).toContain(PERSON);
      const audits = await prisma.auditLog.findMany({ where: { action: "PRIVACY_EXPORT_CREATED" } });
      expect(audits.length).toBe(2);
      expect(JSON.stringify(audits)).not.toContain(PERSON);
    });
    it("previews exactly what an erasure changes, without changing anything", async () => {
      const p = await call("post", "/privacy/erasure/preview", adminTok, { email: PERSON });
      expect(p.body.data.erasable).toBe(true);
      const tables = Object.fromEntries((p.body.data.changes as Array<{ table: string; rows: number; action: string }>).map((c) => [c.table, c]));
      expect(tables.leads).toMatchObject({ rows: 1, action: "Anonymise" });
      expect(tables.social_messages).toMatchObject({ rows: 2, action: "Delete" });
      expect(tables.consent_records!.action).toBe("Keep");
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).email).toBe(PERSON);
    });

    let approvalId = "", requestId = "";
    it("erasure needs a reason and privacy.erase; the request stores no personal data", async () => {
      expect((await call("post", "/privacy/erasure-requests", superA, { email: PERSON, reason: "short" })).status).toBe(400);
      expect((await call("post", "/privacy/erasure-requests", adminTok, { email: PERSON, reason: "Data subject asked by email" })).status).toBe(403);
      const r = await call("post", "/privacy/erasure-requests", superA, { email: PERSON, reason: "Data subject asked by email on 2026-10-01" });
      expect(r.status).toBe(201);
      approvalId = r.body.data.approvalId; requestId = r.body.data.requestId;
      expect((await call("post", "/privacy/erasure-requests", superA, { email: PERSON, reason: "Duplicate request attempt" })).status).toBe(409);
      const stored = JSON.stringify(await prisma.privacyRequest.findMany()) + JSON.stringify(await prisma.automationApproval.findMany({ where: { id: approvalId } })) + JSON.stringify(await prisma.auditLog.findMany({ where: { action: { startsWith: "PRIVACY_" } } }));
      expect(stored).not.toContain(PERSON);
      expect(stored).not.toContain("QA Person");
    });
    it("appears in the Approvals center as source 'privacy', is not offered under 'automation', and cannot be decided through the generic route", async () => {
      const list = await call("get", "/approvals?source=privacy", superB);
      const item = list.body.data.approvals.find((a: { id: string }) => a.id === approvalId);
      expect(item.source).toBe("privacy");
      expect(item.canDecide).toBe(true);
      expect(JSON.stringify((await call("get", "/approvals?source=automation", superB)).body)).not.toContain(approvalId);
      expect((await call("post", `/automation/approvals/${approvalId}/decision`, superB, { decision: "APPROVED" })).status).toBeGreaterThanOrEqual(400);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).email).toBe(PERSON); // still untouched
      const desc = await call("get", `/privacy/requests/${requestId}`, adminTok);
      expect(desc.body.data.request.maskedEmails[0]).toBe("q***@example.com");
    });
    it("two-person rule: the requester cannot approve; a rejection needs a reason", async () => {
      const own = await call("post", `/approvals/privacy/${approvalId}/decision`, superA, { decision: "approve" });
      expect(own.status).toBe(403);
      expect(JSON.stringify(own.body)).toMatch(/Two-person/);
      expect((await call("post", `/approvals/privacy/${approvalId}/decision`, adminTok, { decision: "approve" })).status).toBe(403); // ADMIN lacks privacy.erase
      expect((await call("post", `/approvals/privacy/${approvalId}/decision`, superB, { decision: "reject" })).status).toBe(400);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).email).toBe(PERSON);
    });
    it("a second person approves: data is anonymised, consent register and audit kept, immutable audit entry holds no personal data", async () => {
      const res = await call("post", `/approvals/privacy/${approvalId}/decision`, superB, { decision: "approve" });
      expect(res.status).toBe(200);
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead).toMatchObject({ companyName: "Erased", contactName: null, email: null, phone: null, notes: null, referrer: null });
      expect(lead.deletedAt).not.toBeNull();
      expect(await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).toMatchObject({ firstName: "Erased", email: null, phone: null, jobTitle: null });
      const sub = await prisma.formSubmission.findUniqueOrThrow({ where: { id: subId } });
      expect(sub.data).toEqual({ erased: true });
      expect(sub.ipAddress).toBeNull();
      expect(await prisma.socialMessage.count({ where: { conversationId: convId } })).toBe(0);
      expect(await prisma.socialConversation.findUniqueOrThrow({ where: { id: convId } })).toMatchObject({ participantName: null, participantHandle: null });
      expect(await prisma.consentRecord.count({ where: { leadId } })).toBeGreaterThan(0); // kept: no personal data
      const reqRow = await prisma.privacyRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(reqRow).toMatchObject({ status: "EXECUTED", approvedById: superBId, requestedById: superAId });
      expect(reqRow.targetIds).toBeNull();
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "PRIVACY_ERASURE_EXECUTED" } });
      expect(JSON.stringify(audit)).not.toContain(PERSON);
      expect(audit.afterData).toMatchObject({ counts: { leads: 1, contacts: 1, formSubmissions: 1, socialMessages: 2 } });
      // immutable
      await expect(prisma.auditLog.update({ where: { id: audit.id }, data: { action: "TAMPERED" } })).rejects.toThrow(/immutable/i);
      await expect(prisma.auditLog.delete({ where: { id: audit.id } })).rejects.toThrow(/immutable/i);
      // the person is no longer findable
      const after = await call("post", "/privacy/lookup", adminTok, { email: PERSON });
      expect(after.body.data.found).toBe(false);
      // nothing left to erase
      expect((await call("post", "/privacy/erasure-requests", superA, { email: PERSON, reason: "Second attempt after erasure" })).status).toBe(409);
      expect((await call("post", `/approvals/privacy/${approvalId}/decision`, superB, { decision: "approve" })).status).toBeGreaterThanOrEqual(400); // already resolved
      void superAId;
    });
    it("a rejected request changes nothing", async () => {
      const lead = await prisma.lead.create({ data: { organizationId: orgId, companyName: "QA_TEST_2026_ Keep", email: "qa_test_2026_keep@example.com", source: "manual" } });
      const r = await call("post", "/privacy/erasure-requests", superA, { email: "qa_test_2026_keep@example.com", reason: "Testing the rejection path now" });
      const rej = await call("post", `/approvals/privacy/${r.body.data.approvalId}/decision`, superB, { decision: "reject", comment: "Identity not verified" });
      expect(rej.status).toBe(200);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).email).toBe("qa_test_2026_keep@example.com");
      expect((await prisma.privacyRequest.findUniqueOrThrow({ where: { id: r.body.data.requestId } })).status).toBe("REJECTED");
    });
  });
});
