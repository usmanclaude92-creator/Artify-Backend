-- Social listening & reviews (Step 10). Mentions and reviews reuse the inbox tables (social_conversations / social_messages / social_triage);
-- only a polling cursor and a rating snapshot table are new. Additive and idempotent.

CREATE TABLE IF NOT EXISTS "social_listening_cursors" (
    "id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "cursor" TEXT,
    "polled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,

    CONSTRAINT "social_listening_cursors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "social_review_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "captured_on" DATE NOT NULL,
    "average_rating" DOUBLE PRECISION,
    "review_count" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "note" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_review_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_listening_cursors_social_account_id_key" ON "social_listening_cursors"("social_account_id");
CREATE UNIQUE INDEX IF NOT EXISTS "social_review_snapshots_social_account_id_captured_on_key" ON "social_review_snapshots"("social_account_id", "captured_on");
CREATE INDEX IF NOT EXISTS "social_review_snapshots_organization_id_captured_on_idx" ON "social_review_snapshots"("organization_id", "captured_on");

DO $$ BEGIN
  ALTER TABLE "social_listening_cursors" ADD CONSTRAINT "social_listening_cursors_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "social_review_snapshots" ADD CONSTRAINT "social_review_snapshots_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "social_listening_cursors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_review_snapshots" ENABLE ROW LEVEL SECURITY;

-- New permissions.
INSERT INTO "permissions" ("id", "key", "name", "module", "created_at")
SELECT gen_random_uuid()::text, v.k, v.n, 'social', NOW()
FROM (VALUES
  ('social.listening.read', 'Social: Listening Read'),
  ('social.reviews.respond', 'Social: Reviews Respond')
) AS v(k, n)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = v.k);

-- Same roles as the inbox: reading listening/reviews goes to every role that holds social.read (the inbox read permission),
-- responding to reviews goes to every role that holds social.reply (the inbox reply permission). Never CLIENT_PORTAL; nothing wider than the inbox.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, rp."role_id", pn."id"
FROM "role_permissions" rp
JOIN "permissions" po ON po."id" = rp."permission_id" AND po."key" = 'social.read'
JOIN "permissions" pn ON pn."key" = 'social.listening.read'
JOIN "roles" r ON r."id" = rp."role_id" AND r."key" <> 'CLIENT_PORTAL'
WHERE NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = rp."role_id" AND x."permission_id" = pn."id");

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, rp."role_id", pn."id"
FROM "role_permissions" rp
JOIN "permissions" po ON po."id" = rp."permission_id" AND po."key" = 'social.reply'
JOIN "permissions" pn ON pn."key" = 'social.reviews.respond'
JOIN "roles" r ON r."id" = rp."role_id" AND r."key" <> 'CLIENT_PORTAL'
WHERE NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = rp."role_id" AND x."permission_id" = pn."id");
