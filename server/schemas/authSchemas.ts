import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().trim().min(1).email(),
  // Minimum length only in Phase 1/2 — full password-strength policy
  // (entropy/breach-list check) is a Phase 3 hardening item.
  password: z.string().min(10, "Password must be at least 10 characters"),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  organizationName: z.string().trim().min(1).max(200),
});
export type RegisterInput = z.infer<typeof registerSchema>;
