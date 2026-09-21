/**
 * Phase 12 AI tool registry — the real tools an AI coworker can call, each
 * one a thin, governed wrapper around an *existing* human-facing service
 * (leadService, clientService, postService, productService, invoiceService,
 * contractService). There is deliberately no parallel "AI version" of any
 * business logic: every tool handler calls the same service method a human
 * would, with the same `SanitizedUser` caller, so it gets the same
 * validation, tenant scoping, and audit trail for free.
 *
 * `server/ai/governance.ts` is the only caller of `handler` — it is never
 * invoked directly from a route. Risk tiering (docs/AI_GOVERNANCE.md):
 *   - READ_ONLY: no side effects at all. No approval.
 *   - LOW: a reversible/low-blast-radius mutation. No approval.
 *   - MEDIUM: a mutation with real but bounded consequences. No approval by
 *     default, but an org can require one via AIOrgToolSetting.
 *   - HIGH: money movement or a contract-binding action. Approval is always
 *     required and cannot be turned off by an org override (see
 *     governance.ts's `resolveRequiresApproval` — the financial-bypass-
 *     prevention guarantee).
 */
import { z } from "zod";
import { leadService } from "../services/leadService";
import { clientService } from "../services/clientService";
import { postService } from "../services/postService";
import { productService } from "../services/productService";
import { invoiceService } from "../services/invoiceService";
import { contractService } from "../services/contractService";
import type { SanitizedUser } from "../types/domain";
import type { PermissionKey } from "../types/domain";
import type { RequestMeta } from "../services/authService";

export type AiToolRiskLevel = "READ_ONLY" | "LOW" | "MEDIUM" | "HIGH";

export interface AiToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny, TOutput = unknown> {
  code: string;
  name: string;
  description: string;
  requiredPermission: PermissionKey;
  riskLevel: AiToolRiskLevel;
  isMutating: boolean;
  /** Whether this tool needs a human approval before executing at all, independent of risk tier (a LOW/MEDIUM tool an org has chosen to gate). HIGH-risk tools are always approval-gated regardless of this flag — see governance.ts. */
  requiresApproval: boolean;
  inputSchema: TSchema;
  handler: (caller: SanitizedUser, input: z.infer<TSchema>, meta: RequestMeta) => Promise<TOutput>;
}

/**
 * Authors each tool with its own concrete schema (so `handler`'s `input`
 * parameter is fully typed against that tool's own zod schema), then
 * erases back to a common shape for the registry map — the erasure is
 * deliberate and safe: every call into a tool always re-validates `input`
 * against `definition.inputSchema` at runtime (server/ai/governance.ts),
 * so nothing here depends on the erased static type being precise.
 */
function tool<TSchema extends z.ZodTypeAny, TOutput>(def: AiToolDefinition<TSchema, TOutput>): AiToolDefinition<z.ZodTypeAny, unknown> {
  return def as unknown as AiToolDefinition<z.ZodTypeAny, unknown>;
}

const listLeadsInput = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"]).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(50).default(20),
});

const createLeadInput = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().max(50).optional(),
  source: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(5000).optional(),
});

const convertLeadInput = z.object({
  leadId: z.string().uuid(),
  clientCode: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().max(200).optional(),
  createContact: z.boolean().default(true),
});

const listClientsInput = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(50).default(20),
});

const createClientInput = z.object({
  clientCode: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9._-]+$/),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(255).optional(),
  phone: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(5000).optional(),
});

const listPostsInput = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(50).default(20),
});

const createDraftPostInput = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(500000).default(""),
  categoryId: z.string().trim().uuid().optional(),
});

const listProductsInput = z.object({
  search: z.string().trim().max(200).optional(),
  type: z.enum(["PRODUCT", "SERVICE"]).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(50).default(20),
});

const issueInvoiceInput = z.object({
  invoiceId: z.string().uuid(),
});

const activateContractInput = z.object({
  contractId: z.string().uuid(),
});

