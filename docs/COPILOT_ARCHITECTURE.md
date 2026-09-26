# AI Copilot & Conversational Workspace Architecture (Phase 15)

Imported from `usmanclaude92-creator/Artify-Backend---Google-AI-Studio-`
(commit `4a1d7cd`), then adapted to this repo's own AI foundation — see
"Relationship to Phase 12" below for what changed and why.
`server/routes/v1/copilotRoutes.ts` was also rewritten, from the source's
raw try/catch + `res.json({success,...})` handlers to this repo's
`asyncHandler`/`sendSuccess` convention.

## What this is

A chat-style, per-user, per-workspace conversational interface
(`CopilotWorkspace` → `CopilotConversation` → `CopilotMessage`) layered on
top of this repo's real services, with three distinguishing properties:

1. **Workspaces gate what a conversation can see and do.** Each
   `CopilotWorkspace` declares `requiredPermissions`; `listWorkspaces`/
   `getWorkspace` filter/reject based on the caller's actual RBAC
   permissions (a `*` superadmin sees everything). System workspaces are
   self-seeded per organization on first access (`ensureDefaultWorkspaces`)
   rather than requiring a migration-time fixture per tenant.
2. **Server-side entity-context validation.** A message can carry
   `contextMetadata` (e.g. "the client currently open in the UI"), but
   `validateEntityContext` re-resolves every referenced entity ID against
   the database (scoped to the caller's `organizationId`) before it's used
   in a prompt — the client-supplied context is never trusted as-is, which
   prevents a tampered `selectedClientId` from leaking or acting on another
   tenant's data.
3. **Consequential actions are previewed, never executed inline.** When a
   conversation turn would change data (e.g. change a client's status,
   run a workflow), `sendMessage` creates a `CopilotActionPreview` row
   (`PENDING`) and returns it to the caller instead of performing the
   change — `confirmAction`/`rejectAction` are separate, explicit calls,
   each independently permission-checked. This mirrors the same
   "propose, then a separate confirm" shape as Phase 13's
   `ApprovalEngine` (`docs/AUTOMATION_ARCHITECTURE.md`), by design — two
   independently-scoped human-in-the-loop gates for two different kinds of
   AI-initiated action, not a gap to unify.

## Relationship to Phase 12's AI Control Center

The source repo's Copilot depended on its own parallel AI Control Center
(`aiRepository`, and an `AI_TOOL_REGISTRY`/`aiToolExecutor` from its own
`server/ai/tools.ts`) — the same excluded stack described in
`docs/AUTOMATION_ARCHITECTURE.md`. Rather than run two parallel "AI tool
execution" systems side by side, this file calls this repo's real,
existing services directly where the source called its own tool registry:

- **Text generation** uses this repo's existing `defaultAiProvider`
  (`server/ai/provider.ts`) via `generateText(prompt, {systemInstruction,
  temperature, maxOutputTokens})`, not the source's `AdapterFactory`/
  `apiKey`+`model` call shape (which did not actually match that adapter's
  own declared interface in the source repo — not replicated here).
- **`confirmAction`'s `modifyClientStatus` tool** calls this repo's real
  `clientService.updateClient(...)` (resolving a full `SanitizedUser`
  caller via `resolveSanitizedUserForOrganization` first, so the update
  carries proper audit attribution) instead of the excluded tool registry.
- **`confirmAction`'s `executeWorkflow` tool** calls this repo's real
  `workflowEngine.enqueueExecution`/`execute` (Phase 13), not a stub.
- **Knowledge grounding** calls `KnowledgeService.search`/
  `getGroundedContext` directly (Phase 14) — unaffected by the exclusion,
  since Knowledge never depended on the excluded stack in the first place.

As with Automation, the source repo's own registry was itself still an
empty Phase-1 placeholder at the call sites being replaced, so this
adaptation makes Copilot's tool-invoking paths genuinely functional for
the first time rather than downgrading a working system.

## Graceful degradation when the AI provider is unavailable

`sendMessage` calls the provider inside a `try/catch`; on failure (for
example `AI_PROVIDER=none` in test/dev, or a transient Gemini error) it
still returns a `COMPLETED` assistant message, built from whatever
citations/tool-results/action-preview data was already gathered before the
generation call, rather than surfacing a raw 500 to the user. See
`tests/integration/copilot.test.ts`'s "falls back gracefully" test.

## Permissions

`copilot.read` / `.use` / `.manage` / `.admin`, seeded per role in
`prisma/rolePermissionSeed.ts`.
