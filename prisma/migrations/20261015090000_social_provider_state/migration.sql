-- Step 9a: provider progress for multi-step publishing (Instagram container -> status -> publish). Additive and idempotent.
ALTER TABLE "social_post_targets" ADD COLUMN IF NOT EXISTS "provider_state" JSONB;
