-- Step 13: System Health heartbeats, health results, encrypted exports, privacy requests, consent register, permissions. Additive and idempotent.

CREATE TABLE IF NOT EXISTS "job_heartbeats" (
    "key" TEXT NOT NULL,
    "last_started_at" TIMESTAMP(3),
    "last_finished_at" TIMESTAMP(3),
    "last_status" TEXT,
    "last_error" TEXT,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_heartbeats_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "health_check_results" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,
    "red_since" TIMESTAMP(3),
    "last_alerted_at" TIMESTAMP(3),
    CONSTRAINT "health_check_results_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "health_check_results_organization_id_key_key" ON "health_check_results"("organization_id", "key");

CREATE TABLE IF NOT EXISTS "data_exports" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "storage_key" TEXT,
    "size_bytes" INTEGER,
    "sha256" TEXT,
    "row_counts" JSONB,
    "error" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "data_exports_organization_id_created_at_idx" ON "data_exports"("organization_id", "created_at");

CREATE TABLE IF NOT EXISTS "privacy_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "mode" TEXT,
    "requested_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approval_id" TEXT,
    "target_ids" JSONB,
    "preview_counts" JSONB,
    "result_counts" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "privacy_requests_organization_id_created_at_idx" ON "privacy_requests"("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "privacy_requests_organization_id_subject_ref_idx" ON "privacy_requests"("organization_id", "subject_ref");

CREATE TABLE IF NOT EXISTS "consent_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "submission_id" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "consent_records_organization_id_captured_at_idx" ON "consent_records"("organization_id", "captured_at");
CREATE INDEX IF NOT EXISTS "consent_records_lead_id_idx" ON "consent_records"("lead_id");

ALTER TABLE "job_heartbeats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "health_check_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "privacy_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;

-- Backfill the consent register from what is already stored (a recorded yes/no, with the original capture time). Safe to re-run.
INSERT INTO "consent_records" ("id", "organization_id", "lead_id", "submission_id", "source", "status", "captured_at")
SELECT gen_random_uuid()::text, fs."organization_id", fs."lead_id", fs."id",
       COALESCE(CASE WHEN f."landing_page_id" IS NOT NULL THEN 'landing:' || f."slug" ELSE 'form:' || f."slug" END, 'form'),
       CASE WHEN fs."consent_given" THEN 'GIVEN' ELSE 'DECLINED' END, fs."created_at"
FROM "form_submissions" fs LEFT JOIN "forms" f ON f."id" = fs."form_id"
WHERE fs."consent_given" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "consent_records" c WHERE c."submission_id" = fs."id");

INSERT INTO "consent_records" ("id", "organization_id", "lead_id", "submission_id", "source", "status", "captured_at")
SELECT gen_random_uuid()::text, l."organization_id", l."id", NULL, COALESCE(l."source", 'lead'),
       CASE WHEN l."consent_given" THEN 'GIVEN' ELSE 'DECLINED' END, l."created_at"
FROM "leads" l
WHERE l."consent_given" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "consent_records" c WHERE c."lead_id" = l."id");

-- Immutable privacy audit entries: PRIVACY_* rows cannot be changed or deleted (the FK SetNull on org/actor is still allowed).
CREATE OR REPLACE FUNCTION audit_privacy_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."action" NOT LIKE 'PRIVACY\_%' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'organization_id' - 'actor_user_id') IS DISTINCT FROM (to_jsonb(OLD) - 'organization_id' - 'actor_user_id') THEN
      RAISE EXCEPTION 'Privacy audit entries are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF current_setting('app.allow_privacy_audit_delete', true) = 'on' THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Privacy audit entries are immutable';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_privacy_immutable_trg ON "audit_logs";
CREATE TRIGGER audit_privacy_immutable_trg BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION audit_privacy_immutable();

-- Permissions. read/export/health/backups: ADMIN and SUPER_ADMIN only. erase: SUPER_ADMIN only. No existing grant changes.
INSERT INTO "permissions" ("id", "key", "name", "module", "created_at")
SELECT gen_random_uuid()::text, v.k, v.n, v.m, NOW()
FROM (VALUES
  ('ops.health.read', 'Ops: System Health Read', 'ops'),
  ('ops.backups.read', 'Ops: Backups Read', 'ops'),
  ('privacy.read', 'Privacy: Read', 'privacy'),
  ('privacy.export', 'Privacy: Export', 'privacy'),
  ('privacy.erase', 'Privacy: Erase', 'privacy')
) AS v(k, n, m)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = v.k);

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "roles" r JOIN "permissions" p ON p."key" IN ('ops.health.read', 'ops.backups.read', 'privacy.read', 'privacy.export')
WHERE r."key" IN ('SUPER_ADMIN', 'ADMIN')
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = r."id" AND x."permission_id" = p."id");

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "roles" r JOIN "permissions" p ON p."key" = 'privacy.erase'
WHERE r."key" = 'SUPER_ADMIN'
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = r."id" AND x."permission_id" = p."id");
