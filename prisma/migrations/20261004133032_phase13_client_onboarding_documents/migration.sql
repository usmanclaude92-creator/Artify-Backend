-- AlterTable
ALTER TABLE "client_onboarding" ADD COLUMN     "due_date" TIMESTAMP(3),
ADD COLUMN     "owner_id" TEXT;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "industry_id" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "client_id" TEXT,
ADD COLUMN     "document_category" TEXT,
ADD COLUMN     "is_client_visible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onboarding_id" TEXT;

-- CreateIndex
CREATE INDEX "client_onboarding_owner_id_idx" ON "client_onboarding"("owner_id");

-- CreateIndex
CREATE INDEX "client_onboarding_due_date_idx" ON "client_onboarding"("due_date");

-- CreateIndex
CREATE INDEX "clients_industry_id_idx" ON "clients"("industry_id");

-- CreateIndex
CREATE INDEX "media_assets_client_id_idx" ON "media_assets"("client_id");

-- CreateIndex
CREATE INDEX "media_assets_onboarding_id_idx" ON "media_assets"("onboarding_id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_onboarding" ADD CONSTRAINT "client_onboarding_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "client_onboarding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
