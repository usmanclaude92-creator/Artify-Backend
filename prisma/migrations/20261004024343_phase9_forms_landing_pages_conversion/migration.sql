-- AlterTable
ALTER TABLE "form_submissions" ADD COLUMN     "consent_given" BOOLEAN,
ADD COLUMN     "landing_page_path" TEXT,
ADD COLUMN     "referrer" TEXT;

-- AlterTable
ALTER TABLE "forms" ADD COLUMN     "notify_user_ids" JSONB NOT NULL DEFAULT '[]';
