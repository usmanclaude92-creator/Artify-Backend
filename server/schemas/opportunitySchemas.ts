import { z } from "zod";

export const opportunityStageSchema = z.enum(["PROSPECTING", "QUALIFICATION", "PROPOSAL", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"]);

/** Every non-terminal stage the generic PATCH may set directly — CLOSED_WON/CLOSED_LOST are reachable only via POST /opportunities/:id/win|lose. */
export const nonTerminalOpportunityStageSchema = z.enum(["PROSPECTING", "QUALIFICATION", "PROPOSAL", "NEGOTIATION"]);

export const listOpportunitiesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  stage: opportunityStageSchema.optional(),
  clientId: z.string().trim().uuid().optional(),
  assignedTo: z.string().trim().uuid().optional(),
  sort: z.enum(["createdAt", "updatedAt", "name", "value", "expectedCloseDate", "stage"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListOpportunitiesQuery = z.infer<typeof listOpportunitiesQuerySchema>;

const moneyValueSchema = z.coerce.number().nonnegative().finite();
const currencySchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code")
  .optional();

export const createOpportunitySchema = z.object({
  clientId: z.string().trim().uuid(),
  leadId: z.string().trim().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  stage: nonTerminalOpportunityStageSchema.optional(),
  value: moneyValueSchema,
  currency: currencySchema,
  expectedCloseDate: z.coerce.date().optional(),
  notes: z.string().trim().max(5000).optional(),
  assignedTo: z.string().trim().uuid().optional(),
});
export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

export const updateOpportunitySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    stage: nonTerminalOpportunityStageSchema.optional(),
    value: moneyValueSchema.optional(),
    currency: currencySchema,
    expectedCloseDate: z.coerce.date().nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    assignedTo: z.string().trim().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

export const loseOpportunitySchema = z.object({
  lostReason: z.string().trim().max(1000).optional(),
});
export type LoseOpportunityInput = z.infer<typeof loseOpportunitySchema>;
