-- CreateEnum
CREATE TYPE "AutomationWorkflowStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('EVENT', 'SCHEDULE', 'MANUAL', 'API', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_DELAY', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "AutomationStepType" AS ENUM ('CONDITION', 'AI_DECISION', 'AI_GENERATION', 'TOOL_CALL', 'BUSINESS_ACTION', 'APPROVAL', 'NOTIFICATION', 'DELAY', 'LOOP', 'TRANSFORM');

-- CreateEnum
CREATE TYPE "AutomationStepStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED', 'WAITING_APPROVAL', 'WAITING_DELAY');

-- CreateEnum
CREATE TYPE "AutomationScheduleType" AS ENUM ('ONE_TIME', 'RECURRING', 'CRON');

-- CreateEnum
CREATE TYPE "AutomationApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomationTaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "AutomationTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "KnowledgeAccessPolicy" AS ENUM ('PUBLIC', 'RESTRICTED', 'ROLE_BASED', 'OWNER_ONLY');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('UPLOADED_DOCUMENT', 'MEDIA_ASSET', 'CMS_CONTENT', 'CRM_CLIENT', 'CRM_LEAD', 'PROJECT', 'PRODUCT_CATALOG', 'BILLING_RECORD', 'MANUAL_ENTRY', 'EXTERNAL_CONNECTOR');

-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'EXTRACTED', 'CHUNKED', 'INDEXING', 'INDEXED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "KnowledgeJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'INDEXED', 'STALE', 'FAILED', 'REINDEX_REQUIRED');

-- CreateEnum
CREATE TYPE "CopilotResponseMode" AS ENUM ('ANSWER', 'EXPLAIN', 'SUMMARIZE', 'ANALYZE', 'RECOMMEND', 'DRAFT', 'EXECUTE');

