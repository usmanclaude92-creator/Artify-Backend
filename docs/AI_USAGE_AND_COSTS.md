# AI Usage & Costs (Phase 12)

## Operational metric, not billing data

`AIUsageRecord` tracks token counts and an estimated cost per AI-provider call — deliberately positioned as an operational metric for administrators to watch spend, never as Phase 10 billing data. No `AIUsageRecord` row is ever read by, written by, or connected to `Invoice`/`Payment`/`Contract`/`Subscription` — the two systems are unrelated. `estimatedCost` is still a `Prisma.Decimal` (`NUMERIC(18,6)`), matching the platform's one financial-math rule (never a JS float for a monetary value) even though it isn't authoritative billing data, so a cost figure displayed to an administrator is at least internally consistent.

## What gets recorded, and how

`server/ai/provider.ts`'s `AiProvider.generateText` returns `{text, model, usage?}`. For the Gemini implementation, `usage` is read directly from the SDK response's `usageMetadata` (`promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`) when the API reports it — never estimated or guessed when the provider doesn't supply it. `AIUsageRecord.inputTokens`/`outputTokens`/`totalTokens` are therefore nullable: a call whose provider didn't report usage still gets an `AIExecution` row (nothing about billing tracking blocks the action itself), just no corresponding usage row.

Phase 12's registered tools (`server/ai/toolRegistry.ts`) are all deterministic service wrappers, not LLM generation calls — none of them currently produce a usage record. The usage-tracking plumbing (repository, service, API, UI) exists and is exercised by tests against synthetic data now, ready for the moment a prompt-template-driven generation call is wired into an execution path.

## Read surface

`aiUsageRepository`/`aiUsageService` expose two views, both organization-scoped and date-range-filterable (`dateFrom`/`dateTo`):
- **`listUsage`** — the raw `AIUsageRecord` rows, newest first.
- **`summary`** — `Prisma.aggregate` totals (`_sum`, `_count`) plus a `groupBy(modelId)` breakdown, so "how much have we spent, and on what" is one call, not client-side reduction over potentially many rows.

`GET /ai/usage` and `GET /ai/usage/summary` are both gated by `ai.usage.read` alone — no separate write endpoint exists; usage rows are written exclusively by the execution path, never editable via the API.

## Control Center surface

`AiUsagePage.tsx` renders the summary view: request count, input/output token totals, estimated cost, and a per-model breakdown table. An empty state (`summary.totals._count === 0`) is shown honestly rather than rendering a zeroed dashboard that looks like real data.

## Deliberate Phase 12 boundaries

No budget/spend-limit enforcement (a usage figure is informational only — nothing here throttles or blocks a call for exceeding a cost threshold). No per-user cost attribution beyond what `AIExecution.userId` already implies by join. No export/reporting beyond the summary endpoint. No connection to any external billing or metering service.
