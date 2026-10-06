-- Self-registration hardening: email verification tokens + a dedicated, least-privilege CLIENT_PORTAL role.
-- Non-destructive: additive table, idempotent role/permission inserts, and a backfill that marks every
-- EXISTING user as verified so nobody already using the platform is locked out by the new gate.

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "email_verification_tokens_expires_at_idx" ON "email_verification_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security (matches every other table; the application role bypasses it)
ALTER TABLE "email_verification_tokens" ENABLE ROW LEVEL SECURITY;

-- Existing accounts predate verification: mark them verified.
UPDATE "users" SET "email_verified_at" = COALESCE("email_verified_at", NOW()) WHERE "email_verified_at" IS NULL;

-- CLIENT_PORTAL role (portal read-only permissions only)
INSERT INTO "roles" ("id", "key", "name", "description", "is_system", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'CLIENT_PORTAL', 'Client Portal User', 'Self-registered client account: read-only access to its own client portal. No Control Center administration.', true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('portal.dashboard.read', 'portal.contracts.read', 'portal.subscriptions.read', 'portal.invoices.read', 'portal.payments.read', 'portal.onboarding.read', 'portal.documents.read')
WHERE r."key" = 'CLIENT_PORTAL'
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id");
