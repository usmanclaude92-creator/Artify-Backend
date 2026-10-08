-- Social analytics (Step 9b): read-only metric snapshots + per-account sync state, and social.analytics.read for every role that can read Social.
-- Additive and idempotent. History is never overwritten (UNIQUE per account/day/metric; the job inserts with DO NOTHING / null-only upgrade).

CREATE TABLE IF NOT EXISTS "social_analytics_state" (
    "id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "first_sync_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_error" TEXT,
    "backfill_from" DATE,
    "history_limit_days" INTEGER,
    "capabilities" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_analytics_state_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "social_account_metrics" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "metric_date" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "note" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_account_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "social_post_metrics" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "captured_on" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "note" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_post_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "social_audience_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "captured_on" DATE NOT NULL,
    "dimension" TEXT NOT NULL,
    "buckets" JSONB,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "reason" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_audience_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_analytics_state_social_account_id_key" ON "social_analytics_state"("social_account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "social_account_metrics_social_account_id_metric_date_metric_key" ON "social_account_metrics"("social_account_id", "metric_date", "metric");
CREATE INDEX IF NOT EXISTS "social_account_metrics_organization_id_metric_date_idx" ON "social_account_metrics"("organization_id", "metric_date");
CREATE UNIQUE INDEX IF NOT EXISTS "social_post_metrics_target_id_captured_on_metric_key" ON "social_post_metrics"("target_id", "captured_on", "metric");
CREATE INDEX IF NOT EXISTS "social_post_metrics_social_account_id_captured_on_idx" ON "social_post_metrics"("social_account_id", "captured_on");
CREATE INDEX IF NOT EXISTS "social_post_metrics_organization_id_captured_on_idx" ON "social_post_metrics"("organization_id", "captured_on");
CREATE UNIQUE INDEX IF NOT EXISTS "social_audience_snapshots_social_account_id_captured_on_dimension_key" ON "social_audience_snapshots"("social_account_id", "captured_on", "dimension");
CREATE INDEX IF NOT EXISTS "social_audience_snapshots_organization_id_captured_on_idx" ON "social_audience_snapshots"("organization_id", "captured_on");

DO $$ BEGIN
  ALTER TABLE "social_analytics_state" ADD CONSTRAINT "social_analytics_state_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "social_account_metrics" ADD CONSTRAINT "social_account_metrics_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "social_post_metrics" ADD CONSTRAINT "social_post_metrics_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "social_post_metrics" ADD CONSTRAINT "social_post_metrics_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "social_post_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "social_audience_snapshots" ADD CONSTRAINT "social_audience_snapshots_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "social_analytics_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_account_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_post_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_audience_snapshots" ENABLE ROW LEVEL SECURITY;

-- social.analytics.read already exists (Step 4, ADMIN/SUPER_ADMIN only). Grant it to every other role that can read the Social module; never CLIENT_PORTAL.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, rp."role_id", pa."id"
FROM "role_permissions" rp
JOIN "permissions" pr ON pr."id" = rp."permission_id" AND pr."key" = 'social.read'
JOIN "permissions" pa ON pa."key" = 'social.analytics.read'
JOIN "roles" r ON r."id" = rp."role_id" AND r."key" <> 'CLIENT_PORTAL'
WHERE NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = rp."role_id" AND x."permission_id" = pa."id");
