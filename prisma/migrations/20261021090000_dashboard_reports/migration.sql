-- Step 14: saved dashboard views, scheduled report schedules/runs/deliveries, kill switch, reports.manage permission. Additive and idempotent.
CREATE TABLE IF NOT EXISTS "dashboard_views" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dashboard_views_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dashboard_views_organization_id_user_id_idx" ON "dashboard_views"("organization_id", "user_id");

CREATE TABLE IF NOT EXISTS "dashboard_report_settings" (
    "organization_id" TEXT NOT NULL,
    "kill_switch" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dashboard_report_settings_pkey" PRIMARY KEY ("organization_id")
);

CREATE TABLE IF NOT EXISTS "dashboard_report_schedules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cadence" TEXT NOT NULL,
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recipient_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "period_days" INTEGER NOT NULL DEFAULT 7,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dry_run" BOOLEAN NOT NULL DEFAULT true,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dashboard_report_schedules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dashboard_report_schedules_organization_id_idx" ON "dashboard_report_schedules"("organization_id");
CREATE INDEX IF NOT EXISTS "dashboard_report_schedules_enabled_next_run_at_idx" ON "dashboard_report_schedules"("enabled", "next_run_at");

CREATE TABLE IF NOT EXISTS "dashboard_report_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dry_run" BOOLEAN NOT NULL,
    "period_from" TEXT NOT NULL,
    "period_to" TEXT NOT NULL,
    "summary" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dashboard_report_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dashboard_report_runs_schedule_id_created_at_idx" ON "dashboard_report_runs"("schedule_id", "created_at");
CREATE INDEX IF NOT EXISTS "dashboard_report_runs_organization_id_created_at_idx" ON "dashboard_report_runs"("organization_id", "created_at");
DO $$ BEGIN
  ALTER TABLE "dashboard_report_runs" ADD CONSTRAINT "dashboard_report_runs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "dashboard_report_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "dashboard_report_deliveries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcome" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "html" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dashboard_report_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dashboard_report_deliveries_run_id_idx" ON "dashboard_report_deliveries"("run_id");
CREATE INDEX IF NOT EXISTS "dashboard_report_deliveries_user_id_created_at_idx" ON "dashboard_report_deliveries"("user_id", "created_at");
DO $$ BEGIN
  ALTER TABLE "dashboard_report_deliveries" ADD CONSTRAINT "dashboard_report_deliveries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "dashboard_report_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "dashboard_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_report_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_report_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_report_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboard_report_deliveries" ENABLE ROW LEVEL SECURITY;

INSERT INTO "permissions" ("id", "key", "name", "module", "created_at")
SELECT gen_random_uuid()::text, 'reports.manage', 'Reports: Manage scheduled dashboard reports', 'reports', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = 'reports.manage');

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "roles" r JOIN "permissions" p ON p."key" = 'reports.manage'
WHERE r."key" IN ('SUPER_ADMIN', 'ADMIN')
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = r."id" AND x."permission_id" = p."id");

-- Composite indexes for the dashboard's period queries (organization + time / stage).
CREATE INDEX IF NOT EXISTS "leads_organization_id_created_at_idx" ON "leads"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "form_submissions_organization_id_created_at_idx" ON "form_submissions"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "opportunities_organization_id_stage_idx" ON "opportunities"("organization_id", "stage");
