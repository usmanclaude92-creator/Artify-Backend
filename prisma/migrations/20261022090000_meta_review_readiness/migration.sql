-- Step 15: Meta deauthorize / data-deletion callbacks. Additive and idempotent.
ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "meta_user_id" TEXT;
CREATE INDEX IF NOT EXISTS "social_accounts_meta_user_id_idx" ON "social_accounts"("meta_user_id");

CREATE TABLE IF NOT EXISTS "meta_data_requests" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "organization_id" TEXT,
    "kind" TEXT NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "privacy_request_id" TEXT,
    "matched" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meta_data_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "meta_data_requests_code_key" ON "meta_data_requests"("code");
CREATE INDEX IF NOT EXISTS "meta_data_requests_subject_ref_kind_status_idx" ON "meta_data_requests"("subject_ref", "kind", "status");
CREATE INDEX IF NOT EXISTS "meta_data_requests_created_at_idx" ON "meta_data_requests"("created_at");
ALTER TABLE "meta_data_requests" ENABLE ROW LEVEL SECURITY;
