# AI Governance (Phase 12)

## The single choke point

`server/ai/governance.ts`'s `executeGovernedTool` is the only code path that reaches a tool's `handler`. Nothing else — not a route, not the workflow runner, not the approval-decision service — calls `AiToolDefinition.handler` directly. Every governed call goes through, in order:

1. **Tool resolution** — `toolCode` must be a registered code (`server/ai/toolRegistry.ts`) and its `AITool` catalog row must exist with `status: ENABLED`.
2. **Permission check** — the caller's role must hold the tool's own `requiredPermission` (or be `SUPER_ADMIN`), checked against `caller.role.permissions` exactly like `requirePermission` middleware — independent of whatever route-level permission gated the request (see "Two permission layers" below).
3. **Org enablement check** — `AIOrgToolSetting` for this organization/tool must not be explicitly disabled (`enabled: false`). Absent a row, a tool is enabled by default.
4. **Input validation** — `input` is parsed against the tool's own Zod `inputSchema`; a caller can never pass through fields the tool doesn't declare.
5. **Risk/approval gate** — see "Approval gate" below.
6. **Execution** — the tool's `handler(caller, validatedInput, meta)` runs, calling the same service a human would with the same `SanitizedUser` caller.
7. **Audit** — every attempt, successful or not, writes an `AuditLog` row (`AI_TOOL_EXECUTED`, `AI_TOOL_EXECUTION_FAILED`, or `AI_TOOL_APPROVAL_REQUESTED`) with `actorType: AI_COWORKER` and `actorName: ai-tool:<code>` — an AI-attributed action is never invisible to `audit.read`.

## Two permission layers, on purpose

A route like `POST /ai/executions/tool-call` is gated by the general `ai.workflows.execute` permission — "can this caller invoke governed AI actions at all." The dispatcher then separately checks the *specific* tool's own `requiredPermission` (e.g. `clients.create`). A caller who can execute AI actions in general but lacks a specific tool's underlying business permission is rejected by the dispatcher even though the route-level check passed — proven by a dedicated test (`tests/security/aiGovernance.test.ts`, "denies a caller who has ai.workflows.execute but lacks the specific tool's own required permission"). This mirrors how a human's session works: holding a role doesn't grant every permission that role's *members* might individually have been denied via a narrower key.

## Approval gate (§17) and the financial-bypass-prevention guarantee

`resolveRequiresApproval(definition, orgOverride)`:
```
HIGH risk           → always requires approval (cannot be overridden)
definition says yes → always requires approval (cannot be overridden)
otherwise           → only if the org's AIOrgToolSetting.requireApprovalOverride is true
```
An `AIOrgToolSetting.requireApprovalOverride` can only ever **add** an approval requirement, never remove the one a HIGH-risk tool always carries. There is no code path from the dispatcher into `invoiceService.issueInvoice` or `contractService.activateContract` (the two HIGH-risk tools registered today) that skips creating an `AIApprovalRequest` first — verified directly: `tests/security/aiGovernance.test.ts`'s "financial-bypass prevention" suite calls the `invoices.issue` tool and asserts the invoice's status is still `DRAFT` immediately after (202 response, `AWAITING_APPROVAL` execution status), stays `DRAFT` after a rejection, and only becomes `ISSUED` once a caller holding `ai.approvals.decide` approves.

When approval is required, the dispatcher creates an `AIToolExecution` (`status: AWAITING_APPROVAL`) and an `AIApprovalRequest` (`status: PENDING`, `payloadHash` = sha256 of the validated input, `expiresAt` = 72 hours out) and returns without executing anything. The tool's handler is never called at this point.

### Deciding an approval

`server/services/aiApprovalService.ts`'s `decide`:
- **Reject** — marks the request `REJECTED` and the tool execution `CANCELLED`. The underlying resource (e.g. the invoice) is never touched.
- **Approve** — re-validates the stored `payloadHash` against the stored `payload` (a tamper/replay guard — a request whose payload no longer matches its hash, or that has expired, is never silently trusted), re-parses the payload against the tool's *current* input schema (in case the tool's contract changed since the request was made), then calls `runToolHandler` — the same function the no-approval path uses — as **the original requester**, not the approver. `authService.resolveSanitizedUserForOrganization` re-establishes that caller's real, current role/permissions; the approver authorizes the action, they do not become its actor. A second decision on an already-decided request is rejected (409).

A caller without `ai.approvals.decide` cannot approve or reject, even if they can see the pending request (`ai.approvals.read` is a separate, broader-granted permission — VIEWER can see what's pending without being able to act on it).

## Tenant isolation

Every AI resource — executions, tool executions, approvals, workflows, prompt templates, org tool settings — carries `organizationId` and is loaded exclusively through `findByIdInOrg`-style repository methods. A different organization's caller gets a 404, never the record, on every one of these (dedicated IDOR tests in `tests/integration/aiWorkflows.test.ts` and `tests/security/aiGovernance.test.ts`).

## Rate limiting

`aiExecutionLimiter` (`server/middleware/rateLimiter.ts`) — 30 requests per 5 minutes, keyed per-caller — applies to `POST /ai/workflows/:id/execute` and `POST /ai/executions/tool-call`. Tighter than general API traffic because each call can reach an external AI provider or mutate real data.

## Audit trail

Beyond the per-tool-call audit entries above, every administrative mutation (provider/model create/update, tool org-setting change, prompt template/version create/publish/archive, workflow create/update/publish/archive, approval decisions) writes its own `AuditLog` row with `actorType: USER` — the human administrator, not the AI, since these are governance configuration changes a human made, not an AI action.
