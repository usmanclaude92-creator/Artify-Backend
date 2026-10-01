/**
 * One-time catch-up for 5 migrations that were merged into prisma/migrations
 * but never applied to production (confirmed via Vercel runtime logs: P2021
 * "table does not exist" on template_parts). `prisma migrate deploy` can't
 * run against this environment's DATABASE_URL — it's a Supabase PgBouncer
 * transaction-mode pooler (port 6543), which doesn't support the
 * session-level advisory lock `migrate deploy` takes, so it hangs
 * indefinitely (confirmed: a real deploy sat "BUILDING" for 6+ minutes with
 * no progress past the lock-acquire step). There is no direct/non-pooled
 * connection string configured for this project to give it instead.
 *
 * Plain DDL via $executeRawUnsafe doesn't take that lock, so it runs fine
 * over the same pooled connection every other query already uses. Each
 * migration's SQL is embedded verbatim (not read from disk — the
 * prisma/migrations directory isn't guaranteed to exist in the deployed
 * Lambda's filesystem) and applied exactly as Prisma generated it, then
 * recorded in _prisma_migrations with the same checksum Prisma itself
 * would compute, so `prisma migrate deploy` (once a direct connection is
 * available) sees these as already-applied rather than re-running them.
 */
import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "20260927000000_add_email_indexes",
    sql: `-- Lead/Client/Contact lookups by email (dedup checks, search, portal
-- account resolution) were doing full table scans. Add supporting indexes.
CREATE INDEX "leads_email_idx" ON "leads"("email");
CREATE INDEX "clients_email_idx" ON "clients"("email");
CREATE INDEX "contacts_email_idx" ON "contacts"("email");
`,
  },
  {
    name: "20260927084351_phase5_seo_redirects",
    sql: `-- CreateTable
CREATE TABLE "redirects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "from_path" TEXT NOT NULL,
    "to_path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL DEFAULT 301,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "redirects_organization_id_idx" ON "redirects"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "redirects_organization_id_from_path_key" ON "redirects"("organization_id", "from_path");

-- AddForeignKey
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
`,
  },
  {
    name: "20260927090855_phase7_crm_opportunities",
    sql: `-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('PROSPECTING', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "name" TEXT NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'PROSPECTING',
    "value" DECIMAL(18,3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expected_close_date" DATE,
    "actual_close_date" TIMESTAMP(3),
    "lost_reason" TEXT,
    "notes" TEXT,
    "assigned_to" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunities_organization_id_idx" ON "opportunities"("organization_id");

-- CreateIndex
CREATE INDEX "opportunities_stage_idx" ON "opportunities"("stage");

-- CreateIndex
CREATE INDEX "opportunities_client_id_idx" ON "opportunities"("client_id");

-- CreateIndex
CREATE INDEX "opportunities_assigned_to_idx" ON "opportunities"("assigned_to");

-- CreateIndex
CREATE INDEX "opportunities_created_at_idx" ON "opportunities"("created_at");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
`,
  },
  {
    name: "20260927153805_phase9_forms",
    sql: `-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "forms" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "FormStatus" NOT NULL DEFAULT 'ACTIVE',
    "fields" JSONB NOT NULL,
    "success_message" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "lead_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forms_organization_id_idx" ON "forms"("organization_id");

-- CreateIndex
CREATE INDEX "forms_status_idx" ON "forms"("status");

-- CreateIndex
CREATE UNIQUE INDEX "forms_organization_id_slug_key" ON "forms"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "form_submissions_organization_id_idx" ON "form_submissions"("organization_id");

-- CreateIndex
CREATE INDEX "form_submissions_form_id_idx" ON "form_submissions"("form_id");

-- CreateIndex
CREATE INDEX "form_submissions_created_at_idx" ON "form_submissions"("created_at");

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
`,
  },
  {
    name: "20260929201224_phase1_templates_and_template_parts",
    sql: `-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('STANDARD', 'LANDING');

-- CreateEnum
CREATE TYPE "TemplateType" AS ENUM ('HOMEPAGE', 'STANDARD_PAGE', 'BLOG_INDEX', 'SINGLE_POST', 'CATEGORY', 'TAG', 'SEARCH', 'ARCHIVE', 'AUTHOR', 'NOT_FOUND', 'PRODUCT', 'SERVICE', 'SOLUTION', 'CASE_STUDY', 'LANDING_PAGE');

-- CreateEnum
CREATE TYPE "TemplatePartType" AS ENUM ('HEADER', 'FOOTER', 'PRIMARY_NAVIGATION', 'MOBILE_HEADER', 'SIDEBAR', 'ANNOUNCEMENT_BAR', 'CTA_SECTION', 'NEWSLETTER_SECTION', 'CONTACT_SECTION', 'SOCIAL_SECTION');

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "is_homepage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "page_type" "PageType" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "template_id" TEXT;

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "TemplateType" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "current_revision_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_revisions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL,
    "name" TEXT NOT NULL,
    "structure" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "template_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_parts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "TemplatePartType" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "current_revision_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "template_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_part_revisions" (
    "id" TEXT NOT NULL,
    "template_part_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "template_part_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "templates_current_revision_id_key" ON "templates"("current_revision_id");

-- CreateIndex
CREATE INDEX "templates_organization_id_status_idx" ON "templates"("organization_id", "status");

-- CreateIndex
CREATE INDEX "templates_organization_id_type_idx" ON "templates"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "templates_organization_id_slug_key" ON "templates"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "template_revisions_template_id_idx" ON "template_revisions"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "template_parts_current_revision_id_key" ON "template_parts"("current_revision_id");

-- CreateIndex
CREATE INDEX "template_parts_organization_id_status_idx" ON "template_parts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "template_parts_organization_id_type_idx" ON "template_parts"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "template_parts_organization_id_slug_key" ON "template_parts"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "template_part_revisions_template_part_id_idx" ON "template_part_revisions"("template_part_id");

-- CreateIndex
CREATE INDEX "pages_template_id_idx" ON "pages"("template_id");

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "template_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_revisions" ADD CONSTRAINT "template_revisions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_revisions" ADD CONSTRAINT "template_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_parts" ADD CONSTRAINT "template_parts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_parts" ADD CONSTRAINT "template_parts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_parts" ADD CONSTRAINT "template_parts_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "template_part_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_part_revisions" ADD CONSTRAINT "template_part_revisions_template_part_id_fkey" FOREIGN KEY ("template_part_id") REFERENCES "template_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_part_revisions" ADD CONSTRAINT "template_part_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-added partial unique index (Prisma has no native syntax for this —
-- same pattern as workspace_invitations_one_pending_per_email in
-- 20260923000001_phase6_onboarding_workspace/migration.sql): at most one
-- non-deleted page per organization may have is_homepage = true. Existing
-- rows are all is_homepage = false (the column's own DEFAULT), so this can
-- never conflict with data that already exists.
CREATE UNIQUE INDEX "pages_one_homepage_per_org" ON "pages"("organization_id") WHERE "is_homepage" = true AND "deleted_at" IS NULL;
`,
  },
];

/** Strips `-- ...` comment-only lines, then splits on statement-terminating semicolons. */
function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface PendingMigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function applyPendingMigrations(prisma: PrismaClient): Promise<PendingMigrationResult> {
  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const migration of MIGRATIONS) {
    const existing = await prisma.$queryRaw<{ finished_at: Date | null }[]>`
      SELECT finished_at FROM _prisma_migrations WHERE migration_name = ${migration.name} LIMIT 1
    `;
    if (existing.length > 0 && existing[0]!.finished_at !== null) {
      alreadyApplied.push(migration.name);
      continue;
    }

    const statements = splitStatements(migration.sql);
    for (const statement of statements) {
      await prisma.$executeRawUnsafe(statement);
    }

    const checksum = createHash("sha256").update(migration.sql).digest("hex");
    await prisma.$executeRaw`
      INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
      VALUES (gen_random_uuid()::text, ${checksum}, ${migration.name}, now(), now(), ${statements.length})
    `;
    applied.push(migration.name);
  }

  return { applied, alreadyApplied };
}
