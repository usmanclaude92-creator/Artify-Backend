-- CreateEnum
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