export const AI_TOOL_REGISTRY: Readonly<Record<string, AiToolDefinition<z.ZodTypeAny, unknown>>> = Object.freeze({
  "leads.list": tool({
    code: "leads.list",
    name: "List leads",
    description: "Search and list CRM leads for the caller's organization.",
    requiredPermission: "leads.read",
    riskLevel: "READ_ONLY",
    isMutating: false,
    requiresApproval: false,
    inputSchema: listLeadsInput,
    handler: async (caller, input) => {
      const { page, limit, ...filters } = input;
      return leadService.listLeads(caller.organizationId, filters, page, limit, "createdAt", "desc");
    },
  }),

  "leads.create": tool({
    code: "leads.create",
    name: "Create lead",
    description: "Create a new CRM lead in the caller's organization.",
    requiredPermission: "leads.create",
    riskLevel: "LOW",
    isMutating: true,
    requiresApproval: false,
    inputSchema: createLeadInput,
    handler: async (caller, input, meta) => leadService.createLead(caller, input, meta),
  }),

  "leads.convert": tool({
    code: "leads.convert",
    name: "Convert lead to client",
    description: "Convert an existing lead into a client record.",
    requiredPermission: "leads.convert",
    riskLevel: "MEDIUM",
    isMutating: true,
    requiresApproval: false,
    inputSchema: convertLeadInput,
    handler: async (caller, input, meta) => {
      const { leadId, ...rest } = input;
      return leadService.convertLead(caller, leadId, rest, meta);
    },
  }),

  "clients.list": tool({
    code: "clients.list",
    name: "List clients",
    description: "Search and list clients for the caller's organization.",
    requiredPermission: "clients.read",
    riskLevel: "READ_ONLY",
    isMutating: false,
    requiresApproval: false,
    inputSchema: listClientsInput,
    handler: async (caller, input) => {
      const { page, limit, ...filters } = input;
      return clientService.listClients(caller.organizationId, filters, page, limit, "createdAt", "desc");
    },
  }),

  "clients.create": tool({
    code: "clients.create",
    name: "Create client",
    description: "Create a new client record in the caller's organization.",
    requiredPermission: "clients.create",
    riskLevel: "LOW",
    isMutating: true,
    requiresApproval: false,
    inputSchema: createClientInput,
    handler: async (caller, input, meta) => clientService.createClient(caller, input, meta),
  }),

  "content.list_posts": tool({
    code: "content.list_posts",
    name: "List content posts",
    description: "Search and list CMS posts for the caller's organization.",
    requiredPermission: "content.read",
    riskLevel: "READ_ONLY",
    isMutating: false,
    requiresApproval: false,
    inputSchema: listPostsInput,
    handler: async (caller, input) => {
      const { page, limit, ...filters } = input;
      return postService.listPosts(caller.organizationId, filters, page, limit, "createdAt", "desc");
    },
  }),

  "content.create_draft": tool({
    code: "content.create_draft",
    name: "Create draft post",
    description: "Create a new CMS post in DRAFT status (never publishes — a human must submit/publish it separately).",
    requiredPermission: "content.create",
    riskLevel: "MEDIUM",
    isMutating: true,
    requiresApproval: false,
    inputSchema: createDraftPostInput,
    handler: async (caller, input, meta) => postService.createPost(caller, input, meta),
  }),

  "products.list": tool({
    code: "products.list",
    name: "List products",
    description: "Search and list the product/service catalog.",
    requiredPermission: "products.read",
    riskLevel: "READ_ONLY",
    isMutating: false,
    requiresApproval: false,
    inputSchema: listProductsInput,
    handler: async (_caller, input) => {
      const { page, limit, ...filters } = input;
      return productService.listProducts(filters, page, limit, "displayOrder", "asc");
    },
  }),

  "invoices.issue": tool({
    code: "invoices.issue",
    name: "Issue invoice",
    description: "Issue a draft invoice, making it payable. Moves money — always requires human approval.",
    requiredPermission: "invoices.issue",
    riskLevel: "HIGH",
    isMutating: true,
    requiresApproval: true,
    inputSchema: issueInvoiceInput,
    handler: async (caller, input, meta) => invoiceService.issueInvoice(caller, input.invoiceId, {}, meta),
  }),

  "contracts.activate": tool({
    code: "contracts.activate",
    name: "Activate contract",
    description: "Activate a contract, making it legally binding and billable. Always requires human approval.",
    requiredPermission: "contracts.activate",
    riskLevel: "HIGH",
    isMutating: true,
    requiresApproval: true,
    inputSchema: activateContractInput,
    handler: async (caller, input, meta) => contractService.activateContract(caller, input.contractId, meta),
  }),
});

export type AiToolCode = keyof typeof AI_TOOL_REGISTRY;

export function isRegisteredToolCode(code: string): code is AiToolCode {
  return Object.prototype.hasOwnProperty.call(AI_TOOL_REGISTRY, code);
}
