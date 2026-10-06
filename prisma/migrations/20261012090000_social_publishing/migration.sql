-- Social publishing (Step 6): target lock/idempotency columns, attempt log, publishing controls. Additive and idempotent.
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block together with use of the new value; it is only added here.
ALTER TYPE "SocialPostTargetStatus" ADD VALUE IF NOT EXISTS 'UNCERTAIN';
ALTER TYPE "SocialPostTargetStatus" ADD VALUE IF NOT EXISTS 'MISSED';

DO $$ BEGIN
  CREATE TYPE "SocialPublishOutcome" AS ENUM ('SUCCESS', 'TRANSIENT_FAILURE', 'PERMANENT_FAILURE', 'AUTH_FAILURE', 'UNCERTAIN', 'DRY_RUN', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "social_post_targets" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
ALTER TABLE "social_post_targets" ADD COLUMN IF NOT EXISTS "locked_at" TIMESTAMP(3);
ALTER TABLE "social_post_targets" ADD COLUMN IF NOT EXISTS "locked_by" TEXT;
ALTER TABLE "social_post_targets" ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMP(3);
ALTER TABLE "social_post_targets" ADD COLUMN IF NOT EXISTS "external_url" TEXT;
ALTER TABLE "social_post_targets" ADD COLUMN IF NOT EXISTS "manual_resolution" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "social_post_targets" ADD COLUMN IF NOT EXISTS "resolved_by" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "social_post_targets_idempotency_key_key" ON "social_post_targets"("idempotency_key");
CREATE INDEX IF NOT EXISTS "social_post_targets_status_scheduled_at_idx" ON "social_post_targets"("status", "scheduled_at");

CREATE TABLE IF NOT EXISTS "social_publish_attempts" (
    "id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "outcome" "SocialPublishOutcome",
    "error_category" TEXT,
    "error_message" TEXT,
    "external_post_id" TEXT,
    "external_url" TEXT,
    "http_status" INTEGER,
    "duration_ms" INTEGER,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "actor_user_id" TEXT,
    CONSTRAINT "social_publish_attempts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "social_publish_attempts_target_id_started_at_idx" ON "social_publish_attempts"("target_id", "started_at");
DO $$ BEGIN
  ALTER TABLE "social_publish_attempts" ADD CONSTRAINT "social_publish_attempts_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "social_post_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "social_publishing_settings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dry_run" BOOLEAN NOT NULL DEFAULT true,
    "kill_switch" BOOLEAN NOT NULL DEFAULT false,
    "grace_minutes" INTEGER NOT NULL DEFAULT 60,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "social_publishing_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "social_publishing_settings_organization_id_key" ON "social_publishing_settings"("organization_id");
DO $$ BEGIN
  ALTER TABLE "social_publishing_settings" ADD CONSTRAINT "social_publishing_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "social_publishing_global" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dry_run" BOOLEAN NOT NULL DEFAULT true,
    "kill_switch" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_publishing_global_pkey" PRIMARY KEY ("id")
);
INSERT INTO "social_publishing_global" ("id", "enabled", "dry_run", "kill_switch", "updated_at")
VALUES ('global', false, true, false, NOW())
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "social_publish_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_publishing_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_publishing_global" ENABLE ROW LEVEL SECURITY;
