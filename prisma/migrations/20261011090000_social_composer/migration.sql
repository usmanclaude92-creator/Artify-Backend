-- Social content (Step 5): brand voice, posts, targets, plans, workspace settings. Additive and idempotent.
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SocialPostTargetStatus" AS ENUM ('PENDING', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SocialPlanStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SocialApprovalMode" AS ENUM ('ALWAYS_REQUIRE', 'AUTO_IF_GUARDRAILS_PASS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_brand_voices" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tone_descriptors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience" TEXT,
    "dos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "donts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "banned_words" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required_disclaimers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cta_phrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_brand_voices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_workspace_settings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "approval_mode" "SocialApprovalMode" NOT NULL DEFAULT 'ALWAYS_REQUIRE',
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_workspace_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_content_plans" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "account_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cadence_per_week" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" "SocialPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "ai_execution_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_content_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_posts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "media_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "link_url" TEXT,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_by" TEXT,
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "ai_execution_id" TEXT,
    "source_content_type" TEXT,
    "source_content_id" TEXT,
    "plan_id" TEXT,
    "rejection_reason" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "guardrail_result" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_post_targets" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "body_override" TEXT,
    "status" "SocialPostTargetStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "external_post_id" TEXT,
    "publish_error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_post_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_brand_voices_organization_id_key" ON "social_brand_voices"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_workspace_settings_organization_id_key" ON "social_workspace_settings"("organization_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_content_plans_organization_id_created_at_idx" ON "social_content_plans"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_posts_organization_id_status_idx" ON "social_posts"("organization_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_posts_organization_id_scheduled_at_idx" ON "social_posts"("organization_id", "scheduled_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_post_targets_social_account_id_idx" ON "social_post_targets"("social_account_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_post_targets_post_id_social_account_id_key" ON "social_post_targets"("post_id", "social_account_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_brand_voices" ADD CONSTRAINT "social_brand_voices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_workspace_settings" ADD CONSTRAINT "social_workspace_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_content_plans" ADD CONSTRAINT "social_content_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_content_plans" ADD CONSTRAINT "social_content_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "social_content_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


ALTER TABLE "social_brand_voices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_workspace_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_content_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_post_targets" ENABLE ROW LEVEL SECURITY;
