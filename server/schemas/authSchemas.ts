import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().trim().min(1).email(),
  // Minimum length only in Phase 1 — full password-strength policy
  // (entropy/breach-list check) is a Phase 3 hardening item.
  password: z.string().min(10, "Password must be at least 10 characters"),
  fullName: z.string().trim().min(1).max(200),
  companyName: z.string().trim().min(1).max(200),
  industry: z.string().trim().max(200).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;
