-- Social inbox (Step 7): conversations, messages, triage, routing rules, canned replies, workspace settings. Additive and idempotent.

DO $$ BEGIN
  CREATE TYPE "SocialConversationType" AS ENUM ('COMMENT', 'DM', 'MENTION', 'REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SocialConversationStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'SPAM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SocialConversationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SocialMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SocialMessageAuthorKind" AS ENUM ('CUSTOMER', 'PAGE', 'AI_DRAFT', 'NOTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SocialMessageSendStatus" AS ENUM ('RECEIVED', 'DRAFT', 'SENDING', 'SENT', 'FAILED', 'UNCERTAIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SocialTriageStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "social_conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "provider_thread_id" TEXT NOT NULL,
    "type" "SocialConversationType" NOT NULL,
    "participant_external_id" TEXT,
    "participant_handle" TEXT,
    "participant_name" TEXT,
    "subject_ref" TEXT,
    "status" "SocialConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assignee_id" TEXT,
    "priority" "SocialConversationPriority" NOT NULL DEFAULT 'NORMAL',
    "intent" TEXT,
    "sentiment" TEXT,
    "needs_human" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_inbound_at" TIMESTAMP(3),
    "awaiting_since" TIMESTAMP(3),
    "first_response_at" TIMESTAMP(3),
    "sla_due_at" TIMESTAMP(3),
    "sla_notified_at" TIMESTAMP(3),
    "lead_id" TEXT,
    "contact_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "social_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "direction" "SocialMessageDirection" NOT NULL,
    "authorKind" "SocialMessageAuthorKind" NOT NULL,
    "provider_message_id" TEXT,
    "body" TEXT NOT NULL,
    "media_refs" JSONB,
    "send_status" "SocialMessageSendStatus" NOT NULL DEFAULT 'RECEIVED',
    "send_error" TEXT,
    "send_idempotency_key" TEXT,
    "sent_by" TEXT,
    "sent_at" TIMESTAMP(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "ai_execution_id" TEXT,
    "ai_confidence" DOUBLE PRECISION,
    "guardrail_result" JSONB,
    "auto_sent" BOOLEAN NOT NULL DEFAULT false,
    "triage_status" "SocialTriageStatus" NOT NULL DEFAULT 'SKIPPED',
    "triage_attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "social_triage" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "language" TEXT,
    "spam_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "suggested_category" TEXT,
    "confidence" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "flagged_for_human" BOOLEAN NOT NULL DEFAULT false,
    "ai_execution_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_triage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "social_inbox_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "match_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "match_intents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "match_sentiments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignee_id" TEXT,
    "set_priority" "SocialConversationPriority",
    "add_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_inbox_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "social_canned_replies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "approved_for_auto" BOOLEAN NOT NULL DEFAULT false,
    "match_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_canned_replies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "social_inbox_settings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "auto_triage" BOOLEAN NOT NULL DEFAULT true,
    "auto_draft" BOOLEAN NOT NULL DEFAULT false,
    "auto_reply" BOOLEAN NOT NULL DEFAULT false,
    "auto_lead" BOOLEAN NOT NULL DEFAULT false,
    "first_response_minutes" INTEGER NOT NULL DEFAULT 60,
    "retention_days" INTEGER NOT NULL DEFAULT 180,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_inbox_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "social_conversations_organization_id_status_last_message_at_idx" ON "social_conversations"("organization_id", "status", "last_message_at");

CREATE INDEX IF NOT EXISTS "social_conversations_organization_id_assignee_id_idx" ON "social_conversations"("organization_id", "assignee_id");

CREATE INDEX IF NOT EXISTS "social_conversations_organization_id_sla_due_at_idx" ON "social_conversations"("organization_id", "sla_due_at");

CREATE UNIQUE INDEX IF NOT EXISTS "social_conversations_social_account_id_provider_thread_id_key" ON "social_conversations"("social_account_id", "provider_thread_id");

CREATE UNIQUE INDEX IF NOT EXISTS "social_messages_send_idempotency_key_key" ON "social_messages"("send_idempotency_key");

CREATE INDEX IF NOT EXISTS "social_messages_conversation_id_created_at_idx" ON "social_messages"("conversation_id", "created_at");

CREATE INDEX IF NOT EXISTS "social_messages_organization_id_created_at_idx" ON "social_messages"("organization_id", "created_at");

CREATE INDEX IF NOT EXISTS "social_messages_triage_status_created_at_idx" ON "social_messages"("triage_status", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "social_messages_social_account_id_provider_message_id_key" ON "social_messages"("social_account_id", "provider_message_id");

CREATE UNIQUE INDEX IF NOT EXISTS "social_triage_message_id_key" ON "social_triage"("message_id");

CREATE INDEX IF NOT EXISTS "social_triage_conversation_id_idx" ON "social_triage"("conversation_id");

CREATE INDEX IF NOT EXISTS "social_triage_organization_id_created_at_idx" ON "social_triage"("organization_id", "created_at");

CREATE INDEX IF NOT EXISTS "social_inbox_rules_organization_id_position_idx" ON "social_inbox_rules"("organization_id", "position");

CREATE INDEX IF NOT EXISTS "social_canned_replies_organization_id_idx" ON "social_canned_replies"("organization_id");

CREATE UNIQUE INDEX IF NOT EXISTS "social_inbox_settings_organization_id_key" ON "social_inbox_settings"("organization_id");

DO $$ BEGIN
  ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "social_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "social_triage" ADD CONSTRAINT "social_triage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "social_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "social_triage" ADD CONSTRAINT "social_triage_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "social_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "social_inbox_rules" ADD CONSTRAINT "social_inbox_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "social_canned_replies" ADD CONSTRAINT "social_canned_replies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "social_inbox_settings" ADD CONSTRAINT "social_inbox_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "social_conversations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "social_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "social_triage" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "social_inbox_rules" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "social_canned_replies" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "social_inbox_settings" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "social_inbox_cursors" (
    "id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "cursor" TEXT,
    "polled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "social_inbox_cursors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "social_inbox_cursors_social_account_id_key" ON "social_inbox_cursors"("social_account_id");
ALTER TABLE "social_inbox_cursors" ENABLE ROW LEVEL SECURITY;
