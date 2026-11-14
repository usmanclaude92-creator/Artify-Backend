-- Private preview links for blog posts (additive, idempotent). Only the SHA-256 hash of a token is stored.
CREATE TABLE IF NOT EXISTS "post_preview_tokens" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_preview_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "post_preview_tokens_token_hash_key" ON "post_preview_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "post_preview_tokens_post_id_idx" ON "post_preview_tokens"("post_id");
DO $$ BEGIN
  ALTER TABLE "post_preview_tokens" ADD CONSTRAINT "post_preview_tokens_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "post_preview_tokens" ENABLE ROW LEVEL SECURITY;
