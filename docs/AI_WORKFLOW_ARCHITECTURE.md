# AI Workflow Architecture (Phase 12)

## Deliberately not a job/orchestration platform

`AIWorkflow.steps` is a small, bounded, deterministic JSON array (`{order, toolCode, description?}[]`), validated against `maxSteps` (≤10, enforced both at creation/update and at execution) and run to completion synchronously within the HTTP request that triggers it (`timeoutMs`, ≤120000, is a soft deadline checked between steps). There is no dynamic branching, no conditional logic, no autonomous planning, no unbounded loop, and no background execution — a workflow run either finishes (or fails, or hits an approval gate) within that one request, or it's cut off at its timeout. Full background-job infrastructure, retries, and async execution are explicitly Phase 13's territory, not this one's.

## Authoring

`aiWorkflowService.createWorkflow`/`updateWorkflow` validate every step's `toolCode` against the live tool registry (`isRegisteredToolCode`) — a workflow can never be saved referencing a tool that doesn't exist, so a later execution can't fail on a bad reference that authoring should have caught. A workflow starts `DRAFT` and must be explicitly published (`POST /ai/workflows/:id/publish`) before it can run — `executeWorkflow` rejects a non-`ACTIVE` workflow outright (400), so a draft under construction is never accidentally executable.

## Execution

`aiWorkflowService.executeWorkflow`:
1. Loads the workflow (tenant-scoped, must be `ACTIVE`), re-validates its steps against the current registry (in case a tool was deprecated since the workflow was last saved).
2. Creates one `AIExecution` row (`kind: WORKFLOW`, `workflowId` set).
3. Runs each step in `order`, calling `server/ai/governance.ts`'s `executeGovernedTool` with that step's own `stepOrder` and the caller-supplied `stepInputs[String(order)]` (Phase 12 has no autonomous planning — the caller supplies each step's own input up front, matching the "no dynamic branching" boundary above).
4. **Stops at the first non-`COMPLETED` result.** A step that comes back `AWAITING_APPROVAL` ends the workflow in that state immediately — later steps never run ahead of an unresolved approval. A step that `FAILED` ends the workflow `FAILED` with that step's error. There is no retry/resume in Phase 12; a workflow left `AWAITING_APPROVAL` or `FAILED` is a terminal state here — re-run the workflow from the start once whatever blocked it is resolved.
5. On success of every step, marks the execution `COMPLETED` with an array of per-step results.

Every step still goes through the full governance dispatcher (permission check, org enablement, input validation, risk/approval gate, audit) exactly as a direct `TOOL_CALL` execution would — a workflow is not a way to bypass any single-tool-call control, only a way to sequence several governed calls together.

## Bounded-ness as a security property

`maxSteps` isn't just a UX limit — `assertStepsValid` in `aiWorkflowService.ts` is called both at authoring time and again at execution time (defense in depth against a workflow row edited outside the normal API, or a future migration that widens the column without updating this check). A workflow with more steps than its own declared `maxSteps` is rejected before a single tool call runs.

## What a workflow cannot do

- Cannot call an unregistered tool (validated at both authoring and execution).
- Cannot execute a HIGH-risk step without triggering the same approval gate a direct call would (§ see `docs/AI_GOVERNANCE.md`) — a workflow step that reaches `invoices.issue` or `contracts.activate` stops the workflow at `AWAITING_APPROVAL` exactly like a standalone call does.
- Cannot exceed its own declared step count or run past its timeout.
- Cannot retry a failed or rejected step automatically — every re-attempt is a fresh, auditable execution.
