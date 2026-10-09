-- Marketing: Landing Pages (Step 12). Extends the existing pages / forms / leads tables (additive, defaulted, nullable) and adds preview tokens + permissions.

ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "landing_builder" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "landing_live_revision_id" TEXT;
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "landing_unpublished_at" TIMESTAMP(3);
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "landing_template_key" TEXT;
CREATE INDEX IF NOT EXISTS "pages_organization_id_landing_builder_status_idx" ON "pages"("organization_id", "landing_builder", "status");

ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "landing_page_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "forms_landing_page_id_key" ON "forms"("landing_page_id");
DO $$ BEGIN
  ALTER TABLE "forms" ADD CONSTRAINT "forms_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "form_submissions" ADD COLUMN IF NOT EXISTS "first_touch" JSONB;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "first_touch" JSONB;

CREATE TABLE IF NOT EXISTS "landing_preview_tokens" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "landing_preview_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "landing_preview_tokens_token_hash_key" ON "landing_preview_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "landing_preview_tokens_page_id_idx" ON "landing_preview_tokens"("page_id");
DO $$ BEGIN
  ALTER TABLE "landing_preview_tokens" ADD CONSTRAINT "landing_preview_tokens_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "landing_preview_tokens" ENABLE ROW LEVEL SECURITY;

-- New permissions.
INSERT INTO "permissions" ("id", "key", "name", "module", "created_at")
SELECT gen_random_uuid()::text, v.k, v.n, 'marketing', NOW()
FROM (VALUES
  ('marketing.landing.read', 'Marketing: Landing Pages Read'),
  ('marketing.landing.edit', 'Marketing: Landing Pages Edit'),
  ('marketing.landing.publish', 'Marketing: Landing Pages Publish')
) AS v(k, n)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = v.k);

-- read = every role that can read CMS content (content.read); edit = every role that can edit CMS content (content.update);
-- publish = SUPER_ADMIN and ADMIN only. CLIENT_PORTAL never receives any of the three.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, rp."role_id", pn."id"
FROM "role_permissions" rp
JOIN "permissions" po ON po."id" = rp."permission_id" AND po."key" = 'content.read'
JOIN "permissions" pn ON pn."key" = 'marketing.landing.read'
JOIN "roles" r ON r."id" = rp."role_id" AND r."key" <> 'CLIENT_PORTAL'
WHERE NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = rp."role_id" AND x."permission_id" = pn."id");

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, rp."role_id", pn."id"
FROM "role_permissions" rp
JOIN "permissions" po ON po."id" = rp."permission_id" AND po."key" = 'content.update'
JOIN "permissions" pn ON pn."key" = 'marketing.landing.edit'
JOIN "roles" r ON r."id" = rp."role_id" AND r."key" <> 'CLIENT_PORTAL'
WHERE NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = rp."role_id" AND x."permission_id" = pn."id");

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, r."id", pn."id"
FROM "roles" r
JOIN "permissions" pn ON pn."key" = 'marketing.landing.publish'
WHERE r."key" IN ('SUPER_ADMIN', 'ADMIN')
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = r."id" AND x."permission_id" = pn."id");
