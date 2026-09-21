# AI Architecture (Phase 12)

## Concept boundaries

The Phase 1 foundation (`server/ai/provider.ts`) is a pluggable `AiProvider` abstraction with exactly one implementation (Gemini) and no business routes. Phase 12 builds the governed automation layer on top of it without touching that boundary: credentials stay in server-side env config (`GEMINI_API_KEY`, never a database row), and the new `AIProvider`/`AIModel` tables are administrative *catalog* metadata only — which providers/models the platform knows about, their pricing/capability flags — never a secret store.

```
AIProvider ── AIModel[]
AITool (platform catalog, code-seeded) ── AIOrgToolSetting (per-org override)
AIPromptTemplate ── AIPromptVersion[] (immutable once created)
AIWorkflow ── steps: [{order, toolCode}] (bounded, deterministic)
AIExecution (kind: TOOL_CALL | WORKFLOW)
  ├─ AIToolExecution[] (one per governed tool call)
  ├─ AIUsageRecord[] (token/cost, best-effort)
  └─ AIApprovalRequest[] (HIGH-risk gate)
```

All organization-scoped AI tables (`AIOrgToolSetting`, `AIPromptTemplate`, `AIWorkflow`, `AIExecution`, `AIUsageRecord`, `AIApprovalRequest`) carry `organizationId` and follow the established `findByIdInOrg`-only repository convention. `AIProvider`/`AIModel`/`AITool` are platform-global, same pattern as Phase 7's `Product` catalog.

## Execution model

Two execution kinds, matching `AIExecutionKind`:
- **`TOOL_CALL`** — a single governed tool invocation (`POST /ai/executions/tool-call`), e.g. a human coworker's assistant panel invoking one action.
- **`WORKFLOW`** — a bounded, deterministic sequence of tool calls defined by `AIWorkflow.steps` (`POST /ai/workflows/:id/execute`), run in order up to `maxSteps` (≤10) within `timeoutMs`.

Both kinds create an `AIExecution` row first, then call every tool through `server/ai/governance.ts`'s `executeGovernedTool` — there is no code path that invokes a tool's handler directly from a route or workflow runner. A workflow stops at the first step that fails or requires approval; there is no retry/resume in Phase 12 (deliberately — see the Phase 13 boundary below).

There is no autonomous LLM tool-calling loop in Phase 12. `AIExecutionKind` has only `TOOL_CALL`/`WORKFLOW`, not a general chat kind — prompt templates exist as versioned, reusable instruction catalogs (§14/§15) for whatever consumes them (a workflow step's rendering, a future assistant surface), not as a standalone freeform-generation endpoint. This keeps the AI surface reviewable: every action an AI coworker can take is a named, registered tool with a declared risk tier, never an open-ended model call that can do anything the provider's API allows.

## Tool registry

`server/ai/toolRegistry.ts` defines 10 real tools, each a thin wrapper around an *existing* human-facing service (`leadService`, `clientService`, `postService`, `productService`, `invoiceService`, `contractService`) — no parallel AI-only business logic exists anywhere. Every tool handler calls the same service method a human would, with the same `SanitizedUser` caller, so it gets the same validation, tenant scoping, and audit trail for free. See `docs/AI_TOOL_SECURITY.md` for the full registry and risk tiering.

## Prompt templates

Organization-scoped via the same "global = Artify's own internal organization" convention `SystemSetting` established in Phase 4 — avoids the nullable-`organizationId` uniqueness edge case. A template's `currentVersionId` is its only mutable pointer; `AIPromptVersion` rows are immutable once created (`server/repositories/aiPromptRepository.ts` never exposes an update on a version, only `createVersion` + `publishVersion`). Publishing a new version is two steps — create, then publish — so a draft can be reviewed before it becomes live.

## Usage & cost tracking

`server/ai/provider.ts`'s `AiProvider.generateText` now returns `{text, model, usage?}`, reading Gemini's own `usageMetadata` (`promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`) when the API reports it. `AIUsageRecord` is an operational metric, explicitly not Phase 10 billing data (`estimatedCost` is a `Decimal` for consistency with the platform's one financial-math rule, but nothing here ever touches an `Invoice`/`Payment` row). See `docs/AI_USAGE_AND_COSTS.md`.

## Endpoints

```
GET/POST      /api/v1/ai/providers                   ai.providers.read / ai.providers.manage
PATCH         /api/v1/ai/providers/:id                ai.providers.manage
GET/POST      /api/v1/ai/providers/models             ai.models.read / ai.models.manage
PATCH         /api/v1/ai/providers/models/:id         ai.models.manage
GET           /api/v1/ai/tools                        ai.tools.read
PATCH         /api/v1/ai/tools/:code/settings          ai.tools.manage
GET/POST      /api/v1/ai/prompts                       ai.prompts.read / ai.prompts.create
PATCH         /api/v1/ai/prompts/:id                    ai.prompts.update
POST          /api/v1/ai/prompts/:id/versions           ai.prompts.update
POST          /api/v1/ai/prompts/:id/publish             ai.prompts.publish
DELETE        /api/v1/ai/prompts/:id                     ai.prompts.delete
GET/POST      /api/v1/ai/workflows                      ai.workflows.read / ai.workflows.create
PATCH         /api/v1/ai/workflows/:id                   ai.workflows.update
POST          /api/v1/ai/workflows/:id/publish            ai.workflows.publish
DELETE        /api/v1/ai/workflows/:id                    ai.workflows.delete
POST          /api/v1/ai/workflows/:id/execute            ai.workflows.execute (rate-limited)
GET           /api/v1/ai/executions                       ai.executions.read
GET           /api/v1/ai/executions/:id                    ai.executions.read
POST          /api/v1/ai/executions/tool-call               ai.workflows.execute (rate-limited)
GET           /api/v1/ai/usage[/summary]                    ai.usage.read
GET           /api/v1/ai/approvals[/:id]                     ai.approvals.read
POST          /api/v1/ai/approvals/:id/decide                 ai.approvals.decide
```

## Deliberate Phase 12 scope boundaries

No autonomous multi-turn agent loop, no LLM-driven dynamic tool selection, no background/async execution (a workflow run is synchronous within its request), no external integrations beyond the existing Gemini provider, no notifications when an approval is pending. See `docs/AI_GOVERNANCE.md` and `docs/AI_WORKFLOW_ARCHITECTURE.md` for what these boundaries mean for governance, and the Phase 13 brief for what picks this up (async execution, background jobs, notifications) without weakening any governance control established here.
