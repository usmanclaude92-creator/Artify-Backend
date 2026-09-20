/**
 * Centralized, validated environment configuration.
 *
 * Nothing else in the codebase should read `process.env` directly (enforced
 * by `no-restricted-syntax`-style review, not yet a lint rule — see
 * docs/SECURITY_CONFIGURATION.md). Every consumer imports `config` from
 * here. The process exits with a clear, non-sensitive error message if
 * required configuration is missing or invalid — it never falls back to a
 * hardcoded secret (that exact pattern — `WEBHOOK_SECRET || "artify_whsec_prod_2026_soc2"`
 * — was Phase 0 finding S3/S4/R3/R4 and must never recur).
 */
import dotenv from "dotenv";
import { z } from "zod";

// No-op in production platforms (Railway/Vercel) that inject real env vars
// directly and have no .env file to find — this only matters for local dev.
dotenv.config();

const KNOWN_COMPROMISED_WEBHOOK_SECRET = "artify_whsec_prod_2026_soc2";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),

    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
        message: "DATABASE_URL must be a postgresql:// connection string",
      }),

    SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
    COOKIE_DOMAIN: z.string().optional(),
    CORS_ORIGINS: z
      .string()
      .min(1, "CORS_ORIGINS is required (comma-separated list of allowed origins)")
      .transform((v) =>
        v
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      ),

    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    WEBHOOK_SECRET: z.string().min(16, "WEBHOOK_SECRET must be at least 16 characters"),

    AI_PROVIDER: z.enum(["gemini", "none"]).default("gemini"),
    GEMINI_API_KEY: z.string().optional().default(""),

    OBJECT_STORAGE_PROVIDER: z.enum(["none", "s3", "r2", "supabase"]).default("none"),
    OBJECT_STORAGE_BUCKET: z.string().optional().default(""),

    // Phase 3 — centralized security tunables (docs/AUTHENTICATION_ARCHITECTURE.md).
    // Never hard-code these values inline in service code; every consumer
    // reads them from `config` here.
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
    ACCOUNT_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
    ACCOUNT_LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(15),
    PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),
  })
  .superRefine((val, ctx) => {
    const isProdLike = val.NODE_ENV === "production" || val.NODE_ENV === "staging";

    if (val.WEBHOOK_SECRET === KNOWN_COMPROMISED_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WEBHOOK_SECRET"],
        message:
          "WEBHOOK_SECRET matches the value compromised in the Phase 0 audit (it was hardcoded in source and shipped to the browser). Generate a new secret and rotate it with the webhook provider — never reuse this value.",
      });
    }

    if (isProdLike) {
      if (val.SESSION_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SESSION_SECRET"],
          message: "SESSION_SECRET must be at least 32 characters in production/staging",
        });
      }
      if (val.CORS_ORIGINS.includes("*")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CORS_ORIGINS"],
          message: "CORS_ORIGINS must not contain '*' in production/staging — list explicit origins",
        });
      }
      if (val.AI_PROVIDER === "gemini" && !val.GEMINI_API_KEY) {
        // Not fatal: AI features degrade to "unavailable" rather than fail boot.
        // eslint-disable-next-line no-console
        console.warn(
          "[config] AI_PROVIDER=gemini but GEMINI_API_KEY is empty — AI endpoints will report unavailable until it is set."
        );
      }
    }
  });

export type AppConfig = Readonly<{
  nodeEnv: "development" | "test" | "staging" | "production";
  isProduction: boolean;
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  cookieDomain: string | undefined;
  corsOrigins: readonly string[];
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  webhookSecret: string;
  aiProvider: "gemini" | "none";
  geminiApiKey: string;
  objectStorageProvider: "none" | "s3" | "r2" | "supabase";
  objectStorageBucket: string;
  sessionTtlHours: number;
  accountLockoutThreshold: number;
  accountLockoutDurationMinutes: number;
  passwordResetTokenTtlMinutes: number;
  passwordMinLength: number;
}>;

export type EnvValidationResult =
  | { success: true; config: AppConfig }
  | { success: false; errors: string[] };

/**
 * Pure validation function — no process.exit, no console output. Exported
 * separately so unit tests can exercise every validation branch (missing
 * var, compromised secret reuse, weak prod secret, wildcard CORS in prod)
 * without killing the test process. See tests/unit/config.env.test.ts.
 */
export function validateEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): EnvValidationResult {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    };
  }

  const env = parsed.data;

  return {
    success: true,
    config: Object.freeze({
      nodeEnv: env.NODE_ENV,
      isProduction: env.NODE_ENV === "production",
      port: env.PORT,
      databaseUrl: env.DATABASE_URL,
      sessionSecret: env.SESSION_SECRET,
      cookieDomain: env.COOKIE_DOMAIN,
      corsOrigins: env.CORS_ORIGINS,
      logLevel: env.LOG_LEVEL,
      webhookSecret: env.WEBHOOK_SECRET,
      aiProvider: env.AI_PROVIDER,
      geminiApiKey: env.GEMINI_API_KEY,
      objectStorageProvider: env.OBJECT_STORAGE_PROVIDER,
      objectStorageBucket: env.OBJECT_STORAGE_BUCKET,
      sessionTtlHours: env.SESSION_TTL_HOURS,
      accountLockoutThreshold: env.ACCOUNT_LOCKOUT_THRESHOLD,
      accountLockoutDurationMinutes: env.ACCOUNT_LOCKOUT_DURATION_MINUTES,
      passwordResetTokenTtlMinutes: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      passwordMinLength: env.PASSWORD_MIN_LENGTH,
    }),
  };
}

function loadConfig(): AppConfig {
  const result = validateEnv(process.env);

  if (!result.success) {
    console.error("FATAL: invalid environment configuration. Refusing to start.\n");
    for (const message of result.errors) {
      console.error(`  - ${message}`);
    }
    // Never print process.env here — it may contain partially-set secrets.
    process.exit(1);
  }

  return result.config;
}

export const config: AppConfig = loadConfig();
