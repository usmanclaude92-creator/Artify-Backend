# AI Tool Security (Phase 12)

## The governing rule

An AI coworker can never execute arbitrary SQL, shell commands, filesystem access, or unrestricted network requests — the rule Phase 1's `server/ai/tools.ts` placeholder existed to enforce, now made real. Every action it can take is a registered `AiToolDefinition` (`server/ai/toolRegistry.ts`) with an explicit required permission, a Zod input schema, and a declared risk tier — nothing else is reachable. The Phase 1 placeholder file (empty registry, `NotImplementedError` on any call) has been deleted; its role is fully replaced by the real registry plus `server/ai/governance.ts`.

## Registry-as-catalog

Each tool wraps an *existing* service method — no AI-only business logic exists. `prisma/aiToolSeed.ts` syncs the code registry into the `ai_tools` table (the same "code is the source of truth, the DB row is governance metadata" pattern `rolePermissionSeed.ts` established for permissions), run on every boot/test-setup, idempotent, never deleting a code the current registry no longer defines (org settings and historical tool-execution rows may still reference it — `AIToolExecution.tool` is `onDelete: Restrict`).

## The registered tools

| Code | Wraps | Permission | Risk | Mutating | Approval |
|---|---|---|---|---|---|
| `leads.list` | `leadService.listLeads` | `leads.read` | READ_ONLY | no | no |
| `leads.create` | `leadService.createLead` | `leads.create` | LOW | yes | no |
| `leads.convert` | `leadService.convertLead` | `leads.convert` | MEDIUM | yes | no |
| `clients.list` | `clientService.listClients` | `clients.read` | READ_ONLY | no | no |
| `clients.create` | `clientService.createClient` | `clients.create` | LOW | yes | no |
| `content.list_posts` | `postService.listPosts` | `content.read` | READ_ONLY | no | no |
| `content.create_draft` | `postService.createPost` | `content.create` | MEDIUM | yes | no |
| `products.list` | `productService.listProducts` | `products.read` | READ_ONLY | no | no |
| `invoices.issue` | `invoiceService.issueInvoice` | `invoices.issue` | **HIGH** | yes | **always** |
| `contracts.activate` | `contractService.activateContract` | `contracts.activate` | **HIGH** | yes | **always** |

`content.create_draft` never publishes — `postService.createPost` has no `status` field to set (new posts always start `DRAFT`), so an AI-authored draft always needs a human `submitForReview`/`publishPost` action to go live.

## Risk tiering

- **READ_ONLY** — no side effects. Never approval-gated.
- **LOW** — a reversible or low-blast-radius mutation (creating a lead/client record). Never approval-gated by default.
- **MEDIUM** — a mutation with real but bounded consequences (converting a lead, drafting content). Not approval-gated by default, but an organization can opt in via `AIOrgToolSetting.requireApprovalOverride`.
- **HIGH** — money movement or a contract-binding action. Always approval-gated; no org override can turn this off (`server/ai/governance.ts`'s `resolveRequiresApproval` — see `docs/AI_GOVERNANCE.md`).

## Per-organization control

`AIOrgToolSetting` (organization + tool code, `@@unique`) lets an organization disable a tool entirely (`enabled: false`, checked before input validation — a disabled tool is rejected with `AuthorizationError`, never silently no-op'd) or raise a LOW/MEDIUM tool's bar to require approval. An organization cannot lower a HIGH-risk tool's bar — there is no `false` override path for `resolveRequiresApproval` when `riskLevel === "HIGH"`.

## Input validation as a security boundary

Each tool's Zod `inputSchema` is deliberately narrower than the underlying service's own accepted input — e.g. `clients.create`'s schema omits `legalName`/`status`/`accountManager` even though `clientService.createClient` accepts them, so an AI-authored client record always starts in the default status with only the fields a triage/intake flow plausibly needs. `invoices.issue`/`contracts.activate` take only an id — no ability to alter what's being issued/activated, only whether.

## Auditability

Every tool call, successful or not, and every approval-request creation writes an `AuditLog` row with `actorType: AI_COWORKER`, `actorName: ai-tool:<code>` — `actorUserId` is never set to an AI (that FK must only ever reference a real human user row; the caller's identity is recorded via `AIExecution.userId` and `AIApprovalRequest.requestedById` instead). `audit.read` therefore surfaces the complete AI action history alongside human actions, in the same log.
