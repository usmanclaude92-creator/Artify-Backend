-- Sidebar rail state + pinned favourites (Step 3). Additive and idempotent; no existing table is altered.
CREATE TABLE IF NOT EXISTS "user_nav_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rail_collapsed" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_nav_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_nav_preferences_user_id_key" ON "user_nav_preferences"("user_id");

CREATE TABLE IF NOT EXISTS "user_nav_pins" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_nav_pins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_nav_pins_user_id_organization_id_item_id_key" ON "user_nav_pins"("user_id", "organization_id", "item_id");
CREATE INDEX IF NOT EXISTS "user_nav_pins_user_id_organization_id_idx" ON "user_nav_pins"("user_id", "organization_id");

DO $$ BEGIN
  ALTER TABLE "user_nav_preferences" ADD CONSTRAINT "user_nav_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "user_nav_pins" ADD CONSTRAINT "user_nav_pins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "user_nav_pins" ADD CONSTRAINT "user_nav_pins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "user_nav_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_nav_pins" ENABLE ROW LEVEL SECURITY;
