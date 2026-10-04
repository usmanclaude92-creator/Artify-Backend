-- Phase 12 (CRM Integration + Business Relationship Management) —
-- additive only. Real structured lead attribution (previously buried in
-- free-text notes), and a lead-first Opportunity pipeline (clientId
-- becomes nullable so a deal can exist against a Lead before it
-- converts to a Client). Every existing row already has clientId set,
-- so the widened CHECK constraint below is a no-op for all current data.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "consent_given" BOOLEAN,
ADD COLUMN     "form_id" TEXT,
ADD COLUMN     "landing_page_path" TEXT,
ADD COLUMN     "referrer" TEXT,
ADD COLUMN     "utm_campaign" TEXT,
ADD COLUMN     "utm_content" TEXT,
ADD COLUMN     "utm_medium" TEXT,
ADD COLUMN     "utm_source" TEXT,
ADD COLUMN     "utm_term" TEXT;

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "probability" INTEGER,
ADD COLUMN     "product_id" TEXT,
ADD COLUMN     "source" TEXT,
ALTER COLUMN "client_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "leads_form_id_idx" ON "leads"("form_id");

-- CreateIndex
CREATE INDEX "opportunities_lead_id_idx" ON "opportunities"("lead_id");

-- CreateIndex
CREATE INDEX "opportunities_product_id_idx" ON "opportunities"("product_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An Opportunity must belong to at least one real relationship — a
-- Client, a Lead, or (normally, for the duration of the pipeline) both.
-- Never both null. Every existing row already has client_id set, so
-- this is a no-op for current data.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_client_or_lead_required" CHECK (num_nonnulls("client_id", "lead_id") >= 1);
