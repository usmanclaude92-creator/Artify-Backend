-- Phase 11 (Case Studies + Content Relationships) — additive only.
-- Widens the exactly-one-parent CHECK constraint on content_revisions to
-- accept case_study_id as a third valid parent, and adds the CaseStudy
-- tables + join tables. No existing column, table, or row is altered or
-- dropped.

-- AlterTable
ALTER TABLE "content_revisions" ADD COLUMN     "case_study_id" TEXT;

-- CreateTable
CREATE TABLE "case_studies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "client_name" TEXT,
    "industry_id" TEXT,
    "current_revision_id" TEXT,
    "featured_media_id" TEXT,
    "created_by" TEXT,
    "published_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "case_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_study_products" (
    "case_study_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,

    CONSTRAINT "case_study_products_pkey" PRIMARY KEY ("case_study_id","product_id")
);

-- CreateTable
CREATE TABLE "case_study_related_pages" (
    "case_study_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,

    CONSTRAINT "case_study_related_pages_pkey" PRIMARY KEY ("case_study_id","page_id")
);

-- CreateTable
CREATE TABLE "case_study_related_posts" (
    "case_study_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,

    CONSTRAINT "case_study_related_posts_pkey" PRIMARY KEY ("case_study_id","post_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "case_studies_current_revision_id_key" ON "case_studies"("current_revision_id");

-- CreateIndex
CREATE INDEX "case_studies_organization_id_status_idx" ON "case_studies"("organization_id", "status");

-- CreateIndex
CREATE INDEX "case_studies_industry_id_idx" ON "case_studies"("industry_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_studies_organization_id_slug_key" ON "case_studies"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "case_study_products_product_id_idx" ON "case_study_products"("product_id");

-- CreateIndex
CREATE INDEX "case_study_related_pages_page_id_idx" ON "case_study_related_pages"("page_id");

-- CreateIndex
CREATE INDEX "case_study_related_posts_post_id_idx" ON "case_study_related_posts"("post_id");

-- CreateIndex
CREATE INDEX "content_revisions_case_study_id_idx" ON "content_revisions"("case_study_id");

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "content_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_featured_media_id_fkey" FOREIGN KEY ("featured_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_products" ADD CONSTRAINT "case_study_products_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_products" ADD CONSTRAINT "case_study_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_related_pages" ADD CONSTRAINT "case_study_related_pages_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_related_pages" ADD CONSTRAINT "case_study_related_pages_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_related_posts" ADD CONSTRAINT "case_study_related_posts_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_study_related_posts" ADD CONSTRAINT "case_study_related_posts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Widen the exactly-one-parent CHECK constraint (originally
-- num_nonnulls(page_id, post_id) = 1, added in
-- 20260920000001_phase2_core_data_model) to accept case_study_id as a
-- third valid, mutually-exclusive parent. Every existing row already has
-- case_study_id = NULL, so this is a no-op for all current data.
ALTER TABLE "content_revisions" DROP CONSTRAINT "content_revisions_exactly_one_parent";
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_exactly_one_parent" CHECK (num_nonnulls("page_id", "post_id", "case_study_id") = 1);
