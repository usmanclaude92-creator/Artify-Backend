-- Social connect sessions (Step 8): encrypted, short-lived hand-off between OAuth and the Page picker. Additive and idempotent.
CREATE TABLE IF NOT EXISTS "social_connect_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_connect_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "social_connect_sessions_expires_at_idx" ON "social_connect_sessions"("expires_at");
CREATE INDEX IF NOT EXISTS "social_connect_sessions_organization_id_user_id_idx" ON "social_connect_sessions"("organization_id", "user_id");
ALTER TABLE "social_connect_sessions" ENABLE ROW LEVEL SECURITY;