-- CreateTable
CREATE TABLE "automation_workflows" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" "AutomationWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "published_version" INTEGER,
    "trigger_type" "AutomationTriggerType" NOT NULL DEFAULT 'EVENT',
    "trigger_config" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "retry_policy" JSONB NOT NULL DEFAULT '{"maxRetries":2,"backoffMs":1000,"exponential":true}',
    "limits" JSONB NOT NULL DEFAULT '{"maxSteps":50,"maxDurationMs":300000,"maxAiCalls":10,"maxToolCalls":15,"maxLoopIterations":10}',
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_workflow_versions" (
    "id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "trigger_type" "AutomationTriggerType" NOT NULL,
    "trigger_config" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "retry_policy" JSONB NOT NULL DEFAULT '{"maxRetries":2,"backoffMs":1000,"exponential":true}',
    "limits" JSONB NOT NULL DEFAULT '{"maxSteps":50,"maxDurationMs":300000,"maxAiCalls":10,"maxToolCalls":15,"maxLoopIterations":10}',
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_id" TEXT,
    "change_summary" TEXT,

    CONSTRAINT "automation_workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_executions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "workflow_version" INTEGER NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger_type" "AutomationTriggerType" NOT NULL,
    "trigger_event_id" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "context" JSONB NOT NULL DEFAULT '{}',
    "current_step_index" INTEGER NOT NULL DEFAULT 0,
    "total_steps" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "initiated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_step_executions" (
    "id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_id" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "step_type" "AutomationStepType" NOT NULL,
    "status" "AutomationStepStatus" NOT NULL DEFAULT 'PENDING',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "automation_step_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_schedules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "schedule_type" "AutomationScheduleType" NOT NULL DEFAULT 'RECURRING',
    "cron_expression" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "interval_seconds" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "next_run_at" TIMESTAMP(3),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL DEFAULT 'USER',
    "source_module" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_approvals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "step_execution_id" TEXT,
    "workflow_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "required_role" TEXT,
    "status" "AutomationApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requester_id" TEXT,
    "approver_id" TEXT,
    "decision_reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "automation_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigned_user_id" TEXT,
    "assigned_role" TEXT,
    "priority" "AutomationTaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "AutomationTaskStatus" NOT NULL DEFAULT 'PENDING',
    "due_date" TIMESTAMP(3),
    "source_workflow_id" TEXT,
    "source_execution_id" TEXT,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "is_ai_generated" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_action_executions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,
    "error_message" TEXT,

    CONSTRAINT "automation_action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_notifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "recipient_role" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "status" TEXT NOT NULL DEFAULT 'DELIVERED',
    "source_workflow_id" TEXT,
    "source_execution_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_collections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source_types" JSONB NOT NULL DEFAULT '[]',
    "access_policy" "KnowledgeAccessPolicy" NOT NULL DEFAULT 'RESTRICTED',
    "allowed_roles" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "collection_id" TEXT,
    "name" TEXT NOT NULL,
    "source_type" "KnowledgeSourceType" NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "collection_id" TEXT,
    "source_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "file_reference" TEXT,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT NOT NULL DEFAULT 'en',
    "active_version" INTEGER NOT NULL DEFAULT 1,
    "checksum" TEXT,
    "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "indexing_status" "KnowledgeJobStatus" NOT NULL DEFAULT 'PENDING',
    "security_scope" TEXT NOT NULL DEFAULT 'DEFAULT',
    "required_role" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_document_versions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "file_reference" TEXT,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "extracted_text" TEXT,
    "total_chunks" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_estimate" INTEGER NOT NULL DEFAULT 0,
    "char_count" INTEGER NOT NULL DEFAULT 0,
    "page_number" INTEGER,
    "section_heading" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_embeddings" (
    "id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL DEFAULT 'MOCK',
    "model_name" TEXT NOT NULL DEFAULT 'text-embedding-004',
    "dimension" INTEGER NOT NULL DEFAULT 768,
    "vector" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_ingestion_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'PENDING',
    "status" "KnowledgeJobStatus" NOT NULL DEFAULT 'PENDING',
    "total_chunks" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_search_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "query" TEXT NOT NULL,
    "search_type" TEXT NOT NULL DEFAULT 'HYBRID',
    "filter_metadata" JSONB NOT NULL DEFAULT '{}',
    "results_count" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_workspaces" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'Bot',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "allowed_agents" JSONB NOT NULL DEFAULT '[]',
    "allowed_tools" JSONB NOT NULL DEFAULT '[]',
    "knowledge_scope" JSONB NOT NULL DEFAULT '{}',
    "allowed_modules" JSONB NOT NULL DEFAULT '[]',
    "required_permissions" JSONB NOT NULL DEFAULT '[]',
    "system_instruction" TEXT,
    "default_mode" "CopilotResponseMode" NOT NULL DEFAULT 'ANSWER',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "max_tokens" INTEGER NOT NULL DEFAULT 2048,
    "require_citations" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT,
    "context_metadata" JSONB NOT NULL DEFAULT '{}',
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "provider_type" TEXT,
    "model_name" TEXT,
    "agent_id" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "execution_id" TEXT,
    "correlation_id" TEXT,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "action_preview" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_action_previews" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "target_entity" TEXT,
    "changes_summary" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "risk_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "execution_result" JSONB,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "approval_id" TEXT,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_action_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_usages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "provider_type" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copilot_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_workflows_organization_id_idx" ON "automation_workflows"("organization_id");

-- CreateIndex
CREATE INDEX "automation_workflows_status_idx" ON "automation_workflows"("status");

-- CreateIndex
CREATE INDEX "automation_workflows_trigger_type_idx" ON "automation_workflows"("trigger_type");

-- CreateIndex
CREATE INDEX "automation_workflow_versions_workflow_id_idx" ON "automation_workflow_versions"("workflow_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_workflow_versions_workflow_id_version_key" ON "automation_workflow_versions"("workflow_id", "version");

-- CreateIndex
CREATE INDEX "automation_executions_organization_id_idx" ON "automation_executions"("organization_id");

-- CreateIndex
CREATE INDEX "automation_executions_workflow_id_idx" ON "automation_executions"("workflow_id");

-- CreateIndex
CREATE INDEX "automation_executions_status_idx" ON "automation_executions"("status");

-- CreateIndex
CREATE INDEX "automation_executions_correlation_id_idx" ON "automation_executions"("correlation_id");

-- CreateIndex
CREATE INDEX "automation_executions_idempotency_key_idx" ON "automation_executions"("idempotency_key");

-- CreateIndex
CREATE INDEX "automation_step_executions_execution_id_idx" ON "automation_step_executions"("execution_id");

-- CreateIndex
CREATE INDEX "automation_step_executions_step_id_idx" ON "automation_step_executions"("step_id");

-- CreateIndex
CREATE INDEX "automation_schedules_organization_id_idx" ON "automation_schedules"("organization_id");

-- CreateIndex
CREATE INDEX "automation_schedules_workflow_id_idx" ON "automation_schedules"("workflow_id");

-- CreateIndex
CREATE INDEX "automation_schedules_is_active_idx" ON "automation_schedules"("is_active");

-- CreateIndex
CREATE INDEX "automation_events_organization_id_idx" ON "automation_events"("organization_id");

-- CreateIndex
CREATE INDEX "automation_events_event_type_idx" ON "automation_events"("event_type");

-- CreateIndex
CREATE INDEX "automation_events_correlation_id_idx" ON "automation_events"("correlation_id");

-- CreateIndex
CREATE INDEX "automation_events_processed_idx" ON "automation_events"("processed");

-- CreateIndex
CREATE INDEX "automation_approvals_organization_id_idx" ON "automation_approvals"("organization_id");

-- CreateIndex
CREATE INDEX "automation_approvals_execution_id_idx" ON "automation_approvals"("execution_id");

-- CreateIndex
CREATE INDEX "automation_approvals_status_idx" ON "automation_approvals"("status");

-- CreateIndex
CREATE INDEX "automation_tasks_organization_id_idx" ON "automation_tasks"("organization_id");

-- CreateIndex
CREATE INDEX "automation_tasks_status_idx" ON "automation_tasks"("status");

-- CreateIndex
CREATE INDEX "automation_tasks_assigned_user_id_idx" ON "automation_tasks"("assigned_user_id");

-- CreateIndex
CREATE INDEX "automation_tasks_source_workflow_id_idx" ON "automation_tasks"("source_workflow_id");

-- CreateIndex
CREATE INDEX "automation_action_executions_organization_id_idx" ON "automation_action_executions"("organization_id");

-- CreateIndex
CREATE INDEX "automation_action_executions_execution_id_idx" ON "automation_action_executions"("execution_id");

-- CreateIndex
CREATE INDEX "automation_action_executions_idempotency_key_idx" ON "automation_action_executions"("idempotency_key");

-- CreateIndex
CREATE INDEX "automation_notifications_organization_id_idx" ON "automation_notifications"("organization_id");

-- CreateIndex
CREATE INDEX "automation_notifications_user_id_idx" ON "automation_notifications"("user_id");

-- CreateIndex
CREATE INDEX "automation_notifications_status_idx" ON "automation_notifications"("status");

-- CreateIndex
CREATE INDEX "knowledge_collections_organization_id_idx" ON "knowledge_collections"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_collections_status_idx" ON "knowledge_collections"("status");

-- CreateIndex
CREATE INDEX "knowledge_sources_organization_id_idx" ON "knowledge_sources"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_sources_collection_id_idx" ON "knowledge_sources"("collection_id");

-- CreateIndex
CREATE INDEX "knowledge_sources_source_type_idx" ON "knowledge_sources"("source_type");

-- CreateIndex
CREATE INDEX "knowledge_sources_entity_type_entity_id_idx" ON "knowledge_sources"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "knowledge_documents_organization_id_idx" ON "knowledge_documents"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_documents_collection_id_idx" ON "knowledge_documents"("collection_id");

-- CreateIndex
CREATE INDEX "knowledge_documents_source_id_idx" ON "knowledge_documents"("source_id");

-- CreateIndex
CREATE INDEX "knowledge_documents_status_idx" ON "knowledge_documents"("status");

-- CreateIndex
CREATE INDEX "knowledge_documents_indexing_status_idx" ON "knowledge_documents"("indexing_status");

-- CreateIndex
CREATE INDEX "knowledge_document_versions_document_id_idx" ON "knowledge_document_versions"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_document_versions_document_id_version_key" ON "knowledge_document_versions"("document_id", "version");

-- CreateIndex
CREATE INDEX "knowledge_chunks_organization_id_idx" ON "knowledge_chunks"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_version_id_idx" ON "knowledge_chunks"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_id_version_number_chunk_index_key" ON "knowledge_chunks"("document_id", "version_number", "chunk_index");

-- CreateIndex
CREATE INDEX "knowledge_embeddings_chunk_id_idx" ON "knowledge_embeddings"("chunk_id");

-- CreateIndex
CREATE INDEX "knowledge_embeddings_provider_type_model_name_idx" ON "knowledge_embeddings"("provider_type", "model_name");

-- CreateIndex
CREATE INDEX "knowledge_ingestion_jobs_organization_id_idx" ON "knowledge_ingestion_jobs"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_ingestion_jobs_document_id_idx" ON "knowledge_ingestion_jobs"("document_id");

-- CreateIndex
CREATE INDEX "knowledge_ingestion_jobs_status_idx" ON "knowledge_ingestion_jobs"("status");

-- CreateIndex
CREATE INDEX "knowledge_search_logs_organization_id_idx" ON "knowledge_search_logs"("organization_id");

-- CreateIndex
CREATE INDEX "knowledge_search_logs_user_id_idx" ON "knowledge_search_logs"("user_id");

-- CreateIndex
CREATE INDEX "copilot_workspaces_organization_id_idx" ON "copilot_workspaces"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "copilot_workspaces_organization_id_slug_key" ON "copilot_workspaces"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "copilot_conversations_organization_id_idx" ON "copilot_conversations"("organization_id");

-- CreateIndex
CREATE INDEX "copilot_conversations_workspace_id_idx" ON "copilot_conversations"("workspace_id");

-- CreateIndex
CREATE INDEX "copilot_conversations_user_id_idx" ON "copilot_conversations"("user_id");

-- CreateIndex
CREATE INDEX "copilot_conversations_status_idx" ON "copilot_conversations"("status");

-- CreateIndex
CREATE INDEX "copilot_messages_conversation_id_idx" ON "copilot_messages"("conversation_id");

-- CreateIndex
CREATE INDEX "copilot_messages_correlation_id_idx" ON "copilot_messages"("correlation_id");

-- CreateIndex
CREATE INDEX "copilot_action_previews_organization_id_idx" ON "copilot_action_previews"("organization_id");

-- CreateIndex
CREATE INDEX "copilot_action_previews_conversation_id_idx" ON "copilot_action_previews"("conversation_id");

-- CreateIndex
CREATE INDEX "copilot_action_previews_status_idx" ON "copilot_action_previews"("status");

-- CreateIndex
CREATE INDEX "copilot_usages_organization_id_idx" ON "copilot_usages"("organization_id");

-- CreateIndex
CREATE INDEX "copilot_usages_user_id_idx" ON "copilot_usages"("user_id");

-- CreateIndex
CREATE INDEX "copilot_usages_workspace_id_idx" ON "copilot_usages"("workspace_id");

-- AddForeignKey
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_workflow_versions" ADD CONSTRAINT "automation_workflow_versions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "automation_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_workflow_versions" ADD CONSTRAINT "automation_workflow_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "automation_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_step_executions" ADD CONSTRAINT "automation_step_executions_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_schedules" ADD CONSTRAINT "automation_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_schedules" ADD CONSTRAINT "automation_schedules_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "automation_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "automation_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_source_workflow_id_fkey" FOREIGN KEY ("source_workflow_id") REFERENCES "automation_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_source_execution_id_fkey" FOREIGN KEY ("source_execution_id") REFERENCES "automation_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_tasks" ADD CONSTRAINT "automation_tasks_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_action_executions" ADD CONSTRAINT "automation_action_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_action_executions" ADD CONSTRAINT "automation_action_executions_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "automation_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_source_execution_id_fkey" FOREIGN KEY ("source_execution_id") REFERENCES "automation_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_notifications" ADD CONSTRAINT "automation_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_collections" ADD CONSTRAINT "knowledge_collections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_collections" ADD CONSTRAINT "knowledge_collections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "knowledge_collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "knowledge_collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_document_versions" ADD CONSTRAINT "knowledge_document_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_ingestion_jobs" ADD CONSTRAINT "knowledge_ingestion_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_ingestion_jobs" ADD CONSTRAINT "knowledge_ingestion_jobs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_search_logs" ADD CONSTRAINT "knowledge_search_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_search_logs" ADD CONSTRAINT "knowledge_search_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_workspaces" ADD CONSTRAINT "copilot_workspaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_workspaces" ADD CONSTRAINT "copilot_workspaces_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_conversations" ADD CONSTRAINT "copilot_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_conversations" ADD CONSTRAINT "copilot_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "copilot_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_conversations" ADD CONSTRAINT "copilot_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "copilot_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_action_previews" ADD CONSTRAINT "copilot_action_previews_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_action_previews" ADD CONSTRAINT "copilot_action_previews_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "copilot_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_action_previews" ADD CONSTRAINT "copilot_action_previews_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "copilot_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_action_previews" ADD CONSTRAINT "copilot_action_previews_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_usages" ADD CONSTRAINT "copilot_usages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_usages" ADD CONSTRAINT "copilot_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
