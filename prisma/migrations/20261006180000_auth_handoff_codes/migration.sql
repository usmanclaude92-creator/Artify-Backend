-- Single-use cross-site sign-in handoff codes (public site -> Control Center). Additive and non-destructive.
CREATE TABLE "auth_handoff_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_handoff_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_handoff_codes_code_hash_key" ON "auth_handoff_codes"("code_hash");
CREATE INDEX "auth_handoff_codes_user_id_idx" ON "auth_handoff_codes"("user_id");
CREATE INDEX "auth_handoff_codes_expires_at_idx" ON "auth_handoff_codes"("expires_at");

ALTER TABLE "auth_handoff_codes" ADD CONSTRAINT "auth_handoff_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_handoff_codes" ENABLE ROW LEVEL SECURITY;
