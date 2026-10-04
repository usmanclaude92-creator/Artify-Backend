-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('EMAIL', 'SOCIAL', 'PAID_SEARCH', 'PAID_SOCIAL', 'CONTENT', 'EVENT', 'REFERRAL', 'DIRECT', 'OTHER');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "campaign_id" TEXT;

-- AlterTable
ALTER TABLE "form_submissions" ADD COLUMN     "campaign_id" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "campaign_id" TEXT;

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "campaign_id" TEXT;

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "channel" "CampaignChannel" NOT NULL DEFAULT 'OTHER',
    "start_date" DATE,
    "end_date" DATE,
    "owner_id" TEXT,
    "budget" DECIMAL(18,3),
    "currency" CHAR(3),
    "landing_page_id" TEXT,
    "form_id" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "utm_term" TEXT,
    "utm_content" TEXT,
    "target_audience" TEXT,
    "notes" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_products" (
    "campaign_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,

    CONSTRAINT "campaign_products_pkey" PRIMARY KEY ("campaign_id","product_id")
);

-- CreateTable
CREATE TABLE "campaign_related_pages" (
    "campaign_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,

    CONSTRAINT "campaign_related_pages_pkey" PRIMARY KEY ("campaign_id","page_id")
);

-- CreateTable
CREATE TABLE "campaign_related_posts" (
    "campaign_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,

    CONSTRAINT "campaign_related_posts_pkey" PRIMARY KEY ("campaign_id","post_id")
);

-- CreateTable
CREATE TABLE "campaign_related_case_studies" (
    "campaign_id" TEXT NOT NULL,
    "case_study_id" TEXT NOT NULL,

    CONSTRAINT "campaign_related_case_studies_pkey" PRIMARY KEY ("campaign_id","case_study_id")
);

-- CreateTable
CREATE TABLE "campaign_media" (
    "campaign_id" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,

    CONSTRAINT "campaign_media_pkey" PRIMARY KEY ("campaign_id","media_id")
);

-- CreateIndex
CREATE INDEX "campaigns_organization_id_status_idx" ON "campaigns"("organization_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_organization_id_utm_campaign_idx" ON "campaigns"("organization_id", "utm_campaign");

-- CreateIndex
CREATE INDEX "campaigns_owner_id_idx" ON "campaigns"("owner_id");

-- CreateIndex
CREATE INDEX "campaigns_landing_page_id_idx" ON "campaigns"("landing_page_id");

-- CreateIndex
CREATE INDEX "campaigns_form_id_idx" ON "campaigns"("form_id");

-- CreateIndex
CREATE INDEX "campaign_products_product_id_idx" ON "campaign_products"("product_id");

-- CreateIndex
CREATE INDEX "campaign_related_pages_page_id_idx" ON "campaign_related_pages"("page_id");

-- CreateIndex
CREATE INDEX "campaign_related_posts_post_id_idx" ON "campaign_related_posts"("post_id");

-- CreateIndex
CREATE INDEX "campaign_related_case_studies_case_study_id_idx" ON "campaign_related_case_studies"("case_study_id");

-- CreateIndex
CREATE INDEX "campaign_media_media_id_idx" ON "campaign_media"("media_id");

-- CreateIndex
CREATE INDEX "clients_campaign_id_idx" ON "clients"("campaign_id");

-- CreateIndex
CREATE INDEX "form_submissions_campaign_id_idx" ON "form_submissions"("campaign_id");

-- CreateIndex
CREATE INDEX "leads_campaign_id_idx" ON "leads"("campaign_id");

-- CreateIndex
CREATE INDEX "opportunities_campaign_id_idx" ON "opportunities"("campaign_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_products" ADD CONSTRAINT "campaign_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_related_pages" ADD CONSTRAINT "campaign_related_pages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_related_pages" ADD CONSTRAINT "campaign_related_pages_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_related_posts" ADD CONSTRAINT "campaign_related_posts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_related_posts" ADD CONSTRAINT "campaign_related_posts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_related_case_studies" ADD CONSTRAINT "campaign_related_case_studies_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_related_case_studies" ADD CONSTRAINT "campaign_related_case_studies_case_study_id_fkey" FOREIGN KEY ("case_study_id") REFERENCES "case_studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_media" ADD CONSTRAINT "campaign_media_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_media" ADD CONSTRAINT "campaign_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
