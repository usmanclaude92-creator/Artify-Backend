# Automation Architecture (Phase 13)

Imported from `usmanclaude92-creator/Artify-Backend---Google-AI-Studio-`
(commit `4a1d7cd`) and adapted to this repo's own foundation — see
"Relationship to Phase 12" below for what changed and why.

## What this is, and how it differs from Phase 12's AI Workflows

Phase 12's `AIWorkflow` (`docs/AI_WORKFLOW_ARCHITECTURE.md`) is deliberately
small: a bounded, synchronous sequence of governed tool calls that runs to
completion (or an approval gate) within one HTTP request. Phase 13's
`AutomationWorkflow` is the opposite kind of system on purpose: an
asynchronous, background, event-or-schedule-driven engine with conditional
branching, loops, human-in-the-loop approval gates, and multi-day-long
running executions. They are not competing implementations of the same
idea — Phase 12 answers "run these three tool calls now, safely"; Phase 13
answers "when a lead is created, wait a day, then if it's still untouched,
notify the assigned rep and create a follow-up task." Both remain in the
platform; a workflow author picks whichever shape fits.

## Components

- **`WorkflowEngine`** — the execution loop. `enqueueExecution` creates an
  `AutomationExecution` row (`QUEUED`) and schedules a background run;
  `processQueue` (polled by a scheduler tick) picks up anything still
  `QUEUED`. `execute` runs steps in order, tracking `currentStepIndex` so a
  paused execution (waiting on approval, or resumed after a retry) picks up
  exactly where it left off rather than re-running completed steps.
- **`ConditionEngine`** — evaluates `CONDITION` step branching logic
  against the execution's accumulated `context`.
- **`ActionRegistry`** — the catalog of pre-built, permission-gated
  business actions (`assign_user`, `create_task`, `update_client`,
  `create_notification`, `generate_report`, `create_invoice_draft`,
  `update_workflow_status`, `publish_approved_content`,
  `send_approved_notification`). Each declares its own
  `requiredPermission`/`riskLevel`/`requiresApproval`/`requiresAudit` and is
  only ever invoked through `executeAction()` — never called directly.
- **`ApprovalEngine`** — human-in-the-loop gate. A step (either an explicit
  `APPROVAL` step, or a `BUSINESS_ACTION` step with `requireApproval: true`)
  parks the execution at `WAITING_APPROVAL` and creates an
  `AutomationApproval` row; `decideApproval` records the decision and, on
  approval, resumes the execution via `WorkflowEngine.resumeExecution`.
- **`NotificationEngine`** — dispatches `NOTIFICATION` steps to a user, a
  role, or both, through the org's existing in-app `Notification` table
  (for `IN_APP`) and/or the automation-specific `automation_notifications`
  log (all channels), respecting each user's existing
  `NotificationPreference` row.
- **`TaskManager`** / **`SchedulerEngine`** — CRUD + listing for
  `AutomationTask` (ad hoc or AI-generated follow-up work items) and
  `AutomationSchedule` (cron/interval/one-time triggers that call back into
  `WorkflowEngine.enqueueExecution`).
- **`EventEngine`** — an in-process pub/sub bus. Any part of the platform
  can `emit()` a business event (e.g. `lead.created`); `AutomationService`
  subscribes and fans matching events out to every `ACTIVE` workflow whose
  `triggerType: EVENT` and `triggerConfig.eventType` match (with an
  optional `filterCondition` evaluated via `ConditionEngine`).
- **`WorkflowValidator`** — strict pre-publish validation (unique step IDs,
  valid trigger config per `triggerType`, a real `toolCode`/`actionId` for
  every `TOOL_CALL`/`BUSINESS_ACTION` step, bounded `limits`/`retryPolicy`).
  A workflow cannot move out of `DRAFT` without passing this.

## Relationship to Phase 12's AI Control Center

The source repo has its own, second, parallel "AI Control Center" — models
`AiProvider`/`AiModel`/`AiAgent`/`AiPrompt`/`AiTool`/`AiWorkflow`/
`AiApproval`/`AiExecution`, a governed `aiToolExecutor`/`AI_TOOL_REGISTRY`
(`server/ai/tools.ts`), an `AiOrchestrator` service, and routes mounted at
`/api/v1/ai` — an exact path collision with this repo's own, already-built
and tested Phase 12 AI Control Center. That entire stack was **deliberately
not imported**. Two consequences follow:

1. **`TOOL_CALL` steps** call this repo's real governed tool registry
   (`server/ai/toolRegistry.ts`'s `AI_TOOL_REGISTRY`) directly — permission-
   checked against the step's initiating user (resolved via
   `resolveSanitizedUserForOrganization`; a `TOOL_CALL` step with no
   `initiatedById` fails loudly rather than running as an unattributed
   system actor). The handler is invoked directly
   (`definition.handler(caller, input, meta)`) rather than through Phase
   12's full `executeGovernedTool` dispatcher, because that dispatcher
   writes `AIToolExecution` rows keyed by an `AIExecution` id — an
   `AutomationExecution` id passed there would violate that FK.
2. **`AI_DECISION`/`AI_GENERATION` steps** call this repo's existing
   `defaultAiProvider` (`server/ai/provider.ts`) instead of the source's
   `aiOrchestrator`/agent catalog, which this repo does not have.
3. **Approval decisions are not mirrored into `AIApprovalRequest`.** The
   source repo copied every `AutomationApproval` decision into its own
   Phase 12 approval table for a unified view. This repo's actual Phase 12
   approval model has different invariants (a payload-hash tamper guard,
   HIGH-risk-always-required semantics) that this engine does not itself
   enforce, so automation approvals stay in `automation_approvals` only —
   two approval queues, not one blended and inconsistent one.

In every one of these cases the source repo's own registry was itself
still an empty Phase-1 placeholder ("No tools are registered yet"), so the
call sites being replaced were non-functional stubs there. Re-pointing them
at this repo's real, tested tool registry and provider makes Automation's
AI-touching steps genuinely functional for the first time, not a downgrade.

## RESTRICT, not CASCADE

Unlike Phase 12's AI tables (mostly `Cascade` on `organizationId`), every
Automation table `Restrict`s its `organizationId` foreign key, as imported.
`tests/helpers/db.ts`'s `resetDb()` explicitly deletes every automation row
before deleting `Organization` rows for this reason.

## Known schema gap fixed during import

The source repo's `WorkflowEngine`/`WorkflowValidator`/`types.ts` all treat
`KNOWLEDGE_RETRIEVAL` as a valid `WorkflowStepConfig.type` (added later, in
Phase 14), but its own `AutomationStepType` Prisma enum was never updated
to include it — a step of that type would fail at the database layer with
`Invalid value for argument stepType`. This is a genuine gap in the source
repo, not an intentional design choice, so it was fixed here: this repo's
`AutomationStepType` enum includes `KNOWLEDGE_RETRIEVAL`
(migration `20260926131423_add_knowledge_retrieval_step_type`).

## Permissions

`automation.read` / `.create` / `.edit` / `.publish` / `.execute` /
`.approve` / `.manage` — a separate namespace from Phase 12's `ai.*` keys,
seeded per role in `prisma/rolePermissionSeed.ts`.
