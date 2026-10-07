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

    // Phase 9 — media/object storage provider abstraction
    // (docs/STORAGE_PROVIDER_ARCHITECTURE.md). "none" selects the
    // local-filesystem provider — development/test only, rejected below in
    // production/staging. "s3"/"r2" share one S3-compatible provider
    // implementation; "supabase" uses Supabase Storage (the project's
    // established production target — docs/SUPABASE_DATABASE_SETUP.md).
    OBJECT_STORAGE_PROVIDER: z.enum(["none", "s3", "r2", "supabase"]).default("none"),
    OBJECT_STORAGE_BUCKET: z.string().optional().default(""),
    OBJECT_STORAGE_REGION: z.string().optional().default(""),
    OBJECT_STORAGE_ENDPOINT: z.string().optional().default(""),
    OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional().default(""),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional().default(""),
    OBJECT_STORAGE_FORCE_PATH_STYLE: z
      .string()
      .optional()
      .default("false")
      .transform((v) => v === "true"),
    SUPABASE_STORAGE_URL: z.string().optional().default(""),
    SUPABASE_STORAGE_SERVICE_ROLE_KEY: z.string().optional().default(""),
    LOCAL_STORAGE_DIR: z.string().optional().default(".local-storage"),
    // s3/r2 only — the bucket's public base URL (a CDN domain, or
    // `https://<bucket>.s3.<region>.amazonaws.com`/an R2 public bucket
    // domain), used to compute a stable, non-expiring URL for PUBLIC
    // media instead of a signed one. Supabase Storage never needs this —
    // its client SDK computes a public URL from SUPABASE_STORAGE_URL
    // directly. Left unset, s3/r2 public media falls back to a signed URL
    // with MEDIA_PUBLIC_SIGNED_URL_TTL_SECONDS instead of failing.
    OBJECT_STORAGE_PUBLIC_BASE_URL: z.string().optional().default(""),

    MEDIA_MAX_IMAGE_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
    MEDIA_MAX_DOCUMENT_SIZE_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
    MEDIA_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    // Only for PUBLIC-visibility media served to anonymous website visitors
    // (og:image, sitemap image entries, public post/page featured images)
    // when no stable getPublicUrl() can be computed — a real fix would be
    // configuring OBJECT_STORAGE_PUBLIC_BASE_URL/a public Supabase bucket
    // so these URLs never expire at all; this is the fallback, not the
    // goal. Default 24h, comfortably longer than any cache/CDN TTL that
    // would otherwise re-request it, without being a permanent link.
    MEDIA_PUBLIC_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(24 * 60 * 60),
    MEDIA_UPLOAD_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(15),

    // Phase 3 — centralized security tunables (docs/AUTHENTICATION_ARCHITECTURE.md).
    // Never hard-code these values inline in service code; every consumer
    // reads them from `config` here.
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
    ACCOUNT_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
    ACCOUNT_LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(15),
    PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),

    // Account email (verification + password reset). With EMAIL_PROVIDER=none the
    // platform runs in "degraded" mode: no verification gate and no reset email.
    EMAIL_PROVIDER: z.enum(["none", "resend"]).default("none"),
    RESEND_API_KEY: z.string().optional().default(""),
    EMAIL_FROM: z.string().optional().default(""),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive().default(48),
    // Legacy POST /auth/register creates an ORGANIZATION ADMIN. It stays on in dev/test (many flows seed through it) but is OFF by default in production; public sign-up uses /auth/portal/register.
    ALLOW_ADMIN_SELF_REGISTRATION: z.enum(["true", "false"]).optional(),
    // Cloudflare Turnstile bot protection for public auth forms. Optional; unset = honeypot only.
    TURNSTILE_SECRET_KEY: z.string().optional().default(""),

    // Phase 6 — client-admin workspace invitations (docs/WORKSPACE_PROVISIONING.md).
    INVITATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72),

    // Rate limiting (docs/SECURITY_MODEL.md "Authentication"). The default
    // express-rate-limit MemoryStore is per-process — on a serverless
    // deployment (Vercel) each invocation can land on a different,
    // short-lived instance with its own empty counters, so limits are not
    // actually enforced across requests in production. Set this to enable
    // a shared Redis-backed store instead; left unset, rate limiting
    // degrades to per-instance (effectively unenforced on serverless)
    // rather than failing to boot.
    REDIS_URL: z.string().optional().default(""),

    // Phase 13 — Automation scheduler/queue cron trigger
    // (docs/AUTOMATION_ARCHITECTURE.md). Serverless deployments (Vercel)
    // tear down the process between requests, so the in-process
    // setInterval-based scheduler/queue workers never reliably fire —
    // POST /api/v1/automation/internal/tick exists for a Vercel Cron job to
    // call instead. Left unset, that endpoint is disabled outright (503)
    // rather than accepting an unauthenticated trigger.
    CRON_SECRET: z.string().optional().default(""),

    // Phase 11 — public website integration (docs/PUBLIC_API_ARCHITECTURE.md).
    // The public website (artifysolscom) has no tenant/session context of
    // its own — every public CMS page/post/lead belongs to exactly one
    // agency organization, resolved here rather than guessed from a
    // caller-supplied value. Left unset, the public CMS/lead endpoints
    // report "not configured" (empty content, lead intake disabled) rather
    // than fabricating or guessing an organization.
    PUBLIC_WEBSITE_ORGANIZATION_ID: z.string().optional().default(""),

    // Phase 14 — Marketing Campaigns (docs/MARKETING_ARCHITECTURE.md). The
    // public website's own base URL (e.g. "https://artifysolscom.com"),
    // needed only to compose an absolute, previewable campaign landing-
    // page URL with its UTM parameters appended. Left unset, campaign
    // preview reports the landing page's real slug/status but no
    // absolute URL, rather than guessing a domain.
    PUBLIC_SITE_BASE_URL: z.string().optional().default(""),

    // Phase 17 — dedicated key for encrypting integration credentials and
    // webhook signing secrets at rest (server/utils/secretBox.ts). Optional:
    // when unset, a key is derived (HKDF) from SESSION_SECRET instead, which
    // works but ties stored secrets to that value — set this to rotate the
    // two independently. Min 32 chars when set.
    INTEGRATIONS_ENCRYPTION_KEY: z.string().optional().default(""),

    // Step 4 — Social Media foundation. Token vault key ring: "1:<secret>,2:<secret>" (each secret >= 32 chars);
    // new credentials use SOCIAL_VAULT_ACTIVE_KEY_VERSION. Unset = a key derived from INTEGRATIONS_ENCRYPTION_KEY /
    // SESSION_SECRET (version 1), which works but ties stored tokens to that value.
    SOCIAL_VAULT_KEYS: z.string().optional().default(""),
    SOCIAL_VAULT_ACTIVE_KEY_VERSION: z.coerce.number().int().positive().optional(),
    // The mock connector exists for dev/tests; it is disabled in production unless this flag is "true".
    SOCIAL_MOCK_PROVIDER_ENABLED: z.enum(["true", "false"]).optional(),
    // Public origin of the Control Center, used to build OAuth redirect URIs.
    CONTROL_CENTER_BASE_URL: z.string().optional().default(""),
    // Network app credentials (names only; connectors stay "not configured" until set AND implemented).
    META_APP_ID: z.string().optional().default(""),
    META_APP_SECRET: z.string().optional().default(""),
    LINKEDIN_CLIENT_ID: z.string().optional().default(""),
    LINKEDIN_CLIENT_SECRET: z.string().optional().default(""),
    // Meta (Facebook Pages). The webhook verify token is a shared secret between us and the Meta app dashboard.
    META_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),
    META_API_VERSION: z.string().regex(/^v\d{1,2}\.\d$/, "META_API_VERSION must look like v25.0").optional().default("v25.0"),
    // Informational only (shown on the setup panel): the Graph API does not tell us whether the app is in Development or Live mode.
    // Optional override of the permissions requested at login (comma separated). Default = the set this app is known to have.
    META_LOGIN_SCOPES: z.string().regex(/^([a-z_]+)(,[a-z_]+)*$/, "META_LOGIN_SCOPES must be comma-separated permission names").optional().or(z.literal("")).default(""),
    META_APP_MODE: z.enum(["development", "live", "unknown"]).optional().default("unknown"),
    META_INBOX_POLLING: z.enum(["true", "false"]).optional().default("false"),
    LINKEDIN_API_VERSION: z.string().regex(/^\d{6}$/, "LINKEDIN_API_VERSION must look like YYYYMM").optional().default("202504"),
    // Hard environment kill switch: "true" stops ALL social publishing regardless of database settings.
    SOCIAL_PUBLISHING_DISABLED: z.enum(["true", "false"]).optional().default("false"),
    SOCIAL_PUBLISH_BATCH_SIZE: z.coerce.number().int().min(1).max(100).optional().default(20),
    SOCIAL_PUBLISH_CONCURRENCY: z.coerce.number().int().min(1).max(10).optional().default(3),
    SOCIAL_PUBLISH_PER_ACCOUNT_LIMIT: z.coerce.number().int().min(1).max(10).optional().default(2),
    SOCIAL_REPLY_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(200).optional().default(20),
    SOCIAL_PUBLISH_TIME_BUDGET_MS: z.coerce.number().int().min(1000).max(50000).optional().default(8000),
  })
  .superRefine((val, ctx) => {
    const isProdLike = val.NODE_ENV === "production" || val.NODE_ENV === "staging";

    if (val.INTEGRATIONS_ENCRYPTION_KEY && val.INTEGRATIONS_ENCRYPTION_KEY.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["INTEGRATIONS_ENCRYPTION_KEY"],
        message: "INTEGRATIONS_ENCRYPTION_KEY must be at least 32 characters when set",
      });
    }

    if (val.CRON_SECRET && val.CRON_SECRET.length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CRON_SECRET"],
        message: "CRON_SECRET must be at least 16 characters when set",
      });
    }

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
      if (!val.REDIS_URL) {
        // Not fatal: rate limits still apply per-instance, which is a real
        // (weaker) protection on a traditional long-running deployment and
        // a much weaker one on serverless — see the REDIS_URL doc comment.
        // eslint-disable-next-line no-console
        console.warn(
          "[config] REDIS_URL is empty — rate limiting uses a per-process in-memory store, which is not shared across serverless instances. Set REDIS_URL to enforce limits correctly in production."
        );
      }
      if (!val.CRON_SECRET) {
        // Not fatal: the automation scheduler/queue simply stays
        // catch-up-only via its (unreliable on serverless) in-process
        // timers until this is set and a Vercel Cron job is wired to
        // /api/v1/automation/internal/tick.
        // eslint-disable-next-line no-console
        console.warn(
          "[config] CRON_SECRET is empty — POST /api/v1/automation/internal/tick is disabled, so scheduled/queued automation workflows will only run via the unreliable in-process timers until it is set."
        );
      }
      if (!val.PUBLIC_WEBSITE_ORGANIZATION_ID) {
        // Not fatal: the public website degrades to empty CMS/product
        // listings and disabled lead intake rather than fail boot or guess
        // a tenant.
        // eslint-disable-next-line no-console
        console.warn(
          "[config] PUBLIC_WEBSITE_ORGANIZATION_ID is empty — public CMS/product content will report empty and public lead intake will be disabled until it is set."
        );
      }

      // The local-filesystem provider ("none") is a development/test
      // convenience only — it must never silently become the production
      // storage backend (Phase 9 §31/§46).
      if (val.OBJECT_STORAGE_PROVIDER === "none") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["OBJECT_STORAGE_PROVIDER"],
          message:
            "OBJECT_STORAGE_PROVIDER must be explicitly configured to a real provider (s3, r2, or supabase) in production/staging — 'none' (local filesystem) is development/test-only.",
        });
      }
    }

    if (val.EMAIL_PROVIDER === "resend") {
      if (!val.RESEND_API_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["RESEND_API_KEY"], message: "required when EMAIL_PROVIDER=resend" });
      if (!val.EMAIL_FROM) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["EMAIL_FROM"], message: "required when EMAIL_PROVIDER=resend (e.g. 'Artify <no-reply@artifysols.com>')" });
    }

    if (val.OBJECT_STORAGE_PROVIDER === "s3" || val.OBJECT_STORAGE_PROVIDER === "r2") {
      if (!val.OBJECT_STORAGE_BUCKET) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_BUCKET"], message: "required for the s3/r2 storage provider" });
      if (!val.OBJECT_STORAGE_ACCESS_KEY_ID) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_ACCESS_KEY_ID"], message: "required for the s3/r2 storage provider" });
      if (!val.OBJECT_STORAGE_SECRET_ACCESS_KEY) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_SECRET_ACCESS_KEY"], message: "required for the s3/r2 storage provider" });
      if (!val.OBJECT_STORAGE_REGION) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_REGION"], message: "required for the s3/r2 storage provider" });
      if (val.OBJECT_STORAGE_PROVIDER === "r2" && !val.OBJECT_STORAGE_ENDPOINT) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_ENDPOINT"], message: "required for the r2 storage provider (the account's R2 S3 API endpoint)" });
      }
    }

    if (val.OBJECT_STORAGE_PROVIDER === "supabase") {
      if (!val.OBJECT_STORAGE_BUCKET) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["OBJECT_STORAGE_BUCKET"], message: "required for the supabase storage provider (the Storage bucket name)" });
      if (!val.SUPABASE_STORAGE_URL) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SUPABASE_STORAGE_URL"], message: "required for the supabase storage provider" });
      if (!val.SUPABASE_STORAGE_SERVICE_ROLE_KEY) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SUPABASE_STORAGE_SERVICE_ROLE_KEY"], message: "required for the supabase storage provider — server-side only, never sent to the browser" });
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
  objectStorageRegion: string;
  objectStorageEndpoint: string;
  objectStorageAccessKeyId: string;
  objectStorageSecretAccessKey: string;
  objectStorageForcePathStyle: boolean;
  supabaseStorageUrl: string;
  supabaseStorageServiceRoleKey: string;
  localStorageDir: string;
  objectStoragePublicBaseUrl: string;
  mediaMaxImageSizeBytes: number;
  mediaMaxDocumentSizeBytes: number;
  mediaSignedUrlTtlSeconds: number;
  mediaPublicSignedUrlTtlSeconds: number;
  mediaUploadSessionTtlMinutes: number;
  sessionTtlHours: number;
  accountLockoutThreshold: number;
  accountLockoutDurationMinutes: number;
  passwordResetTokenTtlMinutes: number;
  passwordMinLength: number;
  invitationTokenTtlHours: number;
  emailProvider: "none" | "resend";
  resendApiKey: string;
  emailFrom: string;
  emailVerificationTtlHours: number;
  turnstileSecretKey: string;
  allowAdminSelfRegistration: boolean;
  publicWebsiteOrganizationId: string;
  publicSiteBaseUrl: string;
  cronSecret: string;
  redisUrl: string;
  integrationsEncryptionKey: string;
  socialVaultKeys: string;
  socialVaultActiveKeyVersion: number | undefined;
  socialMockProviderEnabled: boolean;
  controlCenterBaseUrl: string;
  metaAppId: string;
  metaAppSecret: string;
  metaWebhookVerifyToken: string;
  metaApiVersion: string;
  metaLoginScopes: string;
  metaAppMode: "development" | "live" | "unknown";
  metaInboxPolling: boolean;
  linkedinClientId: string;
  linkedinClientSecret: string;
  linkedinApiVersion: string;
  socialPublishingDisabled: boolean;
  socialPublishBatchSize: number;
  socialPublishConcurrency: number;
  socialPublishPerAccountLimit: number;
  socialPublishTimeBudgetMs: number;
  socialReplyRatePerMinute: number;
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
      objectStorageRegion: env.OBJECT_STORAGE_REGION,
      objectStorageEndpoint: env.OBJECT_STORAGE_ENDPOINT,
      objectStorageAccessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID,
      objectStorageSecretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      objectStorageForcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE,
      supabaseStorageUrl: env.SUPABASE_STORAGE_URL,
      supabaseStorageServiceRoleKey: env.SUPABASE_STORAGE_SERVICE_ROLE_KEY,
      localStorageDir: env.LOCAL_STORAGE_DIR,
      objectStoragePublicBaseUrl: env.OBJECT_STORAGE_PUBLIC_BASE_URL,
      mediaMaxImageSizeBytes: env.MEDIA_MAX_IMAGE_SIZE_BYTES,
      mediaMaxDocumentSizeBytes: env.MEDIA_MAX_DOCUMENT_SIZE_BYTES,
      mediaSignedUrlTtlSeconds: env.MEDIA_SIGNED_URL_TTL_SECONDS,
      mediaPublicSignedUrlTtlSeconds: env.MEDIA_PUBLIC_SIGNED_URL_TTL_SECONDS,
      mediaUploadSessionTtlMinutes: env.MEDIA_UPLOAD_SESSION_TTL_MINUTES,
      sessionTtlHours: env.SESSION_TTL_HOURS,
      accountLockoutThreshold: env.ACCOUNT_LOCKOUT_THRESHOLD,
      accountLockoutDurationMinutes: env.ACCOUNT_LOCKOUT_DURATION_MINUTES,
      passwordResetTokenTtlMinutes: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      passwordMinLength: env.PASSWORD_MIN_LENGTH,
      invitationTokenTtlHours: env.INVITATION_TOKEN_TTL_HOURS,
      emailProvider: env.EMAIL_PROVIDER,
      resendApiKey: env.RESEND_API_KEY,
      emailFrom: env.EMAIL_FROM,
      emailVerificationTtlHours: env.EMAIL_VERIFICATION_TTL_HOURS,
      turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
      allowAdminSelfRegistration: env.ALLOW_ADMIN_SELF_REGISTRATION ? env.ALLOW_ADMIN_SELF_REGISTRATION === "true" : env.NODE_ENV !== "production",
      publicWebsiteOrganizationId: env.PUBLIC_WEBSITE_ORGANIZATION_ID,
      publicSiteBaseUrl: env.PUBLIC_SITE_BASE_URL,
      cronSecret: env.CRON_SECRET,
      redisUrl: env.REDIS_URL,
      integrationsEncryptionKey: env.INTEGRATIONS_ENCRYPTION_KEY,
      socialVaultKeys: env.SOCIAL_VAULT_KEYS,
      socialVaultActiveKeyVersion: env.SOCIAL_VAULT_ACTIVE_KEY_VERSION,
      socialMockProviderEnabled: env.SOCIAL_MOCK_PROVIDER_ENABLED ? env.SOCIAL_MOCK_PROVIDER_ENABLED === "true" : env.NODE_ENV !== "production",
      controlCenterBaseUrl: (env.CONTROL_CENTER_BASE_URL || (env.NODE_ENV === "production" ? "https://cc.artifysols.com" : "http://localhost:3000")).replace(/\/+$/, ""),
      metaAppId: env.META_APP_ID,
      metaAppSecret: env.META_APP_SECRET,
      metaWebhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
      metaApiVersion: env.META_API_VERSION,
      metaLoginScopes: env.META_LOGIN_SCOPES ?? "",
      metaAppMode: env.META_APP_MODE,
      metaInboxPolling: env.META_INBOX_POLLING === "true",
      linkedinClientId: env.LINKEDIN_CLIENT_ID,
      linkedinClientSecret: env.LINKEDIN_CLIENT_SECRET,
      linkedinApiVersion: env.LINKEDIN_API_VERSION,
      socialPublishingDisabled: env.SOCIAL_PUBLISHING_DISABLED === "true",
      socialPublishBatchSize: env.SOCIAL_PUBLISH_BATCH_SIZE,
      socialPublishConcurrency: env.SOCIAL_PUBLISH_CONCURRENCY,
      socialPublishPerAccountLimit: env.SOCIAL_PUBLISH_PER_ACCOUNT_LIMIT,
      socialPublishTimeBudgetMs: env.SOCIAL_PUBLISH_TIME_BUDGET_MS,
      socialReplyRatePerMinute: env.SOCIAL_REPLY_RATE_PER_MINUTE,
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
