-- AlterEnum
ALTER TYPE "AutomationApprovalStatus" ADD VALUE 'CHANGES_REQUESTED';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "entity_id" TEXT,
ADD COLUMN     "entity_type" TEXT;
