/** Phase 9 (MVP slice) — Form CRUD/RBAC/tenant isolation, and public submission reusing the Lead-intake pattern with UTM capture. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, finalizeApp } from "../../server/app/app";
import { disconnectPrisma, prisma } from "../../server/db/prisma";
import { resetDb } from "../helpers/db";

const CONTACT_FIELDS = [
  { key: "name", label: "Full name", type: "text", required: true },
  { key: "email", label: "Email", type: "email", required: true },
  { key: "message", label: "Message", type: "textarea", required: false },
];

describe("Forms (Phase 9 MVP slice)", () => {
  const app = createApp();
  finalizeApp(app);

  let adminToken: string;
  let managerToken: string;
  let userToken: string;
  let viewerToken: string;
  let otherOrgAdminToken: string;

  beforeAll(async () => {
    await resetDb();
    const reg = await request(app).post("/api/v1/auth/register").send({
      email: "forms-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Forms",
      lastName: "Admin",
      organizationName: "Forms Admin Co",
    });
    adminToken = reg.body.data.session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "forms-manager@example.com", password: "MgrPassword123", firstName: "M", lastName: "Gr", roleKey: "MANAGER" });
    managerToken = (await request(app).post("/api/v1/auth/login").send({ email: "forms-manager@example.com", password: "MgrPassword123" })).body.data
      .session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "forms-user@example.com", password: "UserPassword123", firstName: "U", lastName: "Ser", roleKey: "USER" });
    userToken = (await request(app).post("/api/v1/auth/login").send({ email: "forms-user@example.com", password: "UserPassword123" })).body.data
      .session.token;

    await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ email: "forms-viewer@example.com", password: "ViewerPassword123", firstName: "V", lastName: "Wr", roleKey: "VIEWER" });
    viewerToken = (await request(app).post("/api/v1/auth/login").send({ email: "forms-viewer@example.com", password: "ViewerPassword123" })).body
      .data.session.token;

    const otherOrg = await request(app).post("/api/v1/auth/register").send({
      email: "forms-other-admin@example.com",
      password: "OriginalPassword123",
      firstName: "Other",
      lastName: "Admin",
      organizationName: "Other Forms Org",
    });
    otherOrgAdminToken = otherOrg.body.data.session.token;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  describe("CRUD + RBAC + tenant isolation", () => {
    it("creates a form with an auto-generated slug, and audits FORM_CREATED", async () => {
      const res = await request(app)
        .post("/api/v1/forms")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Contact Us", fields: CONTACT_FIELDS });
      expect(res.status).toBe(201);
      expect(res.body.data.form.slug).toBe("contact-us");
      expect(res.body.data.form.status).toBe("ACTIVE");

      const audit = await prisma.auditLog.findFirst({ where: { action: "FORM_CREATED", resourceId: res.body.data.form.id } });
      expect(audit).not.toBeNull();
    });

    it("rejects fields with no name/email key, duplicate keys, or an empty array", async () => {
      const noIdentity = await request(app)
        .post("/api/v1/forms")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Bad Form", fields: [{ key: "message", label: "Message", type: "textarea", required: false }] });
      expect(noIdentity.status).toBe(400);

      const dupKeys = await request(app)
        .post("/api/v1/forms")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Dup Form",
          fields: [
            { key: "email", label: "Email", type: "email", required: true },
            { key: "email", label: "Email Again", type: "email", required: false },
          ],
        });
      expect(dupKeys.status).toBe(400);

      const empty = await request(app).post("/api/v1/forms").set("Authorization", `Bearer ${adminToken}`).send({ name: "Empty Form", fields: [] });
      expect(empty.status).toBe(400);
    });

    it("rejects a duplicate slug within the same organization with a clean 409", async () => {
      await request(app).post("/api/v1/forms").set("Authorization", `Bearer ${adminToken}`).send({ name: "Dup Slug", slug: "dup-slug", fields: CONTACT_FIELDS });
      const dupe = await request(app)
        .post("/api/v1/forms")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Dup Slug Two", slug: "dup-slug", fields: CONTACT_FIELDS });
      expect(dupe.status).toBe(409);
    });

    it("updates and archives a form, auditing FORM_UPDATED", async () => {
      const created = await request(app).post("/api/v1/forms").set("Authorization", `Bearer ${adminToken}`).send({ name: "Mutable Form", fields: CONTACT_FIELDS });
      const id = created.body.data.form.id;

      const updated = await request(app).patch(`/api/v1/forms/${id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ARCHIVED" });
      expect(updated.status).toBe(200);
      expect(updated.body.data.form.status).toBe("ARCHIVED");

      const audit = await prisma.auditLog.findFirst({ where: { action: "FORM_UPDATED", resourceId: id } });
      expect(audit).not.toBeNull();
    });

    it("deletes a form (ADMIN-only), auditing FORM_DELETED", async () => {
      const created = await request(app).post("/api/v1/forms").set("Authorization", `Bearer ${adminToken}`).send({ name: "Deletable Form", fields: CONTACT_FIELDS });
      const id = created.body.data.form.id;

      const managerDelete = await request(app).delete(`/api/v1/forms/${id}`).set("Authorization", `Bearer ${managerToken}`);
      expect(managerDelete.status).toBe(403);

      const adminDelete = await request(app).delete(`/api/v1/forms/${id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(adminDelete.status).toBe(200);

      const gone = await request(app).get(`/api/v1/forms/${id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(gone.status).toBe(404);

      const audit = await prisma.auditLog.findFirst({ where: { action: "FORM_DELETED", resourceId: id } });
      expect(audit).not.toBeNull();
    });

    it("USER and VIEWER can read but not create forms; a form never leaks across organizations", async () => {
      const created = await request(app).post("/api/v1/forms").set("Authorization", `Bearer ${adminToken}`).send({ name: "Tenant Scoped", fields: CONTACT_FIELDS });
      const id = created.body.data.form.id;

      const userRead = await request(app).get(`/api/v1/forms/${id}`).set("Authorization", `Bearer ${userToken}`);
      expect(userRead.status).toBe(200);
      const viewerRead = await request(app).get(`/api/v1/forms/${id}`).set("Authorization", `Bearer ${viewerToken}`);
      expect(viewerRead.status).toBe(200);

      const userCreate = await request(app).post("/api/v1/forms").set("Authorization", `Bearer ${userToken}`).send({ name: "Nope", fields: CONTACT_FIELDS });
      expect(userCreate.status).toBe(403);
      const viewerCreate = await request(app).post("/api/v1/forms").set("Authorization", `Bearer ${viewerToken}`).send({ name: "Nope", fields: CONTACT_FIELDS });
      expect(viewerCreate.status).toBe(403);

      const crossOrgRead = await request(app).get(`/api/v1/forms/${id}`).set("Authorization", `Bearer ${otherOrgAdminToken}`);
      expect(crossOrgRead.status).toBe(404);
    });
  });

  describe("public submission (reuses the Lead-intake pattern)", () => {
    it("creates a FormSubmission + a real CRM Lead, captures UTM params, and folds them into the Lead's source/notes", async () => {
      const { config } = await import("../../server/config/env");
      if (!config.publicWebsiteOrganizationId) return; // not configured in this env — see .env.test
      await prisma.organization.upsert({
        where: { id: config.publicWebsiteOrganizationId },
        update: {},
        create: { id: config.publicWebsiteOrganizationId, name: "Public Test Agency", slug: "forms-test-public-agency" },
      });

      const form = await prisma.form.create({
        data: {
          organizationId: config.publicWebsiteOrganizationId,
          name: "Public Contact Form",
          slug: "public-contact",
          fields: CONTACT_FIELDS,
        },
      });

      const res = await request(app)
        .post(`/api/v1/public/forms/${form.slug}/submit`)
        .send({
          data: { name: "Jane Visitor", email: "jane@example.com", message: "Interested in a demo." },
          utmSource: "google",
          utmMedium: "cpc",
          utmCampaign: "spring-launch",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.message).toBeTruthy();

      const submission = await prisma.formSubmission.findFirst({ where: { formId: form.id } });
      expect(submission).not.toBeNull();
      expect(submission?.utmSource).toBe("google");
      expect(submission?.utmCampaign).toBe("spring-launch");
      expect(submission?.leadId).not.toBeNull();

      const lead = await prisma.lead.findUnique({ where: { id: submission!.leadId! } });
      expect(lead).not.toBeNull();
      expect(lead?.email).toBe("jane@example.com");
      expect(lead?.contactName).toBe("Jane Visitor");
      expect(lead?.source).toBe("form:public-contact:google");
      expect(lead?.notes).toContain("Interested in a demo.");
      expect(lead?.notes).toContain("UTM: source=google, medium=cpc, campaign=spring-launch");
    });

    it("rejects a submission missing a required field", async () => {
      const { config } = await import("../../server/config/env");
      if (!config.publicWebsiteOrganizationId) return;
      const form = await prisma.form.upsert({
        where: { organizationId_slug: { organizationId: config.publicWebsiteOrganizationId, slug: "required-field-form" } },
        update: {},
        create: { organizationId: config.publicWebsiteOrganizationId, name: "Required Field Form", slug: "required-field-form", fields: CONTACT_FIELDS },
      });
      const res = await request(app)
        .post(`/api/v1/public/forms/${form.slug}/submit`)
        .send({ data: { name: "No Email Here" } });
      expect(res.status).toBe(400);
    });

    it("silently discards a honeypot-triggered submission (same success response, nothing written)", async () => {
      const { config } = await import("../../server/config/env");
      if (!config.publicWebsiteOrganizationId) return;
      const form = await prisma.form.upsert({
        where: { organizationId_slug: { organizationId: config.publicWebsiteOrganizationId, slug: "honeypot-form" } },
        update: {},
        create: { organizationId: config.publicWebsiteOrganizationId, name: "Honeypot Form", slug: "honeypot-form", fields: CONTACT_FIELDS },
      });
      const before = await prisma.formSubmission.count({ where: { formId: form.id } });

      const res = await request(app)
        .post(`/api/v1/public/forms/${form.slug}/submit`)
        .send({ data: { name: "Bot", email: "bot@example.com" }, website: "http://spam.example" });
      expect(res.status).toBe(201);

      const after = await prisma.formSubmission.count({ where: { formId: form.id } });
      expect(after).toBe(before);
    });

    it("404s for an unknown slug and for an ARCHIVED form", async () => {
      const { config } = await import("../../server/config/env");
      if (!config.publicWebsiteOrganizationId) return;

      const unknown = await request(app).post("/api/v1/public/forms/never-existed/submit").send({ data: { name: "X", email: "x@example.com" } });
      expect(unknown.status).toBe(404);

      const archived = await prisma.form.upsert({
        where: { organizationId_slug: { organizationId: config.publicWebsiteOrganizationId, slug: "archived-form" } },
        update: { status: "ARCHIVED" },
        create: { organizationId: config.publicWebsiteOrganizationId, name: "Archived Form", slug: "archived-form", fields: CONTACT_FIELDS, status: "ARCHIVED" },
      });
      const res = await request(app).post(`/api/v1/public/forms/${archived.slug}/submit`).send({ data: { name: "X", email: "x@example.com" } });
      expect(res.status).toBe(404);
    });
  });
});
