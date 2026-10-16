-- Reader engagement on public blog posts: likes, ratings, moderated comments. Additive and idempotent; no existing table changes.
CREATE TABLE IF NOT EXISTS "post_likes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "client_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "post_likes_post_id_client_key_key" ON "post_likes"("post_id", "client_key");
CREATE INDEX IF NOT EXISTS "post_likes_post_id_idx" ON "post_likes"("post_id");

CREATE TABLE IF NOT EXISTS "post_ratings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "client_key" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "post_ratings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "post_ratings_post_id_client_key_key" ON "post_ratings"("post_id", "client_key");
CREATE INDEX IF NOT EXISTS "post_ratings_post_id_idx" ON "post_ratings"("post_id");

CREATE TABLE IF NOT EXISTS "post_comments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "author_role" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moderated_at" TIMESTAMP(3),
    "moderated_by" TEXT,
    CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "post_comments_post_id_status_created_at_idx" ON "post_comments"("post_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "post_comments_organization_id_status_created_at_idx" ON "post_comments"("organization_id", "status", "created_at");

DO $$ BEGIN
  ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "post_ratings" ADD CONSTRAINT "post_ratings_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "post_likes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_ratings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "post_comments" ENABLE ROW LEVEL SECURITY;
