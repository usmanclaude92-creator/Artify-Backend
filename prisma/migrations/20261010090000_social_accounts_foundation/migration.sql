-- Social Media foundation (Step 4): connected accounts, encrypted credentials, OAuth state, permissions. Additive and idempotent.
-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "SocialAccountStatus" AS ENUM ('CONNECTED', 'NEEDS_REAUTH', 'DISCONNECTED', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "handle" TEXT,
    "avatar_url" TEXT,
    "account_type" TEXT NOT NULL DEFAULT 'PROFILE',
    "status" "SocialAccountStatus" NOT NULL DEFAULT 'CONNECTED',
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_expires_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_error" TEXT,
    "connected_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_account_credentials" (
    "id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_account_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_oauth_states" (
    "id" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reconnect_account_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_accounts_organization_id_status_idx" ON "social_accounts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_organization_id_provider_external_account_i_key" ON "social_accounts"("organization_id", "provider", "external_account_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_account_credentials_social_account_id_key" ON "social_account_credentials"("social_account_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_oauth_states_state_hash_key" ON "social_oauth_states"("state_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_oauth_states_expires_at_idx" ON "social_oauth_states"("expires_at");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_account_credentials" ADD CONSTRAINT "social_account_credentials_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_oauth_states" ADD CONSTRAINT "social_oauth_states_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "social_oauth_states" ADD CONSTRAINT "social_oauth_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


ALTER TABLE "social_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_account_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_oauth_states" ENABLE ROW LEVEL SECURITY;

-- Permissions (social.read already exists from the placeholder migration).
INSERT INTO "permissions" ("id", "key", "name", "module", "created_at")
SELECT gen_random_uuid()::text, v.k, v.n, 'social', NOW()
FROM (VALUES
  ('social.read', 'Social: Read'),
  ('social.accounts.manage', 'Social: Accounts Manage'),
  ('social.publish', 'Social: Publish'),
  ('social.approve', 'Social: Approve'),
  ('social.reply', 'Social: Reply'),
  ('social.analytics.read', 'Social: Analytics Read')
) AS v(k, n)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = v.k);

-- Admin roles: everything. Read-only roles: social.read only. Never CLIENT_PORTAL.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('social.read', 'social.accounts.manage', 'social.publish', 'social.approve', 'social.reply', 'social.analytics.read')
WHERE r."key" IN ('SUPER_ADMIN', 'ADMIN')
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id");

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'social.read'
WHERE r."key" IN ('MANAGER', 'VIEWER')
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id");
