// server/app/app.ts
import express4 from "express";

// server/middleware/requestId.ts
import { randomUUID } from "node:crypto";
var REQUEST_ID_HEADER = "x-request-id";
var MAX_INCOMING_ID_LENGTH = 128;
function isSafeIncomingId(value) {
  return value.length > 0 && value.length <= MAX_INCOMING_ID_LENGTH && /^[A-Za-z0-9_.-]+$/.test(value);
}
function requestIdMiddleware(req, res, next) {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const incomingValue = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = incomingValue && isSafeIncomingId(incomingValue) ? incomingValue : randomUUID();
  req.requestId = requestId;
  req.headers[REQUEST_ID_HEADER] = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

// server/middleware/security.ts
import cors from "cors";
import helmet from "helmet";
import express from "express";

// server/config/env.ts
import dotenv from "dotenv";
import { z } from "zod";
dotenv.config();
var KNOWN_COMPROMISED_WEBHOOK_SECRET = "artify_whsec_prod_2026_soc2";
var envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3e3),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
    message: "DATABASE_URL must be a postgresql:// connection string"
  }),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  COOKIE_DOMAIN: z.string().optional(),
  CORS_ORIGINS: z.string().min(1, "CORS_ORIGINS is required (comma-separated list of allowed origins)").transform(
    (v) => v.split(",").map((origin) => origin.trim()).filter(Boolean)
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
  OBJECT_STORAGE_FORCE_PATH_STYLE: z.string().optional().default("false").transform((v) => v === "true"),
  SUPABASE_STORAGE_URL: z.string().optional().default(""),
  SUPABASE_STORAGE_SERVICE_ROLE_KEY: z.string().optional().default(""),
  LOCAL_STORAGE_DIR: z.string().optional().default(".local-storage"),
  MEDIA_MAX_IMAGE_SIZE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  MEDIA_MAX_DOCUMENT_SIZE_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  MEDIA_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  MEDIA_UPLOAD_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  // Phase 3 — centralized security tunables (docs/AUTHENTICATION_ARCHITECTURE.md).
  // Never hard-code these values inline in service code; every consumer
  // reads them from `config` here.
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  ACCOUNT_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  ACCOUNT_LOCKOUT_DURATION_MINUTES: z.coerce.number().int().positive().default(15),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),
  // Phase 6 — client-admin workspace invitations (docs/WORKSPACE_PROVISIONING.md).
  INVITATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72),
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
  PUBLIC_WEBSITE_ORGANIZATION_ID: z.string().optional().default("")
}).superRefine((val, ctx) => {
  const isProdLike = val.NODE_ENV === "production" || val.NODE_ENV === "staging";
  if (val.CRON_SECRET && val.CRON_SECRET.length < 16) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CRON_SECRET"],
      message: "CRON_SECRET must be at least 16 characters when set"
    });
  }
  if (val.WEBHOOK_SECRET === KNOWN_COMPROMISED_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["WEBHOOK_SECRET"],
      message: "WEBHOOK_SECRET matches the value compromised in the Phase 0 audit (it was hardcoded in source and shipped to the browser). Generate a new secret and rotate it with the webhook provider \u2014 never reuse this value."
    });
  }
  if (isProdLike) {
    if (val.SESSION_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SESSION_SECRET"],
        message: "SESSION_SECRET must be at least 32 characters in production/staging"
      });
    }
    if (val.CORS_ORIGINS.includes("*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ORIGINS"],
        message: "CORS_ORIGINS must not contain '*' in production/staging \u2014 list explicit origins"
      });
    }
    if (val.AI_PROVIDER === "gemini" && !val.GEMINI_API_KEY) {
      console.warn(
        "[config] AI_PROVIDER=gemini but GEMINI_API_KEY is empty \u2014 AI endpoints will report unavailable until it is set."
      );
    }
    if (!val.CRON_SECRET) {
      console.warn(
        "[config] CRON_SECRET is empty \u2014 POST /api/v1/automation/internal/tick is disabled, so scheduled/queued automation workflows will only run via the unreliable in-process timers until it is set."
      );
    }
    if (!val.PUBLIC_WEBSITE_ORGANIZATION_ID) {
      console.warn(
        "[config] PUBLIC_WEBSITE_ORGANIZATION_ID is empty \u2014 public CMS/product content will report empty and public lead intake will be disabled until it is set."
      );
    }
    if (val.OBJECT_STORAGE_PROVIDER === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OBJECT_STORAGE_PROVIDER"],
        message: "OBJECT_STORAGE_PROVIDER must be explicitly configured to a real provider (s3, r2, or supabase) in production/staging \u2014 'none' (local filesystem) is development/test-only."
      });
    }
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
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SUPABASE_STORAGE_SERVICE_ROLE_KEY"], message: "required for the supabase storage provider \u2014 server-side only, never sent to the browser" });
    }
  }
});
function validateEnv(raw) {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
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
      mediaMaxImageSizeBytes: env.MEDIA_MAX_IMAGE_SIZE_BYTES,
      mediaMaxDocumentSizeBytes: env.MEDIA_MAX_DOCUMENT_SIZE_BYTES,
      mediaSignedUrlTtlSeconds: env.MEDIA_SIGNED_URL_TTL_SECONDS,
      mediaUploadSessionTtlMinutes: env.MEDIA_UPLOAD_SESSION_TTL_MINUTES,
      sessionTtlHours: env.SESSION_TTL_HOURS,
      accountLockoutThreshold: env.ACCOUNT_LOCKOUT_THRESHOLD,
      accountLockoutDurationMinutes: env.ACCOUNT_LOCKOUT_DURATION_MINUTES,
      passwordResetTokenTtlMinutes: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      passwordMinLength: env.PASSWORD_MIN_LENGTH,
      invitationTokenTtlHours: env.INVITATION_TOKEN_TTL_HOURS,
      publicWebsiteOrganizationId: env.PUBLIC_WEBSITE_ORGANIZATION_ID,
      cronSecret: env.CRON_SECRET
    })
  };
}
function loadConfig() {
  const result = validateEnv(process.env);
  if (!result.success) {
    console.error("FATAL: invalid environment configuration. Refusing to start.\n");
    for (const message of result.errors) {
      console.error(`  - ${message}`);
    }
    process.exit(1);
  }
  return result.config;
}
var config = loadConfig();

// server/core/logger.ts
import pino from "pino";
var REDACT_PATHS = [
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.token",
  "*.sessionToken",
  "*.session_token",
  "*.apiKey",
  "*.api_key",
  "*.secret",
  "*.webhookSecret",
  "*.gemini_api_key",
  "*.geminiApiKey",
  "*.cardNumber",
  "*.cvv"
];
var logger = pino({
  level: config.logLevel,
  base: {
    service: "artify-platform-api",
    environment: config.nodeEnv
  },
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]"
  },
  timestamp: pino.stdTimeFunctions.isoTime
});

// server/middleware/security.ts
var MAX_JSON_BODY_SIZE = "1mb";
var corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (config.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    logger.warn({ event: "cors_rejected", origin }, "Rejected request from disallowed CORS origin");
    callback(new Error("Not allowed by CORS policy"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Artify-Webhook-Signature"],
  exposedHeaders: ["X-Request-Id"],
  maxAge: 600
};
function applySecurityMiddleware(app2) {
  app2.set("trust proxy", 1);
  app2.use(
    helmet({
      contentSecurityPolicy: config.isProduction ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"]
        }
      } : false,
      // relaxed in dev so Vite HMR / inline dev tooling isn't blocked
      crossOriginEmbedderPolicy: false
    })
  );
  app2.use(cors(corsOptions));
  app2.use(
    express.json({
      limit: MAX_JSON_BODY_SIZE,
      verify: (req, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      }
    })
  );
  app2.use(express.urlencoded({ extended: false, limit: MAX_JSON_BODY_SIZE, parameterLimit: 100 }));
}

// server/middleware/requestLogger.ts
import pinoHttp from "pino-http";
var requestLogger = pinoHttp({
  logger,
  genReqId: (req) => req.requestId,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customProps: (req) => ({
    actorId: req.user?.id,
    organizationId: req.organizationId
  }),
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode })
  }
});

// server/middleware/rateLimiter.ts
import rateLimit from "express-rate-limit";

// server/core/apiResponse.ts
function getRequestId(req) {
  const existing = req.headers["x-request-id"];
  return typeof existing === "string" && existing.length > 0 ? existing : "unknown-request-id";
}
function sendSuccess(res, data, statusCode = 200, pagination) {
  const requestId = getRequestId(res.req);
  const body = {
    success: true,
    data,
    meta: {
      requestId,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      pagination: pagination ? {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: Math.max(1, Math.ceil(pagination.total / pagination.limit))
      } : void 0
    }
  };
  res.status(statusCode).json(body);
}
function sendError(res, statusCode, code, message, details) {
  const requestId = getRequestId(res.req);
  const body = {
    success: false,
    error: { code, message, details, requestId },
    meta: { requestId, timestamp: (/* @__PURE__ */ new Date()).toISOString() }
  };
  res.status(statusCode).json(body);
}

// server/middleware/rateLimiter.ts
function rateLimitHandler(req, res) {
  sendError(res, 429, "RATE_LIMIT_EXCEEDED" /* RATE_LIMIT_EXCEEDED */, "Too many requests. Please try again later.");
}
var generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler
});
var authLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  // Key by IP + attempted email so one IP can't lock out unrelated accounts,
  // while still throttling both credential stuffing and single-account brute force.
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "unknown";
    return `${req.ip ?? "unknown-ip"}:${email}`;
  }
});
var webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1e3,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler
});
var passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1e3,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "unknown";
    return `${req.ip ?? "unknown-ip"}:${email}`;
  }
});
var publicLeadLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => req.ip ?? "unknown-ip"
});
var sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1e3,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? "unknown"
});
var aiExecutionLimiter = rateLimit({
  windowMs: 5 * 60 * 1e3,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? "unknown"
});

// server/middleware/errorHandler.ts
import { ZodError } from "zod";

// server/core/errors.ts
var AppError = class extends Error {
  constructor(message, details) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
};
var ValidationError = class extends AppError {
  constructor(message = "Request validation failed", details) {
    super(message, details);
    this.statusCode = 400;
    this.code = "VALIDATION_ERROR" /* VALIDATION_ERROR */;
  }
};
var AuthenticationError = class extends AppError {
  constructor(message = "Authentication required") {
    super(message);
    this.statusCode = 401;
    this.code = "UNAUTHORIZED" /* UNAUTHORIZED */;
  }
};
var AuthorizationError = class extends AppError {
  constructor(message = "Permission denied") {
    super(message);
    this.statusCode = 403;
    this.code = "FORBIDDEN" /* FORBIDDEN */;
  }
};
var NotFoundError = class extends AppError {
  constructor(message = "Resource not found") {
    super(message);
    this.statusCode = 404;
    this.code = "RESOURCE_NOT_FOUND" /* RESOURCE_NOT_FOUND */;
  }
};
var ConflictError = class extends AppError {
  constructor(message = "Resource conflict", details) {
    super(message, details);
    this.statusCode = 409;
    this.code = "RESOURCE_CONFLICT" /* RESOURCE_CONFLICT */;
  }
};
var InfrastructureError = class extends AppError {
  constructor(message = "A required infrastructure dependency is unavailable") {
    super(message);
    this.statusCode = 503;
    this.code = "SERVICE_UNAVAILABLE" /* SERVICE_UNAVAILABLE */;
  }
};
var InternalError = class extends AppError {
  constructor(message = "An unexpected error occurred") {
    super(message);
    this.statusCode = 500;
    this.code = "INTERNAL_ERROR" /* INTERNAL_ERROR */;
  }
};
function isAppError(err) {
  return err instanceof AppError;
}

// server/middleware/errorHandler.ts
function notFoundHandler(req, res) {
  sendError(res, 404, "RESOURCE_NOT_FOUND" /* RESOURCE_NOT_FOUND */, `No route matches ${req.method} ${req.path}`);
}
function errorHandlerMiddleware(err, req, res, _next) {
  const requestId = req.requestId ?? "unknown-request-id";
  const log = logger.child({ requestId, route: req.path, method: req.method });
  let appError;
  if (isAppError(err)) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = new ValidationError("Request validation failed", err.flatten());
  } else {
    appError = new InternalError("An unexpected error occurred");
    log.error({ err, event: "unhandled_error" }, "Unhandled error reached the error middleware");
  }
  if (appError.statusCode >= 500) {
    log.error({ err, event: "app_error" }, appError.message);
  } else {
    log.warn({ event: "app_error", code: appError.code }, appError.message);
  }
  const exposeDetails = appError.statusCode < 500;
  sendError(
    res,
    appError.statusCode,
    appError.code,
    appError.statusCode >= 500 ? "An unexpected error occurred" : appError.message,
    exposeDetails ? appError.details : void 0
  );
}

// server/routes/v1/index.ts
import { Router as Router40 } from "express";

// server/routes/v1/authRoutes.ts
import { Router } from "express";

// server/db/prisma.ts
import { PrismaClient } from "@prisma/client";
var prisma = new PrismaClient({
  datasourceUrl: config.databaseUrl,
  log: config.nodeEnv === "development" ? ["warn", "error"] : ["error"]
});

// server/repositories/userRepository.ts
var userRepository = {
  async findByEmail(email) {
    return prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  },
  async listForIds(ids) {
    if (ids.length === 0) return [];
    return prisma.user.findMany({ where: { id: { in: ids } } });
  },
  async findById(id) {
    return prisma.user.findUnique({ where: { id } });
  },
  async create(data) {
    return prisma.user.create({
      data: {
        organizationId: data.organizationId,
        email: data.email.trim().toLowerCase(),
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        displayName: `${data.firstName} ${data.lastName}`.trim(),
        title: data.title,
        roleId: data.roleId
      }
    });
  },
  async recordSuccessfulLogin(userId) {
    await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: /* @__PURE__ */ new Date(), failedLoginAttempts: 0, lockedUntil: null }
    });
  },
  /** Returns true if the account is now locked as a result of this failure. Threshold/duration are centralized config (server/config/env.ts), not hard-coded here. */
  async recordFailedLogin(userId) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } }
    });
    if (user.failedLoginAttempts >= config.accountLockoutThreshold) {
      await prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + config.accountLockoutDurationMinutes * 60 * 1e3) }
      });
      return true;
    }
    return false;
  },
  isLocked(user) {
    return !!user.lockedUntil && user.lockedUntil.getTime() > Date.now();
  },
  async updatePasswordHash(userId, passwordHash) {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  },
  async updateProfile(userId, data) {
    const patch = { ...data };
    const updated = await prisma.user.update({ where: { id: userId }, data: patch });
    if (data.firstName !== void 0 || data.lastName !== void 0) {
      await prisma.user.update({
        where: { id: userId },
        data: { displayName: `${updated.firstName} ${updated.lastName}`.trim() }
      });
    }
    return prisma.user.findUniqueOrThrow({ where: { id: userId } });
  },
  async updateStatus(userId, status) {
    return prisma.user.update({ where: { id: userId }, data: { status } });
  }
};

// server/utils/crypto.ts
import { randomBytes, createHash, createHmac, timingSafeEqual } from "node:crypto";
function generateSessionToken() {
  return `art_sess_${randomBytes(32).toString("hex")}`;
}
function generateResetToken() {
  return `art_reset_${randomBytes(32).toString("hex")}`;
}
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
function generateInvitationToken() {
  return `art_invite_${randomBytes(32).toString("hex")}`;
}
function generateUploadToken() {
  return `art_upload_${randomBytes(32).toString("hex")}`;
}
function signHmac(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
function verifyHmacSignature(secret, payload, providedSignatureHex) {
  if (!providedSignatureHex || typeof providedSignatureHex !== "string") return false;
  const expected = signHmac(secret, payload);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(providedSignatureHex, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

// server/repositories/sessionRepository.ts
var sessionRepository = {
  async create(data) {
    return prisma.session.create({
      data: {
        tokenHash: hashToken(data.token),
        userId: data.userId,
        organizationId: data.organizationId,
        expiresAt: data.expiresAt,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent
      }
    });
  },
  async findValidByToken(token) {
    const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  },
  async touchLastUsed(id) {
    await prisma.session.update({ where: { id }, data: { lastUsedAt: /* @__PURE__ */ new Date() } }).catch(() => {
    });
  },
  async revoke(token) {
    await prisma.session.update({ where: { tokenHash: hashToken(token) }, data: { revokedAt: /* @__PURE__ */ new Date() } }).catch(() => {
    });
  },
  async revokeAllForUser(userId) {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: /* @__PURE__ */ new Date() }
    });
  },
  /** Revokes every other active session for the user, keeping the one matching `exceptToken` — used by change-password to avoid logging the caller out of the session they just authenticated the change with. */
  async revokeAllForUserExcept(userId, exceptToken) {
    await prisma.session.updateMany({
      where: { userId, revokedAt: null, tokenHash: { not: hashToken(exceptToken) } },
      data: { revokedAt: /* @__PURE__ */ new Date() }
    });
  },
  /** Self-service session list (Phase 4 Security/Sessions UI) — active (unexpired, unrevoked) sessions for one user, safe fields only (never tokenHash). */
  async listActiveForUser(userId) {
    return prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: /* @__PURE__ */ new Date() } },
      orderBy: { createdAt: "desc" }
    });
  },
  /** Revokes a session only if it belongs to `userId` — returns true if a row was actually revoked, so the route can 404 rather than leak whether a foreign session id exists. */
  async revokeByIdForUser(id, userId) {
    const result = await prisma.session.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: /* @__PURE__ */ new Date() }
    });
    return result.count > 0;
  },
  async countActiveForOrganization(organizationId) {
    return prisma.session.count({ where: { organizationId, revokedAt: null, expiresAt: { gt: /* @__PURE__ */ new Date() } } });
  }
};

// server/repositories/auditLogRepository.ts
var auditLogRepository = {
  /** Append-only by convention — no update/delete method exists on this repository (tests/security/audit.test.ts asserts this). */
  async record(entry) {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        actorName: entry.actorName,
        actorType: entry.actorType,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        requestId: entry.requestId,
        result: entry.result ?? "SUCCESS",
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        beforeData: entry.beforeData,
        afterData: entry.afterData,
        metadata: entry.metadata
      }
    });
  }
};

// server/repositories/roleRepository.ts
var roleRepository = {
  async findByKey(key) {
    return prisma.role.findUnique({ where: { key } });
  },
  async findById(id) {
    return prisma.role.findUnique({ where: { id } });
  },
  /** All roles with their resolved permission sets — GET /api/v1/roles. */
  async listAllResolved() {
    const roles = await prisma.role.findMany({
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: { name: "asc" }
    });
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.rolePermissions.map((rp) => rp.permission.key)
    }));
  },
  /** Resolves a role plus its full permission-key set via role_permissions — the RBAC join, computed at read time, never stored redundantly per-user. */
  async resolveById(roleId) {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: { rolePermissions: { include: { permission: true } } }
    });
    if (!role) return null;
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      permissions: role.rolePermissions.map((rp) => rp.permission.key)
    };
  }
};

// server/repositories/organizationMembershipRepository.ts
var USABLE_ORGANIZATION_STATUSES = ["ACTIVE", "TRIAL"];
var organizationMembershipRepository = {
  /** Returns the membership only if the membership itself AND the organization are both in a usable state — the single check every login/session-verification/org-switch path must use. */
  async findActiveMembership(userId, organizationId) {
    const membership = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { organization: true, role: true }
    });
    if (!membership) return null;
    if (membership.status !== "ACTIVE") return null;
    if (!USABLE_ORGANIZATION_STATUSES.includes(membership.organization.status)) {
      return null;
    }
    return membership;
  },
  async findById(id) {
    return prisma.organizationMembership.findUnique({ where: { id }, include: { organization: true, role: true } });
  },
  async findByUserAndOrg(userId, organizationId) {
    return prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { organization: true, role: true }
    });
  },
  /** All ACTIVE memberships for a user, for GET /auth/me's org-switcher list — deliberately includes memberships in orgs the caller isn't currently "in" via their session. */
  async listActiveForUser(userId) {
    return prisma.organizationMembership.findMany({
      where: { userId, status: "ACTIVE" },
      include: { organization: true, role: true },
      orderBy: { joinedAt: "asc" }
    });
  },
  /** Paginated membership listing for one organization — the basis of GET /api/v1/users' org-scoped list. */
  async listForOrganization(organizationId, page, limit) {
    const [rows, total] = await Promise.all([
      prisma.organizationMembership.findMany({
        where: { organizationId },
        include: { user: true, role: true },
        orderBy: { joinedAt: "asc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.organizationMembership.count({ where: { organizationId } })
    ]);
    return { rows, total };
  },
  async create(data) {
    return prisma.organizationMembership.create({
      data: {
        userId: data.userId,
        organizationId: data.organizationId,
        roleId: data.roleId,
        status: "ACTIVE",
        isPrimary: data.isPrimary ?? false
      }
    });
  },
  async updateRole(id, roleId) {
    return prisma.organizationMembership.update({ where: { id }, data: { roleId } });
  },
  async updateStatus(id, status) {
    return prisma.organizationMembership.update({ where: { id }, data: { status } });
  },
  async remove(id) {
    await prisma.organizationMembership.delete({ where: { id } });
  }
};

// server/repositories/passwordResetRepository.ts
var passwordResetRepository = {
  async create(data) {
    return prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(data.token),
        userId: data.userId,
        expiresAt: data.expiresAt,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent
      }
    });
  },
  /** Returns the token row only if it is unexpired AND unused — a used or expired token is treated identically to a nonexistent one by every caller. */
  async findValidByToken(token) {
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row) return null;
    if (row.usedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row;
  },
  async markUsed(id) {
    await prisma.passwordResetToken.update({ where: { id }, data: { usedAt: /* @__PURE__ */ new Date() } });
  },
  /** A fresh reset request invalidates any prior outstanding token for the same user — at most one usable reset credential at a time. */
  async invalidateAllForUser(userId) {
    await prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: /* @__PURE__ */ new Date() }
    });
  }
};

// server/utils/password.ts
import bcrypt from "bcryptjs";
var SALT_ROUNDS = 12;
async function hashPassword(plainTextPassword) {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}
async function verifyPassword(plainTextPassword, hash) {
  return bcrypt.compare(plainTextPassword, hash);
}
var COMMON_WEAK_PASSWORDS = /* @__PURE__ */ new Set([
  "password",
  "password123",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein123",
  "admin1234",
  "welcome123",
  "changeme123"
]);
function validatePasswordPolicy(password) {
  if (password.length < config.passwordMinLength) {
    return `Password must be at least ${config.passwordMinLength} characters.`;
  }
  if (/^\d+$/.test(password)) {
    return "Password must not be entirely numeric.";
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    return "This password is too common. Choose a less predictable password.";
  }
  return null;
}

// server/types/domain.ts
var SYSTEM_ROLE_KEYS = ["SUPER_ADMIN", "ADMIN", "MANAGER", "USER", "VIEWER"];
function sanitizeUser(user, role) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return { ...rest, role };
}

// server/services/authService.ts
var SELF_REGISTRATION_ROLE_KEY = "ADMIN";
function sessionExpiry() {
  return new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1e3);
}
async function resolveSanitizedUserForOrganization(user, organizationId) {
  const membership = await organizationMembershipRepository.findActiveMembership(user.id, organizationId);
  if (!membership) return null;
  const role = await roleRepository.resolveById(membership.roleId);
  if (!role) {
    throw new InternalError("User role could not be resolved.");
  }
  return sanitizeUser({ ...user, organizationId }, role);
}
var authService = {
  async login(email, password, meta = {}, targetOrganizationId) {
    const user = await userRepository.findByEmail(email);
    const genericFailure = () => new AuthenticationError("Invalid email or password credentials.");
    if (!user) throw genericFailure();
    if (userRepository.isLocked(user)) {
      throw new AuthenticationError(
        "This account is temporarily locked due to repeated failed sign-in attempts. Try again later."
      );
    }
    const validPassword = await verifyPassword(password, user.passwordHash);
    if (!validPassword) {
      const nowLocked = await userRepository.recordFailedLogin(user.id);
      await auditLogRepository.record({
        organizationId: user.organizationId,
        actorUserId: user.id,
        actorType: "USER",
        action: "AUTH_LOGIN_FAILED",
        resourceType: "session",
        resourceId: user.id,
        result: "FAILURE",
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
      if (nowLocked) {
        logger.warn({ event: "account_locked", userId: user.id }, "Account locked after repeated failed logins");
        await auditLogRepository.record({
          organizationId: user.organizationId,
          actorUserId: user.id,
          actorType: "USER",
          action: "AUTH_ACCOUNT_LOCKED",
          resourceType: "user",
          resourceId: user.id,
          result: "FAILURE",
          ipAddress: meta.ip,
          userAgent: meta.userAgent
        });
      }
      throw genericFailure();
    }
    if (user.status !== "ACTIVE") {
      throw new AuthenticationError("This account cannot sign in. Contact your administrator.");
    }
    const organizationId = targetOrganizationId ?? user.organizationId;
    const sanitized = await resolveSanitizedUserForOrganization(user, organizationId);
    if (!sanitized) {
      throw new AuthenticationError("This account does not have active access to the requested organization.");
    }
    await userRepository.recordSuccessfulLogin(user.id);
    const token = generateSessionToken();
    const expiresAt = sessionExpiry();
    await sessionRepository.create({
      token,
      userId: user.id,
      organizationId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: user.id,
      actorName: sanitized.displayName ?? `${user.firstName} ${user.lastName}`,
      actorType: "USER",
      action: "AUTH_LOGIN",
      resourceType: "session",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { session: { token, expiresAt }, user: sanitized };
  },
  async register(payload) {
    const existing = await userRepository.findByEmail(payload.email);
    if (existing) {
      throw new ConflictError("An account with this email address already exists.");
    }
    const adminRole = await roleRepository.findByKey(SELF_REGISTRATION_ROLE_KEY);
    if (!adminRole) {
      throw new InternalError("Registration is not available: required role configuration is missing.");
    }
    const passwordHash = await hashPassword(payload.password);
    await prisma.$transaction(async (tx) => {
      const baseSlug = payload.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "organization";
      let slug = baseSlug;
      let suffix = 1;
      while (await tx.organization.findUnique({ where: { slug } })) {
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
        if (suffix > 50) break;
      }
      const organization = await tx.organization.create({
        data: {
          name: payload.organizationName,
          slug,
          type: "CLIENT",
          tier: "GROWTH",
          status: "TRIAL"
        }
      });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: payload.email.trim().toLowerCase(),
          passwordHash,
          firstName: payload.firstName,
          lastName: payload.lastName,
          displayName: `${payload.firstName} ${payload.lastName}`.trim(),
          title: payload.title?.trim() || "Organization Administrator",
          roleId: adminRole.id
        }
      });
      await tx.organizationMembership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          roleId: adminRole.id,
          status: "ACTIVE",
          isPrimary: true
        }
      });
      return { organization, user };
    });
    return this.login(payload.email, payload.password);
  },
  async verifySession(token) {
    const session = await sessionRepository.findValidByToken(token);
    if (!session) return null;
    const user = await userRepository.findById(session.userId);
    if (!user || user.status !== "ACTIVE") return null;
    const sanitized = await resolveSanitizedUserForOrganization(user, session.organizationId);
    if (!sanitized) return null;
    void sessionRepository.touchLastUsed(session.id);
    return sanitized;
  },
  async logout(token, actor, meta = {}) {
    await sessionRepository.revoke(token);
    if (actor) {
      await auditLogRepository.record({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorType: "USER",
        action: "AUTH_LOGOUT",
        resourceType: "session",
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
  },
  /** Revokes every active session for the user (all devices/tabs) — a broader action than logout(), which only revokes the caller's current session. */
  async logoutAll(user, meta = {}) {
    await sessionRepository.revokeAllForUser(user.id);
    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_LOGOUT_ALL",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  async changePassword(user, currentSessionToken, currentPassword, newPassword, meta = {}) {
    const fullUser = await userRepository.findById(user.id);
    if (!fullUser) throw new InternalError("User record could not be loaded.");
    const validCurrent = await verifyPassword(currentPassword, fullUser.passwordHash);
    if (!validCurrent) {
      throw new AuthenticationError("Current password is incorrect.");
    }
    const newHash = await hashPassword(newPassword);
    await userRepository.updatePasswordHash(user.id, newHash);
    await sessionRepository.revokeAllForUserExcept(user.id, currentSessionToken);
    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_PASSWORD_CHANGE",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  /**
   * Always resolves without revealing whether the email exists (§12
   * enumeration hardening). Returns a `devToken` ONLY outside production —
   * the safe development/test mechanism the brief asks for in place of a
   * real email provider (Phase 13). In production this is always
   * undefined; the raw token is never logged, never included in a
   * production response, and never persisted anywhere but as a hash.
   */
  async requestPasswordReset(email, meta = {}) {
    const user = await userRepository.findByEmail(email);
    if (!user || user.status !== "ACTIVE") {
      return {};
    }
    await passwordResetRepository.invalidateAllForUser(user.id);
    const token = generateResetToken();
    const expiresAt = new Date(Date.now() + config.passwordResetTokenTtlMinutes * 60 * 1e3);
    await passwordResetRepository.create({
      token,
      userId: user.id,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_PASSWORD_RESET_REQUESTED",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return config.isProduction ? {} : { devToken: token };
  },
  async confirmPasswordReset(token, newPassword, meta = {}) {
    const resetRow = await passwordResetRepository.findValidByToken(token);
    if (!resetRow) {
      throw new AuthenticationError("This password reset link is invalid or has expired.");
    }
    const user = await userRepository.findById(resetRow.userId);
    if (!user) {
      throw new InternalError("Reset token references a user that no longer exists.");
    }
    const newHash = await hashPassword(newPassword);
    await userRepository.updatePasswordHash(user.id, newHash);
    await passwordResetRepository.markUsed(resetRow.id);
    await passwordResetRepository.invalidateAllForUser(user.id);
    await sessionRepository.revokeAllForUser(user.id);
    await auditLogRepository.record({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_PASSWORD_RESET_COMPLETED",
      resourceType: "user",
      resourceId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  /**
   * Switches the caller's active session to a different organization they
   * hold active membership in (§18). Never trusts the target organizationId
   * without re-verifying membership; permissions are recalculated from
   * that organization's role, not carried over. Implemented as session
   * rotation (new token issued, old one revoked) rather than mutating the
   * existing session row in place.
   */
  async switchOrganization(user, currentSessionToken, targetOrganizationId, meta = {}) {
    const fullUser = await userRepository.findById(user.id);
    if (!fullUser) throw new InternalError("User record could not be loaded.");
    const sanitized = await resolveSanitizedUserForOrganization(fullUser, targetOrganizationId);
    if (!sanitized) {
      throw new AuthorizationError("You do not have active access to the requested organization.");
    }
    const token = generateSessionToken();
    const expiresAt = sessionExpiry();
    await sessionRepository.create({
      token,
      userId: user.id,
      organizationId: targetOrganizationId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    await sessionRepository.revoke(currentSessionToken);
    await auditLogRepository.record({
      organizationId: targetOrganizationId,
      actorUserId: user.id,
      actorType: "USER",
      action: "AUTH_ORGANIZATION_SWITCH",
      resourceType: "session",
      resourceId: user.id,
      beforeData: { organizationId: user.organizationId },
      afterData: { organizationId: targetOrganizationId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { session: { token, expiresAt }, user: sanitized };
  },
  /** The org-switcher list for GET /auth/me — every organization the user can currently switch into. */
  async listMemberships(userId, currentOrganizationId) {
    const memberships = await organizationMembershipRepository.listActiveForUser(userId);
    return memberships.map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      organizationSlug: m.organization.slug,
      roleKey: m.role.key,
      roleName: m.role.name,
      isPrimary: m.isPrimary,
      isCurrent: m.organizationId === currentOrganizationId
    }));
  }
};

// server/utils/asyncHandler.ts
function asyncHandler(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

// server/middleware/auth.ts
var SUPER_ADMIN_ROLE_KEY = "SUPER_ADMIN";
function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return void 0;
}
var authenticateToken = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw new AuthenticationError("Authentication token is required.");
  }
  const user = await authService.verifySession(token);
  if (!user) {
    throw new AuthenticationError("Invalid or expired session token.");
  }
  req.user = user;
  req.sessionToken = token;
  req.organizationId = user.organizationId;
  next();
});
var optionalAuthenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);
  if (token) {
    const user = await authService.verifySession(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
      req.organizationId = user.organizationId;
    }
  }
  next();
});
function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user) throw new AuthenticationError();
    if (req.user.role.key === SUPER_ADMIN_ROLE_KEY) return next();
    if (!req.user.role.permissions.includes(permission)) {
      throw new AuthorizationError(`Permission denied. Required privilege: "${permission}"`);
    }
    next();
  };
}
function requireRole(allowedRoleKeys) {
  return (req, _res, next) => {
    if (!req.user) throw new AuthenticationError();
    if (req.user.role.key === SUPER_ADMIN_ROLE_KEY || allowedRoleKeys.includes(req.user.role.key)) {
      return next();
    }
    throw new AuthorizationError(`Forbidden. Requires one of: ${allowedRoleKeys.join(", ")}`);
  };
}

// server/schemas/authSchemas.ts
import { z as z2 } from "zod";
var newPasswordSchema = z2.string().superRefine((password, ctx) => {
  const issue = validatePasswordPolicy(password);
  if (issue) {
    ctx.addIssue({ code: z2.ZodIssueCode.custom, message: issue });
  }
});
var loginSchema = z2.object({
  email: z2.string().trim().min(1).email(),
  password: z2.string().min(1)
});
var registerSchema = z2.object({
  email: z2.string().trim().min(1).email(),
  password: newPasswordSchema,
  firstName: z2.string().trim().min(1).max(100),
  lastName: z2.string().trim().min(1).max(100),
  organizationName: z2.string().trim().min(1).max(200),
  title: z2.string().trim().min(1).max(150).optional()
});
var changePasswordSchema = z2.object({
  currentPassword: z2.string().min(1),
  newPassword: newPasswordSchema
}).refine((v) => v.currentPassword !== v.newPassword, {
  message: "New password must be different from the current password.",
  path: ["newPassword"]
});
var passwordResetRequestSchema = z2.object({
  email: z2.string().trim().min(1).email()
});
var passwordResetConfirmSchema = z2.object({
  token: z2.string().trim().min(1),
  newPassword: newPasswordSchema
});
var switchOrganizationSchema = z2.object({
  organizationId: z2.string().trim().uuid()
});

// server/routes/v1/authRoutes.ts
var router = Router();
function requestMeta(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input.email, input.password, requestMeta(req));
    sendSuccess(res, result);
  })
);
router.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await authService.register(input);
    sendSuccess(res, result, 201);
  })
);
router.get(
  "/me",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const organizations = await authService.listMemberships(req.user.id, req.user.organizationId);
    sendSuccess(res, { user: req.user, organizations });
  })
);
router.post(
  "/logout",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (req.sessionToken) {
      await authService.logout(
        req.sessionToken,
        { userId: req.user.id, organizationId: req.user.organizationId },
        requestMeta(req)
      );
    }
    sendSuccess(res, { message: "Logged out successfully." });
  })
);
router.post(
  "/logout-all",
  authenticateToken,
  asyncHandler(async (req, res) => {
    await authService.logoutAll(req.user, requestMeta(req));
    sendSuccess(res, { message: "All sessions have been revoked." });
  })
);
router.post(
  "/change-password",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    if (!req.sessionToken) throw new AuthenticationError();
    await authService.changePassword(req.user, req.sessionToken, input.currentPassword, input.newPassword, requestMeta(req));
    sendSuccess(res, { message: "Password changed successfully. Other active sessions have been signed out." });
  })
);
router.post(
  "/password-reset/request",
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const input = passwordResetRequestSchema.parse(req.body);
    const result = await authService.requestPasswordReset(input.email, requestMeta(req));
    sendSuccess(res, {
      message: "If an account with that email exists, password reset instructions have been sent.",
      // Present only outside production — see authService.requestPasswordReset's doc comment.
      ...result.devToken ? { devToken: result.devToken } : {}
    });
  })
);
router.post(
  "/password-reset/confirm",
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const input = passwordResetConfirmSchema.parse(req.body);
    await authService.confirmPasswordReset(input.token, input.newPassword, requestMeta(req));
    sendSuccess(res, { message: "Password has been reset. Please sign in with your new password." });
  })
);
router.get(
  "/sessions",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const [sessions, currentSession] = await Promise.all([
      sessionRepository.listActiveForUser(req.user.id),
      req.sessionToken ? sessionRepository.findValidByToken(req.sessionToken) : null
    ]);
    sendSuccess(res, {
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        lastUsedAt: s.lastUsedAt,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        isCurrent: currentSession?.id === s.id
      }))
    });
  })
);
router.post(
  "/sessions/:id/revoke",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const revoked = await sessionRepository.revokeByIdForUser(req.params.id, req.user.id);
    if (!revoked) throw new NotFoundError("Session not found.");
    await auditLogRepository.record({
      organizationId: req.user.organizationId,
      actorUserId: req.user.id,
      actorType: "USER",
      action: "AUTH_SESSION_REVOKED",
      resourceType: "session",
      resourceId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]
    });
    sendSuccess(res, { message: "Session revoked." });
  })
);
router.post(
  "/switch-organization",
  authenticateToken,
  sensitiveActionLimiter,
  asyncHandler(async (req, res) => {
    const input = switchOrganizationSchema.parse(req.body);
    if (!req.sessionToken) throw new AuthenticationError();
    const result = await authService.switchOrganization(req.user, req.sessionToken, input.organizationId, requestMeta(req));
    sendSuccess(res, result);
  })
);
var authRoutes_default = router;

// server/routes/v1/webhookRoutes.ts
import { Router as Router2 } from "express";

// server/repositories/webhookEventRepository.ts
import { Prisma } from "@prisma/client";
var UNIQUE_CONSTRAINT_VIOLATION = "P2002";
var webhookEventRepository = {
  /**
   * Records an inbound webhook delivery. Returns `{ duplicate: true }`
   * instead of throwing if (provider, deliveryId) was already recorded —
   * this is the idempotency/replay guard required by Phase 1 §20 and
   * docs/SECURITY_MODEL.md.
   */
  async recordDelivery(entry) {
    try {
      await prisma.webhookEvent.create({
        data: {
          provider: entry.provider,
          deliveryId: entry.deliveryId,
          eventType: entry.eventType,
          signatureValid: entry.signatureValid,
          status: entry.status,
          payload: entry.payload,
          organizationId: entry.organizationId
        }
      });
      return { duplicate: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_CONSTRAINT_VIOLATION) {
        return { duplicate: true };
      }
      throw err;
    }
  },
  async findByDeliveryId(provider, deliveryId) {
    return prisma.webhookEvent.findUnique({
      where: { provider_deliveryId: { provider, deliveryId } }
    });
  }
};

// server/services/webhookService.ts
var REPLAY_WINDOW_SECONDS = 5 * 60;
var SIGNATURE_HEADER = "x-artify-webhook-signature";
var TIMESTAMP_HEADER = "x-artify-webhook-timestamp";
function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
function verifyWebhookSignature(input) {
  const signature = firstHeaderValue(input.signatureHeader);
  const timestampRaw = firstHeaderValue(input.timestampHeader);
  if (!signature || !timestampRaw || !input.rawBody) {
    throw new AuthenticationError("Missing or invalid webhook signature.");
  }
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) {
    throw new AuthenticationError("Missing or invalid webhook signature.");
  }
  const nowSeconds = Math.floor(Date.now() / 1e3);
  const skewSeconds = Math.abs(nowSeconds - timestamp);
  if (skewSeconds > REPLAY_WINDOW_SECONDS) {
    throw new AuthenticationError("Webhook signature has expired.");
  }
  const signedPayload = Buffer.concat([Buffer.from(`${timestampRaw}.`), input.rawBody]);
  const valid = verifyHmacSignature(config.webhookSecret, signedPayload, signature);
  if (!valid) {
    throw new AuthenticationError("Missing or invalid webhook signature.");
  }
}
var webhookService = {
  /**
   * Verifies the signature, then atomically records the delivery for
   * idempotency. Throws ConflictError on a duplicate delivery (same
   * provider + deliveryId already recorded) — the caller returns 200 for
   * duplicates per standard webhook convention (already-processed is not
   * an error to the sender), which the route handler decides, not this
   * service.
   */
  async ingestLeadEvent(payload, verification) {
    verifyWebhookSignature(verification);
    const { duplicate } = await webhookEventRepository.recordDelivery({
      provider: "artify-website",
      deliveryId: payload.deliveryId,
      eventType: payload.eventType,
      signatureValid: true,
      status: "VERIFIED",
      payload
    });
    if (duplicate) {
      logger.info({ event: "webhook_duplicate", deliveryId: payload.deliveryId }, "Duplicate webhook delivery ignored");
      return { duplicate: true };
    }
    logger.info({ event: "webhook_received", deliveryId: payload.deliveryId }, "Lead webhook verified and recorded");
    return { duplicate: false };
  }
};

// server/schemas/webhookSchemas.ts
import { z as z3 } from "zod";
var leadWebhookPayloadSchema = z3.object({
  deliveryId: z3.string().min(1).max(200),
  eventType: z3.string().min(1).max(100).default("lead.created"),
  name: z3.string().min(1).max(200),
  email: z3.string().email(),
  companyName: z3.string().min(1).max(200),
  projectBrief: z3.string().min(1).max(5e3),
  source: z3.string().max(100).optional()
});

// server/routes/v1/webhookRoutes.ts
var router2 = Router2();
router2.post(
  "/leads",
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const payload = leadWebhookPayloadSchema.parse(req.body);
    const result = await webhookService.ingestLeadEvent(payload, {
      rawBody: req.rawBody,
      signatureHeader: req.headers[SIGNATURE_HEADER],
      timestampHeader: req.headers[TIMESTAMP_HEADER]
    });
    sendSuccess(res, { accepted: true, duplicate: result.duplicate });
  })
);
var webhookRoutes_default = router2;

// server/routes/v1/systemRoutes.ts
import { Router as Router3 } from "express";

// server/db/health.ts
var READINESS_TIMEOUT_MS = 2e3;
async function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
async function checkDatabase() {
  const start = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, READINESS_TIMEOUT_MS);
    return { name: "postgresql", healthy: true, latencyMs: Date.now() - start };
  } catch (err) {
    logger.error({ err, event: "db_health_check_failed" }, "Database readiness check failed");
    return { name: "postgresql", healthy: false };
  }
}

// server/routes/v1/systemRoutes.ts
var router3 = Router3();
router3.get("/live", (_req, res) => {
  sendSuccess(res, { status: "alive", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
router3.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    const dbCheck = await checkDatabase();
    const dependencies = [dbCheck];
    const healthy = dependencies.every((dep) => dep.healthy);
    sendSuccess(
      res,
      {
        status: healthy ? "ready" : "not_ready",
        environment: config.nodeEnv,
        dependencies: dependencies.map((dep) => ({ name: dep.name, healthy: dep.healthy, latencyMs: dep.latencyMs })),
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      },
      healthy ? 200 : 503
    );
  })
);
router3.get(
  "/database",
  authenticateToken,
  requireRole(["SUPER_ADMIN"]),
  asyncHandler(async (_req, res) => {
    const dbCheck = await checkDatabase();
    const [migrations, organizationCount, userCount, roleCount, permissionCount] = await Promise.all([
      prisma.$queryRaw`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC`,
      prisma.organization.count(),
      prisma.user.count(),
      prisma.role.count(),
      prisma.permission.count()
    ]);
    sendSuccess(res, {
      provider: "PostgreSQL",
      healthy: dbCheck.healthy,
      latencyMs: dbCheck.latencyMs,
      migrations: {
        applied: migrations.filter((m) => m.finished_at !== null).length,
        pending: migrations.filter((m) => m.finished_at === null).length,
        names: migrations.map((m) => m.migration_name)
      },
      counts: {
        organizations: organizationCount,
        users: userCount,
        roles: roleCount,
        permissions: permissionCount
      }
    });
  })
);
var systemRoutes_default = router3;

// server/routes/v1/userRoutes.ts
import { Router as Router4 } from "express";

// server/services/userService.ts
async function resolveRoleOrThrow(roleKey) {
  const role = await roleRepository.findByKey(roleKey);
  if (!role) throw new ValidationError(`Unknown role: ${roleKey}`);
  return role;
}
async function loadUserInOrgOrThrow(userId, organizationId) {
  const membership = await organizationMembershipRepository.findByUserAndOrg(userId, organizationId);
  if (!membership) throw new NotFoundError("User not found.");
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User not found.");
  const role = await roleRepository.resolveById(membership.roleId);
  if (!role) throw new NotFoundError("User not found.");
  return sanitizeUser({ ...user, organizationId }, role);
}
var userService = {
  async listUsers(organizationId, page, limit) {
    const { rows, total } = await organizationMembershipRepository.listForOrganization(organizationId, page, limit);
    const users = rows.map((m) => sanitizeUser({ ...m.user, organizationId }, { id: m.role.id, key: m.role.key, name: m.role.name, permissions: [] }));
    return { users, total };
  },
  async getUser(organizationId, userId) {
    return loadUserInOrgOrThrow(userId, organizationId);
  },
  async createUser(caller, input, meta = {}) {
    const existing = await userRepository.findByEmail(input.email);
    if (existing) throw new ConflictError("An account with this email address already exists.");
    const role = await resolveRoleOrThrow(input.roleKey);
    const passwordHash = await hashPassword(input.password);
    const user = await userRepository.create({
      organizationId: caller.organizationId,
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      title: input.title,
      roleId: role.id
    });
    await organizationMembershipRepository.create({
      userId: user.id,
      organizationId: caller.organizationId,
      roleId: role.id,
      isPrimary: true
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "USER_CREATED",
      resourceType: "user",
      resourceId: user.id,
      afterData: { email: user.email, roleKey: role.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return sanitizeUser({ ...user, organizationId: caller.organizationId }, { id: role.id, key: role.key, name: role.name, permissions: [] });
  },
  async updateUser(caller, targetUserId, input, callerPermissions, meta = {}) {
    const membership = await organizationMembershipRepository.findByUserAndOrg(targetUserId, caller.organizationId);
    if (!membership) throw new NotFoundError("User not found.");
    const beforeRoleKey = membership.role.key;
    if (input.roleKey !== void 0) {
      if (!callerPermissions.includes("roles.assign") && caller.role.key !== "SUPER_ADMIN") {
        throw new AuthorizationError('Permission denied. Required privilege: "roles.assign"');
      }
      if (targetUserId === caller.id) {
        throw new AuthorizationError("You cannot change your own role.");
      }
      const newRole = await resolveRoleOrThrow(input.roleKey);
      await organizationMembershipRepository.updateRole(membership.id, newRole.id);
      await auditLogRepository.record({
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "USER_ROLE_CHANGED",
        resourceType: "user",
        resourceId: targetUserId,
        beforeData: { roleKey: beforeRoleKey },
        afterData: { roleKey: newRole.key },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
    const profilePatch = {};
    if (input.firstName !== void 0) profilePatch.firstName = input.firstName;
    if (input.lastName !== void 0) profilePatch.lastName = input.lastName;
    if (input.title !== void 0) profilePatch.title = input.title;
    if (input.phone !== void 0) profilePatch.phone = input.phone;
    if (input.status !== void 0) profilePatch.status = input.status;
    if (Object.keys(profilePatch).length > 0) {
      await userRepository.updateProfile(targetUserId, profilePatch);
      if (input.status !== void 0) {
        await auditLogRepository.record({
          organizationId: caller.organizationId,
          actorUserId: caller.id,
          actorType: "USER",
          action: "USER_STATUS_CHANGED",
          resourceType: "user",
          resourceId: targetUserId,
          afterData: { status: input.status },
          ipAddress: meta.ip,
          userAgent: meta.userAgent
        });
        if (input.status === "DISABLED") {
          await sessionRepository.revokeAllForUser(targetUserId);
        }
      } else {
        await auditLogRepository.record({
          organizationId: caller.organizationId,
          actorUserId: caller.id,
          actorType: "USER",
          action: "USER_UPDATED",
          resourceType: "user",
          resourceId: targetUserId,
          afterData: profilePatch,
          ipAddress: meta.ip,
          userAgent: meta.userAgent
        });
      }
    }
    return loadUserInOrgOrThrow(targetUserId, caller.organizationId);
  }
};

// server/schemas/userSchemas.ts
import { z as z4 } from "zod";
var newPasswordSchema2 = z4.string().superRefine((password, ctx) => {
  const issue = validatePasswordPolicy(password);
  if (issue) ctx.addIssue({ code: z4.ZodIssueCode.custom, message: issue });
});
var assignableRoleKeySchema = z4.enum(
  SYSTEM_ROLE_KEYS.filter((k) => k !== "SUPER_ADMIN")
);
var listUsersQuerySchema = z4.object({
  page: z4.coerce.number().int().positive().default(1),
  limit: z4.coerce.number().int().positive().max(100).default(20),
  organizationId: z4.string().trim().uuid().optional()
});
var createUserSchema = z4.object({
  email: z4.string().trim().min(1).email(),
  password: newPasswordSchema2,
  firstName: z4.string().trim().min(1).max(100),
  lastName: z4.string().trim().min(1).max(100),
  title: z4.string().trim().max(150).optional(),
  roleKey: assignableRoleKeySchema
});
var updateUserSchema = z4.object({
  firstName: z4.string().trim().min(1).max(100).optional(),
  lastName: z4.string().trim().min(1).max(100).optional(),
  title: z4.string().trim().max(150).nullable().optional(),
  phone: z4.string().trim().max(50).nullable().optional(),
  status: z4.enum(["ACTIVE", "INVITED", "DISABLED"]).optional(),
  roleKey: assignableRoleKeySchema.optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
var addMemberSchema = z4.object({
  userId: z4.string().trim().uuid(),
  roleKey: assignableRoleKeySchema
});
var updateMemberSchema = z4.object({
  roleKey: assignableRoleKeySchema.optional(),
  status: z4.enum(["ACTIVE", "INVITED", "SUSPENDED"]).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/routes/v1/userRoutes.ts
var router4 = Router4();
router4.use(authenticateToken);
router4.get(
  "/",
  requirePermission("users.read"),
  asyncHandler(async (req, res) => {
    const query = listUsersQuerySchema.parse(req.query);
    const organizationId = req.user.role.key === "SUPER_ADMIN" && query.organizationId ? query.organizationId : req.user.organizationId;
    const { users, total } = await userService.listUsers(organizationId, query.page, query.limit);
    sendSuccess(res, { users }, 200, { page: query.page, limit: query.limit, total });
  })
);
router4.get(
  "/:id",
  requirePermission("users.read"),
  asyncHandler(async (req, res) => {
    const user = await userService.getUser(req.user.organizationId, req.params.id);
    sendSuccess(res, { user });
  })
);
router4.post(
  "/",
  requirePermission("users.create"),
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = await userService.createUser(req.user, input, { ip: req.ip, userAgent: req.headers["user-agent"] });
    sendSuccess(res, { user }, 201);
  })
);
router4.patch(
  "/:id",
  requirePermission("users.update"),
  asyncHandler(async (req, res) => {
    const input = updateUserSchema.parse(req.body);
    const user = await userService.updateUser(req.user, req.params.id, input, req.user.role.permissions, {
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });
    sendSuccess(res, { user });
  })
);
var userRoutes_default = router4;

// server/routes/v1/roleRoutes.ts
import { Router as Router5 } from "express";
var router5 = Router5();
router5.use(authenticateToken);
router5.get(
  "/",
  requirePermission("roles.read"),
  asyncHandler(async (_req, res) => {
    const roles = await roleRepository.listAllResolved();
    sendSuccess(res, { roles });
  })
);
var roleRoutes_default = router5;
var permissionsRouter = Router5();
permissionsRouter.use(authenticateToken);
permissionsRouter.get(
  "/",
  requirePermission("roles.read"),
  asyncHandler(async (_req, res) => {
    const permissions = await prisma.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }] });
    sendSuccess(res, { permissions });
  })
);

// server/routes/v1/organizationRoutes.ts
import { Router as Router6 } from "express";

// server/repositories/organizationRepository.ts
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}
var organizationRepository = {
  async findById(id) {
    return prisma.organization.findUnique({ where: { id } });
  },
  async findBySlug(slug) {
    return prisma.organization.findUnique({ where: { slug } });
  },
  /** Finds the platform operator's own organization (type=INTERNAL). Used for "global" settings ownership — see SystemSetting's schema doc comment. */
  async findInternal() {
    return prisma.organization.findFirst({ where: { type: "INTERNAL" } });
  },
  async create(data) {
    const baseSlug = slugify(data.name) || "organization";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlug(slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return prisma.organization.create({
      data: {
        name: data.name,
        slug,
        tier: "GROWTH",
        status: "TRIAL",
        type: "CLIENT"
      }
    });
  }
};

// server/services/organizationService.ts
async function resolveRoleOrThrow2(roleKey) {
  const role = await roleRepository.findByKey(roleKey);
  if (!role) throw new ValidationError(`Unknown role: ${roleKey}`);
  return role;
}
var organizationService = {
  async listOrganizations(caller) {
    if (caller.role.key === "SUPER_ADMIN") {
      return prisma.organization.findMany({ orderBy: { name: "asc" } });
    }
    const memberships = await organizationMembershipRepository.listActiveForUser(caller.id);
    return memberships.map((m) => m.organization);
  },
  async getOrganization(caller, organizationId) {
    if (caller.role.key !== "SUPER_ADMIN") {
      const membership = await organizationMembershipRepository.findActiveMembership(caller.id, organizationId);
      if (!membership) throw new NotFoundError("Organization not found.");
    }
    const org = await organizationRepository.findById(organizationId);
    if (!org) throw new NotFoundError("Organization not found.");
    return org;
  },
  async addMember(caller, organizationId, input, meta = {}) {
    if (caller.role.key !== "SUPER_ADMIN" && organizationId !== caller.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    const targetUser = await userRepository.findById(input.userId);
    if (!targetUser) throw new NotFoundError("User not found.");
    const existing = await organizationMembershipRepository.findByUserAndOrg(input.userId, organizationId);
    if (existing) throw new ValidationError("This user is already a member of the organization.");
    const role = await resolveRoleOrThrow2(input.roleKey);
    const membership = await organizationMembershipRepository.create({
      userId: input.userId,
      organizationId,
      roleId: role.id
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ORG_MEMBERSHIP_ADDED",
      resourceType: "organization_membership",
      resourceId: membership.id,
      afterData: { userId: input.userId, roleKey: role.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return membership;
  },
  async updateMember(caller, organizationId, targetUserId, input, callerPermissions, meta = {}) {
    if (caller.role.key !== "SUPER_ADMIN" && organizationId !== caller.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    if (targetUserId === caller.id && input.roleKey !== void 0) {
      throw new AuthorizationError("You cannot change your own role.");
    }
    const membership = await organizationMembershipRepository.findByUserAndOrg(targetUserId, organizationId);
    if (!membership) throw new NotFoundError("Membership not found.");
    if (input.roleKey !== void 0) {
      if (!callerPermissions.includes("roles.assign") && caller.role.key !== "SUPER_ADMIN") {
        throw new AuthorizationError('Permission denied. Required privilege: "roles.assign"');
      }
      const role = await resolveRoleOrThrow2(input.roleKey);
      await organizationMembershipRepository.updateRole(membership.id, role.id);
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "USER_ROLE_CHANGED",
        resourceType: "organization_membership",
        resourceId: membership.id,
        beforeData: { roleKey: membership.role.key },
        afterData: { roleKey: role.key },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
    if (input.status !== void 0) {
      await organizationMembershipRepository.updateStatus(membership.id, input.status);
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "ORG_MEMBERSHIP_UPDATED",
        resourceType: "organization_membership",
        resourceId: membership.id,
        afterData: { status: input.status },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
    return organizationMembershipRepository.findById(membership.id);
  },
  async removeMember(caller, organizationId, targetUserId, meta = {}) {
    if (caller.role.key !== "SUPER_ADMIN" && organizationId !== caller.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    if (targetUserId === caller.id) {
      throw new AuthorizationError("You cannot remove your own membership.");
    }
    const membership = await organizationMembershipRepository.findByUserAndOrg(targetUserId, organizationId);
    if (!membership) throw new NotFoundError("Membership not found.");
    await organizationMembershipRepository.remove(membership.id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ORG_MEMBERSHIP_REMOVED",
      resourceType: "organization_membership",
      resourceId: targetUserId,
      beforeData: { roleKey: membership.role.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/routes/v1/organizationRoutes.ts
var router6 = Router6();
router6.use(authenticateToken);
router6.get(
  "/",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    const organizations = await organizationService.listOrganizations(req.user);
    sendSuccess(res, { organizations });
  })
);
router6.get(
  "/:id",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    const organization = await organizationService.getOrganization(req.user, req.params.id);
    sendSuccess(res, { organization });
  })
);
router6.get(
  "/:id/summary",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    if (req.user.role.key !== "SUPER_ADMIN" && req.params.id !== req.user.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    const [{ total: memberCount }, activeSessionCount] = await Promise.all([
      organizationMembershipRepository.listForOrganization(req.params.id, 1, 1),
      sessionRepository.countActiveForOrganization(req.params.id)
    ]);
    sendSuccess(res, { memberCount, activeSessionCount });
  })
);
router6.get(
  "/:id/members",
  requirePermission("organizations.read"),
  asyncHandler(async (req, res) => {
    if (req.user.role.key !== "SUPER_ADMIN" && req.params.id !== req.user.organizationId) {
      throw new AuthorizationError("Access denied: resource belongs to a different organization");
    }
    const query = listUsersQuerySchema.parse(req.query);
    const { rows, total } = await organizationMembershipRepository.listForOrganization(req.params.id, query.page, query.limit);
    const members = rows.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      displayName: m.user.displayName,
      status: m.status,
      isPrimary: m.isPrimary,
      roleKey: m.role.key,
      roleName: m.role.name,
      joinedAt: m.joinedAt
    }));
    sendSuccess(res, { members }, 200, { page: query.page, limit: query.limit, total });
  })
);
router6.post(
  "/:id/members",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    const input = addMemberSchema.parse(req.body);
    const membership = await organizationService.addMember(req.user, req.params.id, input, {
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });
    sendSuccess(res, { membership }, 201);
  })
);
router6.patch(
  "/:id/members/:userId",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    const input = updateMemberSchema.parse(req.body);
    const membership = await organizationService.updateMember(
      req.user,
      req.params.id,
      req.params.userId,
      input,
      req.user.role.permissions,
      { ip: req.ip, userAgent: req.headers["user-agent"] }
    );
    sendSuccess(res, { membership });
  })
);
router6.delete(
  "/:id/members/:userId",
  requirePermission("organizations.manage_members"),
  asyncHandler(async (req, res) => {
    await organizationService.removeMember(req.user, req.params.id, req.params.userId, {
      ip: req.ip,
      userAgent: req.headers["user-agent"]
    });
    sendSuccess(res, { message: "Membership removed." });
  })
);
var organizationRoutes_default = router6;

// server/routes/v1/auditLogRoutes.ts
import { Router as Router7 } from "express";

// server/repositories/auditLogQueryRepository.ts
var auditLogQueryRepository = {
  async list(filters, page, limit) {
    const where = {
      organizationId: filters.organizationId,
      actorUserId: filters.actorUserId,
      action: filters.action,
      resourceType: filters.resourceType,
      result: filters.result,
      actorType: filters.actorType
    };
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {
        ...filters.dateFrom ? { gte: filters.dateFrom } : {},
        ...filters.dateTo ? { lte: filters.dateTo } : {}
      };
    }
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.auditLog.count({ where })
    ]);
    return { rows, total };
  }
};

// server/schemas/auditLogSchemas.ts
import { z as z5 } from "zod";
var listAuditLogsQuerySchema = z5.object({
  page: z5.coerce.number().int().positive().default(1),
  limit: z5.coerce.number().int().positive().max(100).default(20),
  organizationId: z5.string().trim().uuid().optional(),
  actorUserId: z5.string().trim().uuid().optional(),
  action: z5.string().trim().max(100).optional(),
  resourceType: z5.string().trim().max(100).optional(),
  result: z5.enum(["SUCCESS", "FAILURE"]).optional(),
  dateFrom: z5.coerce.date().optional(),
  dateTo: z5.coerce.date().optional()
});

// server/routes/v1/auditLogRoutes.ts
var router7 = Router7();
router7.use(authenticateToken);
router7.get(
  "/",
  requirePermission("audit.read"),
  asyncHandler(async (req, res) => {
    const query = listAuditLogsQuerySchema.parse(req.query);
    const organizationId = req.user.role.key === "SUPER_ADMIN" && query.organizationId ? query.organizationId : req.user.organizationId;
    const { rows, total } = await auditLogQueryRepository.list(
      {
        organizationId,
        actorUserId: query.actorUserId,
        action: query.action,
        resourceType: query.resourceType,
        result: query.result,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo
      },
      query.page,
      query.limit
    );
    sendSuccess(res, { auditLogs: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
var auditLogRoutes_default = router7;

// server/routes/v1/settingsRoutes.ts
import { Router as Router8 } from "express";

// server/repositories/systemSettingRepository.ts
var systemSettingRepository = {
  async listForOrganization(organizationId) {
    return prisma.systemSetting.findMany({ where: { organizationId }, orderBy: { key: "asc" } });
  },
  async upsert(data) {
    return prisma.systemSetting.upsert({
      where: { organizationId_key: { organizationId: data.organizationId, key: data.key } },
      update: {
        value: data.value,
        type: data.type,
        description: data.description,
        updatedById: data.updatedById
      },
      create: {
        organizationId: data.organizationId,
        key: data.key,
        value: data.value,
        type: data.type,
        description: data.description,
        updatedById: data.updatedById
      }
    });
  }
};

// server/schemas/settingsSchemas.ts
import { z as z6 } from "zod";
var updateSettingSchema = z6.object({
  value: z6.unknown(),
  type: z6.enum(["STRING", "NUMBER", "BOOLEAN", "JSON"]).default("STRING"),
  description: z6.string().trim().max(500).optional()
});

// server/routes/v1/settingsRoutes.ts
var router8 = Router8();
router8.use(authenticateToken);
router8.get(
  "/",
  requirePermission("settings.read"),
  asyncHandler(async (req, res) => {
    const settings = await systemSettingRepository.listForOrganization(req.user.organizationId);
    sendSuccess(res, { settings });
  })
);
router8.patch(
  "/:key",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const input = updateSettingSchema.parse(req.body);
    const setting = await systemSettingRepository.upsert({
      organizationId: req.user.organizationId,
      key: req.params.key,
      value: input.value,
      type: input.type,
      description: input.description,
      updatedById: req.user.id
    });
    await auditLogRepository.record({
      organizationId: req.user.organizationId,
      actorUserId: req.user.id,
      actorType: "USER",
      action: "SETTINGS_UPDATED",
      resourceType: "system_setting",
      resourceId: setting.id,
      afterData: { key: setting.key },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"]
    });
    sendSuccess(res, { setting });
  })
);
var settingsRoutes_default = router8;

// server/routes/v1/leadRoutes.ts
import { Router as Router9 } from "express";

// server/repositories/leadRepository.ts
function buildWhere(organizationId, filters) {
  const where = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;
  if (filters.assignedTo) where.assignedTo = filters.assignedTo;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...filters.dateFrom ? { gte: filters.dateFrom } : {},
      ...filters.dateTo ? { lte: filters.dateTo } : {}
    };
  }
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { companyName: { contains: term, mode: "insensitive" } },
      { contactName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } }
    ];
  }
  return where;
}
var leadRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.lead.count({ where })
    ]);
    return { rows, total };
  },
  /** The only lookup-by-id this module exposes — always organization-scoped, so a cross-tenant id guess returns null, never another org's row (§4). */
  async findByIdInOrg(id, organizationId) {
    return prisma.lead.findFirst({ where: { id, organizationId, deletedAt: null } });
  },
  async findByEmailInOrg(organizationId, email) {
    return prisma.lead.findMany({
      where: { organizationId, email, deletedAt: null, status: { notIn: ["CONVERTED", "LOST"] } }
    });
  },
  async create(data) {
    return prisma.lead.create({
      data: {
        organizationId: data.organizationId,
        companyName: data.companyName,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        source: data.source,
        status: data.status ?? "NEW",
        notes: data.notes,
        assignedTo: data.assignedTo
      }
    });
  },
  async update(id, data) {
    return prisma.lead.update({ where: { id }, data });
  },
  async softDelete(id) {
    await prisma.lead.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  },
  async countByStatus(organizationId) {
    const rows = await prisma.lead.groupBy({
      by: ["status"],
      where: { organizationId, deletedAt: null },
      _count: { _all: true }
    });
    const result = {};
    for (const row of rows) result[row.status] = row._count._all;
    return result;
  },
  async recentForOrg(organizationId, limit) {
    return prisma.lead.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }
};

// server/repositories/clientRepository.ts
var clientWithWorkspace = { include: { workspaceOrganization: true } };
function buildWhere2(organizationId, filters) {
  const where = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { legalName: { contains: term, mode: "insensitive" } },
      { clientCode: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } }
    ];
  }
  return where;
}
var clientRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere2(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.client.findMany({
        where,
        ...clientWithWorkspace,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.client.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.client.findFirst({ where: { id, organizationId, deletedAt: null }, ...clientWithWorkspace });
  },
  /**
   * The Client Portal boundary (Phase 10 §25/§26 —
   * docs/CLIENT_PORTAL_ARCHITECTURE.md): Contract/Subscription/Invoice/
   * Payment.organizationId is always the AGENCY's own org (the same org
   * that owns this Client row), never the client's own provisioned
   * workspace org — so portal access resolves the caller's *session*
   * organizationId (after they've switched into a client's workspace via
   * the Phase 3 switchOrganization mechanism) to the one Client row whose
   * `workspaceOrganizationId` matches, then scopes every portal query by
   * that Client's id. An agency staffer viewing their own internal org
   * naturally finds no matching row here and is blocked from a portal
   * view of it.
   */
  async findByWorkspaceOrganizationId(workspaceOrganizationId) {
    return prisma.client.findFirst({ where: { workspaceOrganizationId, deletedAt: null } });
  },
  /** Case-insensitive duplicate-name check within a tenant (§19) — soft, service-level, not a DB unique constraint (see schema.prisma's Client doc comment for why). */
  async findByNameInOrg(organizationId, name) {
    return prisma.client.findFirst({
      where: { organizationId, deletedAt: null, name: { equals: name, mode: "insensitive" } }
    });
  },
  async findByCodeInOrg(organizationId, clientCode) {
    return prisma.client.findFirst({ where: { organizationId, clientCode, deletedAt: null } });
  },
  async create(data) {
    return prisma.client.create({
      data: {
        organizationId: data.organizationId,
        clientCode: data.clientCode,
        name: data.name,
        legalName: data.legalName,
        status: data.status ?? "PROSPECT",
        email: data.email,
        phone: data.phone,
        website: data.website,
        address: data.address,
        accountManager: data.accountManager,
        notes: data.notes
      }
    });
  },
  async update(id, data) {
    return prisma.client.update({ where: { id }, data });
  },
  async softDelete(id) {
    await prisma.client.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  },
  async countByStatus(organizationId) {
    const rows = await prisma.client.groupBy({
      by: ["status"],
      where: { organizationId, deletedAt: null },
      _count: { _all: true }
    });
    const result = {};
    for (const row of rows) result[row.status] = row._count._all;
    return result;
  },
  async recentForOrg(organizationId, limit) {
    return prisma.client.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit
    });
  }
};

// server/services/leadService.ts
var TERMINAL_STATUSES = /* @__PURE__ */ new Set(["CONVERTED"]);
var NON_TERMINAL_STATUSES = /* @__PURE__ */ new Set(["NEW", "CONTACTED", "QUALIFIED", "LOST"]);
function assertValidTransition(current, next) {
  if (current === next) return;
  if (TERMINAL_STATUSES.has(current)) {
    throw new ConflictError("This lead has already been converted; its status can no longer be changed.");
  }
  if (!NON_TERMINAL_STATUSES.has(next)) {
    throw new ValidationError('Use POST /leads/:id/convert to mark a lead as converted \u2014 status cannot be set to "CONVERTED" directly.');
  }
}
async function loadLeadInOrgOrThrow(id, organizationId) {
  const lead = await leadRepository.findByIdInOrg(id, organizationId);
  if (!lead) throw new NotFoundError("Lead not found.");
  return lead;
}
function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const lastName = parts.slice(1).join(" ") || (parts[0] ?? fullName);
  return { firstName: parts[0] ?? fullName, lastName };
}
var leadService = {
  async listLeads(organizationId, filters, page, limit, sort, order) {
    return leadRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getLead(organizationId, id) {
    return loadLeadInOrgOrThrow(id, organizationId);
  },
  async createLead(caller, input, meta = {}) {
    const email = input.email || void 0;
    if (email) {
      const duplicates = await leadRepository.findByEmailInOrg(caller.organizationId, email);
      if (duplicates.length > 0) {
        throw new ConflictError("An open lead with this email already exists for this organization.", {
          existingLeadId: duplicates[0].id
        });
      }
    }
    const lead = await leadRepository.create({
      organizationId: caller.organizationId,
      companyName: input.companyName,
      contactName: input.contactName,
      email,
      phone: input.phone,
      source: input.source,
      status: input.status,
      notes: input.notes,
      assignedTo: input.assignedTo
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_CREATED",
      resourceType: "lead",
      resourceId: lead.id,
      afterData: { companyName: lead.companyName, status: lead.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return lead;
  },
  async updateLead(caller, id, input, meta = {}) {
    const existing = await loadLeadInOrgOrThrow(id, caller.organizationId);
    if (input.status !== void 0) {
      assertValidTransition(existing.status, input.status);
    } else if (TERMINAL_STATUSES.has(existing.status)) {
      throw new ConflictError("This lead has already been converted and can no longer be edited.");
    }
    const patch = {};
    if (input.companyName !== void 0) patch.companyName = input.companyName;
    if (input.contactName !== void 0) patch.contactName = input.contactName;
    if (input.email !== void 0) patch.email = input.email || null;
    if (input.phone !== void 0) patch.phone = input.phone;
    if (input.source !== void 0) patch.source = input.source;
    if (input.status !== void 0) patch.status = input.status;
    if (input.notes !== void 0) patch.notes = input.notes;
    if (input.assignedTo !== void 0) patch.assignedTo = input.assignedTo;
    const updated = await leadRepository.update(id, patch);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_UPDATED",
      resourceType: "lead",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async deleteLead(caller, id, meta = {}) {
    await loadLeadInOrgOrThrow(id, caller.organizationId);
    await leadRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_ARCHIVED",
      resourceType: "lead",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  /**
   * Transactional lead→client conversion (§15-17). Race-safe: the lead's
   * status flip uses a conditional `updateMany` (status != CONVERTED)
   * inside the transaction and checks the affected row count — a
   * concurrent duplicate conversion attempt affects 0 rows, throws, and
   * rolls back the whole transaction (including the client/contact rows
   * already created in it), rather than racing on a read-then-write.
   */
  async convertLead(caller, id, input, meta = {}) {
    const lead = await loadLeadInOrgOrThrow(id, caller.organizationId);
    if (lead.status === "CONVERTED") {
      throw new ConflictError("This lead has already been converted.", { convertedClientId: lead.convertedClientId });
    }
    const existingCode = await clientRepository.findByCodeInOrg(caller.organizationId, input.clientCode);
    if (existingCode) {
      throw new ConflictError(`A client with code "${input.clientCode}" already exists in this organization.`);
    }
    const result = await prisma.$transaction(async (tx) => {
      const client3 = await tx.client.create({
        data: {
          organizationId: caller.organizationId,
          clientCode: input.clientCode,
          name: input.name ?? lead.companyName,
          status: "ACTIVE",
          email: input.email ?? lead.email ?? void 0,
          phone: input.phone ?? lead.phone ?? void 0,
          website: input.website,
          address: input.address
        }
      });
      let contactId = null;
      if (input.createContact && lead.contactName) {
        const { firstName, lastName } = splitName(lead.contactName);
        const contact = await tx.contact.create({
          data: {
            organizationId: caller.organizationId,
            clientId: client3.id,
            firstName,
            lastName,
            email: lead.email ?? void 0,
            phone: lead.phone ?? void 0,
            isPrimary: true
          }
        });
        contactId = contact.id;
      }
      const conversion = await tx.lead.updateMany({
        where: { id, organizationId: caller.organizationId, status: { not: "CONVERTED" } },
        data: { status: "CONVERTED", convertedClientId: client3.id, convertedAt: /* @__PURE__ */ new Date() }
      });
      if (conversion.count !== 1) {
        throw new ConflictError("This lead has already been converted.");
      }
      return { client: client3, contactId };
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_CREATED",
      resourceType: "client",
      resourceId: result.client.id,
      afterData: { clientCode: result.client.clientCode, name: result.client.name, convertedFromLeadId: id },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "LEAD_CONVERTED",
      resourceType: "lead",
      resourceId: id,
      afterData: { clientId: result.client.id, clientCode: result.client.clientCode },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return result;
  },
  async dashboardCounts(organizationId) {
    return leadRepository.countByStatus(organizationId);
  },
  async recent(organizationId, limit) {
    return leadRepository.recentForOrg(organizationId, limit);
  }
};

// server/schemas/leadSchemas.ts
import { z as z7 } from "zod";
var leadStatusSchema = z7.enum(["NEW", "CONTACTED", "QUALIFIED", "LOST"]);
var listLeadsQuerySchema = z7.object({
  page: z7.coerce.number().int().positive().default(1),
  limit: z7.coerce.number().int().positive().max(100).default(20),
  search: z7.string().trim().max(200).optional(),
  status: z7.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"]).optional(),
  source: z7.string().trim().max(100).optional(),
  assignedTo: z7.string().trim().uuid().optional(),
  dateFrom: z7.coerce.date().optional(),
  dateTo: z7.coerce.date().optional(),
  sort: z7.enum(["createdAt", "updatedAt", "companyName", "status"]).default("createdAt"),
  order: z7.enum(["asc", "desc"]).default("desc")
});
var createLeadSchema = z7.object({
  companyName: z7.string().trim().min(1).max(200),
  contactName: z7.string().trim().max(200).optional(),
  email: z7.string().trim().email().max(255).optional().or(z7.literal("")),
  phone: z7.string().trim().max(50).optional(),
  source: z7.string().trim().max(100).optional(),
  status: leadStatusSchema.optional(),
  notes: z7.string().trim().max(5e3).optional(),
  assignedTo: z7.string().trim().uuid().optional()
});
var updateLeadSchema = z7.object({
  companyName: z7.string().trim().min(1).max(200).optional(),
  contactName: z7.string().trim().max(200).nullable().optional(),
  email: z7.string().trim().email().max(255).nullable().optional().or(z7.literal("")),
  phone: z7.string().trim().max(50).nullable().optional(),
  source: z7.string().trim().max(100).nullable().optional(),
  status: leadStatusSchema.optional(),
  notes: z7.string().trim().max(5e3).nullable().optional(),
  assignedTo: z7.string().trim().uuid().nullable().optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
var convertLeadSchema = z7.object({
  clientCode: z7.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, "clientCode may only contain letters, numbers, dots, hyphens, and underscores"),
  name: z7.string().trim().min(1).max(200).optional(),
  email: z7.string().trim().email().max(255).optional(),
  phone: z7.string().trim().max(50).optional(),
  website: z7.string().trim().max(255).optional(),
  address: z7.string().trim().max(500).optional(),
  createContact: z7.boolean().default(true)
});

// server/routes/v1/leadRoutes.ts
var router9 = Router9();
router9.use(authenticateToken);
function requestMeta2(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router9.get(
  "/",
  requirePermission("leads.read"),
  asyncHandler(async (req, res) => {
    const query = listLeadsQuerySchema.parse(req.query);
    const { rows, total } = await leadService.listLeads(
      req.user.organizationId,
      { search: query.search, status: query.status, source: query.source, assignedTo: query.assignedTo, dateFrom: query.dateFrom, dateTo: query.dateTo },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { leads: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router9.get(
  "/:id",
  requirePermission("leads.read"),
  asyncHandler(async (req, res) => {
    const lead = await leadService.getLead(req.user.organizationId, req.params.id);
    sendSuccess(res, { lead });
  })
);
router9.post(
  "/",
  requirePermission("leads.create"),
  asyncHandler(async (req, res) => {
    const input = createLeadSchema.parse(req.body);
    const lead = await leadService.createLead(req.user, input, requestMeta2(req));
    sendSuccess(res, { lead }, 201);
  })
);
router9.patch(
  "/:id",
  requirePermission("leads.update"),
  asyncHandler(async (req, res) => {
    const input = updateLeadSchema.parse(req.body);
    const lead = await leadService.updateLead(req.user, req.params.id, input, requestMeta2(req));
    sendSuccess(res, { lead });
  })
);
router9.delete(
  "/:id",
  requirePermission("leads.delete"),
  asyncHandler(async (req, res) => {
    await leadService.deleteLead(req.user, req.params.id, requestMeta2(req));
    sendSuccess(res, { message: "Lead archived." });
  })
);
router9.post(
  "/:id/convert",
  requirePermission("leads.convert"),
  asyncHandler(async (req, res) => {
    const input = convertLeadSchema.parse(req.body);
    const result = await leadService.convertLead(req.user, req.params.id, input, requestMeta2(req));
    sendSuccess(res, result, 201);
  })
);
var leadRoutes_default = router9;

// server/routes/v1/clientRoutes.ts
import { Router as Router10 } from "express";

// server/services/clientService.ts
async function loadClientInOrgOrThrow(id, organizationId) {
  const client3 = await clientRepository.findByIdInOrg(id, organizationId);
  if (!client3) throw new NotFoundError("Client not found.");
  return client3;
}
function computeProvisioningStatus(workspace) {
  if (!workspace) return "NOT_PROVISIONED";
  if (workspace.status === "ACTIVE") return "PROVISIONED";
  if (workspace.status === "TRIAL") return "PROVISIONING";
  return "SUSPENDED";
}
function withProvisioningStatus(client3) {
  return { ...client3, provisioningStatus: computeProvisioningStatus(client3.workspaceOrganization) };
}
var clientService = {
  async listClients(organizationId, filters, page, limit, sort, order) {
    const { rows, total } = await clientRepository.list(organizationId, filters, page, limit, sort, order);
    return { rows: rows.map(withProvisioningStatus), total };
  },
  async getClient(organizationId, id) {
    const client3 = await loadClientInOrgOrThrow(id, organizationId);
    return withProvisioningStatus(client3);
  },
  async createClient(caller, input, meta = {}) {
    const [byCode, byName] = await Promise.all([
      clientRepository.findByCodeInOrg(caller.organizationId, input.clientCode),
      clientRepository.findByNameInOrg(caller.organizationId, input.name)
    ]);
    if (byCode) throw new ConflictError(`A client with code "${input.clientCode}" already exists in this organization.`);
    if (byName) {
      throw new ConflictError(`A client named "${input.name}" already exists in this organization.`, { existingClientId: byName.id });
    }
    const client3 = await clientRepository.create({
      organizationId: caller.organizationId,
      clientCode: input.clientCode,
      name: input.name,
      legalName: input.legalName,
      status: input.status,
      email: input.email || void 0,
      phone: input.phone,
      website: input.website,
      address: input.address,
      accountManager: input.accountManager,
      notes: input.notes
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_CREATED",
      resourceType: "client",
      resourceId: client3.id,
      afterData: { clientCode: client3.clientCode, name: client3.name, status: client3.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return client3;
  },
  async updateClient(caller, id, input, meta = {}) {
    const existing = await loadClientInOrgOrThrow(id, caller.organizationId);
    if (input.name !== void 0 && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      const dup = await clientRepository.findByNameInOrg(caller.organizationId, input.name);
      if (dup && dup.id !== id) {
        throw new ConflictError(`A client named "${input.name}" already exists in this organization.`);
      }
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.legalName !== void 0) patch.legalName = input.legalName;
    if (input.status !== void 0) patch.status = input.status;
    if (input.email !== void 0) patch.email = input.email || null;
    if (input.phone !== void 0) patch.phone = input.phone;
    if (input.website !== void 0) patch.website = input.website;
    if (input.address !== void 0) patch.address = input.address;
    if (input.accountManager !== void 0) patch.accountManager = input.accountManager;
    if (input.notes !== void 0) patch.notes = input.notes;
    const updated = await clientRepository.update(id, patch);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_UPDATED",
      resourceType: "client",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async deleteClient(caller, id, meta = {}) {
    await loadClientInOrgOrThrow(id, caller.organizationId);
    await clientRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ARCHIVED",
      resourceType: "client",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  async dashboardCounts(organizationId) {
    return clientRepository.countByStatus(organizationId);
  },
  async recent(organizationId, limit) {
    return clientRepository.recentForOrg(organizationId, limit);
  }
};

// server/repositories/contactRepository.ts
var contactRepository = {
  /** Org-wide contact list (Phase 5 §22's top-level "Contacts" nav item) — still tenant-scoped, optionally further scoped to one client via `filters.clientId`. */
  async listForOrg(organizationId, filters, page, limit) {
    const where = { organizationId, deletedAt: null };
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.search) {
      const term = filters.search;
      where.OR = [
        { firstName: { contains: term, mode: "insensitive" } },
        { lastName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } }
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: { client: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.contact.count({ where })
    ]);
    return { rows, total };
  },
  async listForClient(clientId, organizationId, page, limit) {
    const where = { clientId, organizationId, deletedAt: null };
    const [rows, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.contact.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.contact.findFirst({ where: { id, organizationId, deletedAt: null } });
  },
  async findByEmailForClient(clientId, organizationId, email) {
    return prisma.contact.findFirst({
      where: { clientId, organizationId, deletedAt: null, email: { equals: email, mode: "insensitive" } }
    });
  },
  async create(data) {
    return prisma.contact.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        jobTitle: data.jobTitle,
        isPrimary: data.isPrimary ?? false
      }
    });
  },
  async update(id, data) {
    return prisma.contact.update({ where: { id }, data });
  },
  /** Unsets isPrimary on every OTHER contact for this client — called before setting a new primary, since the partial unique index (schema.prisma) allows at most one. */
  async clearPrimaryForClient(clientId, exceptContactId) {
    await prisma.contact.updateMany({
      where: { clientId, isPrimary: true, deletedAt: null, ...exceptContactId ? { id: { not: exceptContactId } } : {} },
      data: { isPrimary: false }
    });
  },
  async softDelete(id) {
    await prisma.contact.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  }
};

// server/services/contactService.ts
async function loadContactInOrgOrThrow(id, organizationId) {
  const contact = await contactRepository.findByIdInOrg(id, organizationId);
  if (!contact) throw new NotFoundError("Contact not found.");
  return contact;
}
async function assertClientInOrg(clientId, organizationId) {
  const client3 = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client3) throw new NotFoundError("Client not found.");
}
var contactService = {
  async listForOrg(organizationId, filters, page, limit) {
    if (filters.clientId) await assertClientInOrg(filters.clientId, organizationId);
    return contactRepository.listForOrg(organizationId, filters, page, limit);
  },
  async listForClient(organizationId, clientId, page, limit) {
    await assertClientInOrg(clientId, organizationId);
    return contactRepository.listForClient(clientId, organizationId, page, limit);
  },
  async getContact(organizationId, id) {
    return loadContactInOrgOrThrow(id, organizationId);
  },
  async createForClient(caller, clientId, input, meta = {}) {
    await assertClientInOrg(clientId, caller.organizationId);
    const email = input.email || void 0;
    if (email) {
      const dup = await contactRepository.findByEmailForClient(clientId, caller.organizationId, email);
      if (dup) throw new ConflictError("A contact with this email already exists for this client.");
    }
    const contact = await prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.contact.updateMany({ where: { clientId, isPrimary: true, deletedAt: null }, data: { isPrimary: false } });
      }
      return tx.contact.create({
        data: {
          organizationId: caller.organizationId,
          clientId,
          firstName: input.firstName,
          lastName: input.lastName,
          email,
          phone: input.phone,
          jobTitle: input.jobTitle,
          isPrimary: input.isPrimary ?? false
        }
      });
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTACT_CREATED",
      resourceType: "contact",
      resourceId: contact.id,
      afterData: { clientId, firstName: contact.firstName, lastName: contact.lastName },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return contact;
  },
  async updateContact(caller, id, input, meta = {}) {
    const existing = await loadContactInOrgOrThrow(id, caller.organizationId);
    if (input.email) {
      const dup = existing.clientId ? await contactRepository.findByEmailForClient(existing.clientId, caller.organizationId, input.email) : null;
      if (dup && dup.id !== id) throw new ConflictError("A contact with this email already exists for this client.");
    }
    const patch = {};
    if (input.firstName !== void 0) patch.firstName = input.firstName;
    if (input.lastName !== void 0) patch.lastName = input.lastName;
    if (input.email !== void 0) patch.email = input.email || null;
    if (input.phone !== void 0) patch.phone = input.phone;
    if (input.jobTitle !== void 0) patch.jobTitle = input.jobTitle;
    if (input.status !== void 0) patch.status = input.status;
    const updated = await prisma.$transaction(async (tx) => {
      if (input.isPrimary !== void 0) {
        if (input.isPrimary && existing.clientId) {
          await tx.contact.updateMany({
            where: { clientId: existing.clientId, isPrimary: true, deletedAt: null, id: { not: id } },
            data: { isPrimary: false }
          });
        }
        patch.isPrimary = input.isPrimary;
      }
      return tx.contact.update({ where: { id }, data: patch });
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTACT_UPDATED",
      resourceType: "contact",
      resourceId: id,
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async deleteContact(caller, id, meta = {}) {
    await loadContactInOrgOrThrow(id, caller.organizationId);
    await contactRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTACT_DELETED",
      resourceType: "contact",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/schemas/onboardingSchemas.ts
import { z as z8 } from "zod";
var ONBOARDING_CHECKLIST_KEYS = [
  "CLIENT_VERIFIED",
  "WORKSPACE_CREATED",
  "PRIMARY_CONTACT_CONFIRMED",
  "ADMINISTRATOR_INVITED",
  "ADMINISTRATOR_ACCEPTED",
  "WORKSPACE_CONFIGURED",
  "ONBOARDING_COMPLETED"
];
var listOnboardingQuerySchema = z8.object({
  page: z8.coerce.number().int().positive().default(1),
  limit: z8.coerce.number().int().positive().max(100).default(20),
  status: z8.enum(["NOT_STARTED", "IN_PROGRESS", "READY", "COMPLETED", "CANCELLED"]).optional(),
  search: z8.string().trim().max(200).optional()
});
var updateOnboardingSchema = z8.object({
  completeStep: z8.enum(ONBOARDING_CHECKLIST_KEYS).optional(),
  status: z8.enum(["CANCELLED"]).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/repositories/clientOnboardingRepository.ts
var STEP_LABELS = {
  CLIENT_VERIFIED: "Client verified",
  WORKSPACE_CREATED: "Workspace created",
  PRIMARY_CONTACT_CONFIRMED: "Primary contact confirmed",
  ADMINISTRATOR_INVITED: "Administrator invited",
  ADMINISTRATOR_ACCEPTED: "Administrator accepted",
  WORKSPACE_CONFIGURED: "Workspace configured",
  ONBOARDING_COMPLETED: "Onboarding completed"
};
function freshChecklist() {
  return ONBOARDING_CHECKLIST_KEYS.map((key) => ({
    key,
    label: STEP_LABELS[key],
    completed: false,
    completedAt: null,
    completedById: null
  }));
}
function nextIncompleteStep(checklist) {
  return checklist.find((item) => !item.completed)?.key ?? null;
}
function buildWhere3(organizationId, filters) {
  const where = { organizationId };
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    where.client = { name: { contains: filters.search, mode: "insensitive" } };
  }
  return where;
}
var clientOnboardingRepository = {
  async list(organizationId, filters, page, limit) {
    const where = buildWhere3(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.clientOnboarding.findMany({
        where,
        include: { client: { include: { workspaceOrganization: true } } },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.clientOnboarding.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.clientOnboarding.findFirst({
      where: { id, organizationId },
      include: { client: { include: { workspaceOrganization: true } } }
    });
  },
  async findByClientId(clientId) {
    return prisma.clientOnboarding.findUnique({ where: { clientId } });
  },
  async create(data) {
    return prisma.clientOnboarding.create({
      data: {
        organizationId: data.organizationId,
        clientId: data.clientId,
        createdById: data.createdById,
        status: "IN_PROGRESS",
        startedAt: /* @__PURE__ */ new Date(),
        checklist: freshChecklist(),
        currentStep: freshChecklist()[0].key
      }
    });
  },
  async update(id, data) {
    return prisma.clientOnboarding.update({ where: { id }, data });
  }
};

// server/services/onboardingService.ts
var TERMINAL_STATUSES2 = /* @__PURE__ */ new Set(["COMPLETED", "CANCELLED"]);
async function loadClientInOrgOrThrow2(clientId, organizationId) {
  const client3 = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client3) throw new NotFoundError("Client not found.");
  return client3;
}
async function loadOnboardingInOrgOrThrow(id, organizationId) {
  const record = await clientOnboardingRepository.findByIdInOrg(id, organizationId);
  if (!record) throw new NotFoundError("Onboarding record not found.");
  return record;
}
var onboardingService = {
  async listOnboarding(organizationId, filters, page, limit) {
    return clientOnboardingRepository.list(organizationId, filters, page, limit);
  },
  async getOnboarding(organizationId, id) {
    return loadOnboardingInOrgOrThrow(id, organizationId);
  },
  async getOnboardingForClient(organizationId, clientId) {
    await loadClientInOrgOrThrow2(clientId, organizationId);
    return clientOnboardingRepository.findByClientId(clientId);
  },
  async startOnboarding(caller, clientId, meta = {}) {
    await loadClientInOrgOrThrow2(clientId, caller.organizationId);
    const existing = await clientOnboardingRepository.findByClientId(clientId);
    if (existing) {
      throw new ConflictError("Onboarding has already been started for this client.", { onboardingId: existing.id });
    }
    const record = await clientOnboardingRepository.create({
      organizationId: caller.organizationId,
      clientId,
      createdById: caller.id
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ONBOARDING_STARTED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { clientId, status: record.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return record;
  },
  async updateOnboarding(caller, id, input, meta = {}) {
    const existing = await loadOnboardingInOrgOrThrow(id, caller.organizationId);
    if (TERMINAL_STATUSES2.has(existing.status)) {
      throw new ConflictError(`This onboarding is already ${existing.status.toLowerCase()} and can no longer be changed.`);
    }
    if (input.status === "CANCELLED") {
      const updated = await clientOnboardingRepository.update(id, { status: "CANCELLED", cancelledAt: /* @__PURE__ */ new Date() });
      await auditLogRepository.record({
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "CLIENT_ONBOARDING_CANCELLED",
        resourceType: "client_onboarding",
        resourceId: id,
        beforeData: { status: existing.status },
        afterData: { status: "CANCELLED" },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
      return updated;
    }
    if (input.completeStep) {
      return this.completeStep(caller, id, input.completeStep, meta);
    }
    return existing;
  },
  /**
   * Marks one checklist step complete (idempotent — re-completing an
   * already-complete step is a no-op, not an error, since both manual PATCH
   * calls and automatic calls from workspaceService/invitationService can
   * race to mark the same step). Advances currentStep; flips status to
   * READY once every step is done — completion itself is a separate,
   * explicit action (completeOnboarding), never inferred (§7).
   */
  async completeStep(caller, onboardingId, step, meta = {}) {
    const record = await loadOnboardingInOrgOrThrow(onboardingId, caller.organizationId);
    if (TERMINAL_STATUSES2.has(record.status)) return record;
    const checklist = record.checklist ?? freshChecklist();
    const item = checklist.find((c) => c.key === step);
    if (!item) throw new ValidationError(`Unknown onboarding step: ${step}`);
    if (item.completed) return record;
    item.completed = true;
    item.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    item.completedById = caller.id;
    const next = nextIncompleteStep(checklist);
    const updated = await clientOnboardingRepository.update(record.id, {
      checklist,
      currentStep: next,
      status: next === null ? "READY" : record.status
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "ONBOARDING_STEP_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { step, status: updated.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  /** Marks a step complete by clientId — used by workspaceService/invitationService, which know the client, not the onboarding record id. Silently no-ops if onboarding was never started for this client (starting onboarding is optional before provisioning). */
  async completeStepForClient(clientId, step, actorUserId) {
    const record = await clientOnboardingRepository.findByClientId(clientId);
    if (!record) return;
    const checklist = record.checklist ?? freshChecklist();
    const item = checklist.find((c) => c.key === step);
    if (!item || item.completed) return;
    item.completed = true;
    item.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    item.completedById = actorUserId ?? null;
    const next = nextIncompleteStep(checklist);
    await clientOnboardingRepository.update(record.id, {
      checklist,
      currentStep: next,
      status: next === null ? "READY" : record.status
    });
    await auditLogRepository.record({
      organizationId: record.organizationId,
      actorUserId,
      actorType: actorUserId ? "USER" : "SYSTEM",
      action: "ONBOARDING_STEP_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: record.id,
      afterData: { step }
    });
  },
  async completeOnboarding(caller, id, meta = {}) {
    const existing = await loadOnboardingInOrgOrThrow(id, caller.organizationId);
    if (existing.status === "COMPLETED") {
      throw new ConflictError("This onboarding has already been completed.");
    }
    if (existing.status !== "READY") {
      throw new ValidationError("Complete every checklist step before finishing onboarding.");
    }
    const updated = await clientOnboardingRepository.update(id, {
      status: "COMPLETED",
      completedAt: /* @__PURE__ */ new Date(),
      completedBy: { connect: { id: caller.id } }
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ONBOARDING_COMPLETED",
      resourceType: "client_onboarding",
      resourceId: id,
      afterData: { status: "COMPLETED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  }
};

// server/repositories/workspaceRepository.ts
function slugify2(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}
function buildWhere4(ownerOrganizationId, filters) {
  const where = {
    provisionedForClient: { organizationId: ownerOrganizationId }
  };
  if (filters.status) where.status = filters.status;
  if (filters.search) where.name = { contains: filters.search, mode: "insensitive" };
  return where;
}
var workspaceRepository = {
  async list(ownerOrganizationId, filters, page, limit) {
    const where = buildWhere4(ownerOrganizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        include: { provisionedForClient: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.organization.count({ where })
    ]);
    return { rows, total };
  },
  /** The single ownership-scoped lookup method — a workspace id belonging to another tenant's CRM is invisible, not just filtered client-side. */
  async findByIdForOwner(id, ownerOrganizationId) {
    return prisma.organization.findFirst({
      where: { id, provisionedForClient: { organizationId: ownerOrganizationId } },
      include: { provisionedForClient: true }
    });
  },
  async findUniqueSlug(baseName) {
    const baseSlug = slugify2(baseName) || "workspace";
    let slug = baseSlug;
    let attempt = 1;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async update(id, data) {
    return prisma.organization.update({ where: { id }, data });
  },
  async countMembers(organizationId) {
    return prisma.organizationMembership.count({ where: { organizationId } });
  }
};

// server/services/workspaceService.ts
import { Prisma as Prisma2 } from "@prisma/client";
var SENSITIVE_STATUSES = /* @__PURE__ */ new Set(["SUSPENDED", "ARCHIVED"]);
var ALLOWED_TRANSITIONS = {
  TRIAL: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: []
};
function assertValidWorkspaceTransition(current, next) {
  if (current === next) return;
  if (!ALLOWED_TRANSITIONS[current]?.includes(next)) {
    throw new ConflictError(`Workspace cannot move from ${current} to ${next}.`);
  }
}
async function loadClientInOrgOrThrow3(clientId, organizationId) {
  const client3 = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client3) throw new NotFoundError("Client not found.");
  return client3;
}
async function loadWorkspaceForOwnerOrThrow(id, ownerOrganizationId) {
  const workspace = await workspaceRepository.findByIdForOwner(id, ownerOrganizationId);
  if (!workspace) throw new NotFoundError("Workspace not found.");
  return workspace;
}
var workspaceService = {
  async listWorkspaces(ownerOrganizationId, filters, page, limit) {
    return workspaceRepository.list(ownerOrganizationId, filters, page, limit);
  },
  async getWorkspace(ownerOrganizationId, id) {
    return loadWorkspaceForOwnerOrThrow(id, ownerOrganizationId);
  },
  /**
   * The core transactional provisioning operation (§13). Idempotency/
   * concurrency (§14/§15): if the client is already provisioned, this
   * throws a 409 rather than creating a second workspace; a conditional
   * `updateMany` inside the transaction (mirroring leadService.convertLead)
   * guards against two concurrent provisioning requests for the same
   * client both succeeding — the loser's transaction rolls back entirely,
   * including the Organization row it just created.
   */
  async provisionWorkspace(caller, clientId, input, meta = {}) {
    const client3 = await loadClientInOrgOrThrow3(clientId, caller.organizationId);
    if (client3.workspaceOrganizationId) {
      throw new ConflictError("This client has already been provisioned into a workspace.", {
        workspaceOrganizationId: client3.workspaceOrganizationId
      });
    }
    const name = input.name?.trim() || client3.name;
    const slug = await workspaceRepository.findUniqueSlug(name);
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const workspace = await tx.organization.create({
          data: {
            name,
            slug,
            type: "CLIENT",
            tier: "GROWTH",
            status: "TRIAL",
            // PENDING — see module doc comment
            timezone: input.timezone ?? "UTC",
            currency: input.currency ?? "USD",
            locale: input.locale ?? "en"
          }
        });
        const linked = await tx.client.updateMany({
          where: { id: clientId, organizationId: caller.organizationId, workspaceOrganizationId: null },
          data: { workspaceOrganizationId: workspace.id }
        });
        if (linked.count !== 1) {
          throw new ConflictError("This client has already been provisioned into a workspace.");
        }
        let onboarding = await tx.clientOnboarding.findUnique({ where: { clientId } });
        if (!onboarding) {
          onboarding = await tx.clientOnboarding.create({
            data: {
              organizationId: caller.organizationId,
              clientId,
              createdById: caller.id,
              status: "IN_PROGRESS",
              startedAt: /* @__PURE__ */ new Date(),
              checklist: freshChecklist(),
              currentStep: "CLIENT_VERIFIED"
            }
          });
        }
        return { workspace, onboardingStarted: !!onboarding };
      });
    } catch (err) {
      if (err instanceof Prisma2.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError("This client has already been provisioned into a workspace.");
      }
      throw err;
    }
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "WORKSPACE_PROVISIONED",
      resourceType: "organization",
      resourceId: result.workspace.id,
      afterData: { clientId, name: result.workspace.name, status: result.workspace.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    await onboardingService.completeStepForClient(clientId, "WORKSPACE_CREATED", caller.id);
    return result.workspace;
  },
  async updateWorkspace(caller, id, input, callerPermissions, meta = {}) {
    const existing = await loadWorkspaceForOwnerOrThrow(id, caller.organizationId);
    if (input.status !== void 0) {
      assertValidWorkspaceTransition(existing.status, input.status);
      if (SENSITIVE_STATUSES.has(input.status) && !callerPermissions.includes("workspaces.suspend") && caller.role.key !== "SUPER_ADMIN") {
        throw new AuthorizationError('Permission denied. Required privilege: "workspaces.suspend"');
      }
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.email !== void 0) patch.email = input.email || null;
    if (input.phone !== void 0) patch.phone = input.phone;
    if (input.website !== void 0) patch.website = input.website;
    if (input.address !== void 0) patch.address = input.address;
    if (input.timezone !== void 0) patch.timezone = input.timezone;
    if (input.currency !== void 0) patch.currency = input.currency;
    if (input.locale !== void 0) patch.locale = input.locale;
    if (input.status !== void 0) patch.status = input.status;
    const updated = await workspaceRepository.update(id, patch);
    const action = input.status === "SUSPENDED" ? "WORKSPACE_SUSPENDED" : input.status === "ARCHIVED" ? "WORKSPACE_DEACTIVATED" : "WORKSPACE_UPDATED";
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action,
      resourceType: "organization",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    if (input.name !== void 0 || Object.keys(patch).some((k) => ["timezone", "currency", "locale", "email", "phone", "address"].includes(k))) {
      await onboardingService.completeStepForClient(existing.provisionedForClient.id, "WORKSPACE_CONFIGURED", caller.id);
    }
    return updated;
  },
  async listMembers(caller, workspaceId, page, limit) {
    await loadWorkspaceForOwnerOrThrow(workspaceId, caller.organizationId);
    return organizationMembershipRepository.listForOrganization(workspaceId, page, limit);
  }
};

// server/schemas/clientSchemas.ts
import { z as z9 } from "zod";
var clientStatusSchema = z9.enum(["PROSPECT", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]);
var listClientsQuerySchema = z9.object({
  page: z9.coerce.number().int().positive().default(1),
  limit: z9.coerce.number().int().positive().max(100).default(20),
  search: z9.string().trim().max(200).optional(),
  status: clientStatusSchema.optional(),
  sort: z9.enum(["createdAt", "updatedAt", "name", "status"]).default("createdAt"),
  order: z9.enum(["asc", "desc"]).default("desc")
});
var createClientSchema = z9.object({
  clientCode: z9.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, "clientCode may only contain letters, numbers, dots, hyphens, and underscores"),
  name: z9.string().trim().min(1).max(200),
  legalName: z9.string().trim().max(200).optional(),
  status: clientStatusSchema.optional(),
  email: z9.string().trim().email().max(255).optional().or(z9.literal("")),
  phone: z9.string().trim().max(50).optional(),
  website: z9.string().trim().max(255).optional(),
  address: z9.string().trim().max(500).optional(),
  accountManager: z9.string().trim().uuid().optional(),
  notes: z9.string().trim().max(5e3).optional()
});
var updateClientSchema = z9.object({
  name: z9.string().trim().min(1).max(200).optional(),
  legalName: z9.string().trim().max(200).nullable().optional(),
  status: clientStatusSchema.optional(),
  email: z9.string().trim().email().max(255).nullable().optional().or(z9.literal("")),
  phone: z9.string().trim().max(50).nullable().optional(),
  website: z9.string().trim().max(255).nullable().optional(),
  address: z9.string().trim().max(500).nullable().optional(),
  accountManager: z9.string().trim().uuid().nullable().optional(),
  notes: z9.string().trim().max(5e3).nullable().optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/schemas/contactSchemas.ts
import { z as z10 } from "zod";
var listContactsQuerySchema = z10.object({
  page: z10.coerce.number().int().positive().default(1),
  limit: z10.coerce.number().int().positive().max(100).default(20)
});
var listAllContactsQuerySchema = z10.object({
  page: z10.coerce.number().int().positive().default(1),
  limit: z10.coerce.number().int().positive().max(100).default(20),
  search: z10.string().trim().max(200).optional(),
  clientId: z10.string().trim().uuid().optional()
});
var createContactSchema = z10.object({
  firstName: z10.string().trim().min(1).max(100),
  lastName: z10.string().trim().min(1).max(100),
  email: z10.string().trim().email().max(255).optional().or(z10.literal("")),
  phone: z10.string().trim().max(50).optional(),
  jobTitle: z10.string().trim().max(150).optional(),
  isPrimary: z10.boolean().optional()
});
var updateContactSchema = z10.object({
  firstName: z10.string().trim().min(1).max(100).optional(),
  lastName: z10.string().trim().min(1).max(100).optional(),
  email: z10.string().trim().email().max(255).nullable().optional().or(z10.literal("")),
  phone: z10.string().trim().max(50).nullable().optional(),
  jobTitle: z10.string().trim().max(150).nullable().optional(),
  isPrimary: z10.boolean().optional(),
  status: z10.enum(["ACTIVE", "INACTIVE"]).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/schemas/workspaceSchemas.ts
import { z as z11 } from "zod";
var workspaceStatusSchema = z11.enum(["TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"]);
var listWorkspacesQuerySchema = z11.object({
  page: z11.coerce.number().int().positive().default(1),
  limit: z11.coerce.number().int().positive().max(100).default(20),
  status: workspaceStatusSchema.optional(),
  search: z11.string().trim().max(200).optional()
});
var provisionWorkspaceSchema = z11.object({
  name: z11.string().trim().min(1).max(200).optional(),
  timezone: z11.string().trim().min(1).max(100).optional(),
  currency: z11.string().trim().length(3).regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code").optional(),
  locale: z11.string().trim().min(2).max(20).optional()
});
var updateWorkspaceSchema = z11.object({
  name: z11.string().trim().min(1).max(200).optional(),
  email: z11.string().trim().email().max(255).nullable().optional().or(z11.literal("")),
  phone: z11.string().trim().max(50).nullable().optional(),
  website: z11.string().trim().max(255).nullable().optional(),
  address: z11.string().trim().max(500).nullable().optional(),
  timezone: z11.string().trim().min(1).max(100).optional(),
  currency: z11.string().trim().length(3).regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code").optional(),
  locale: z11.string().trim().min(2).max(20).optional(),
  status: workspaceStatusSchema.optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/routes/v1/clientRoutes.ts
var router10 = Router10();
router10.use(authenticateToken);
function requestMeta3(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router10.get(
  "/",
  requirePermission("clients.read"),
  asyncHandler(async (req, res) => {
    const query = listClientsQuerySchema.parse(req.query);
    const { rows, total } = await clientService.listClients(
      req.user.organizationId,
      { search: query.search, status: query.status },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { clients: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router10.get(
  "/:id",
  requirePermission("clients.read"),
  asyncHandler(async (req, res) => {
    const client3 = await clientService.getClient(req.user.organizationId, req.params.id);
    sendSuccess(res, { client: client3 });
  })
);
router10.post(
  "/",
  requirePermission("clients.create"),
  asyncHandler(async (req, res) => {
    const input = createClientSchema.parse(req.body);
    const client3 = await clientService.createClient(req.user, input, requestMeta3(req));
    sendSuccess(res, { client: client3 }, 201);
  })
);
router10.patch(
  "/:id",
  requirePermission("clients.update"),
  asyncHandler(async (req, res) => {
    const input = updateClientSchema.parse(req.body);
    const client3 = await clientService.updateClient(req.user, req.params.id, input, requestMeta3(req));
    sendSuccess(res, { client: client3 });
  })
);
router10.delete(
  "/:id",
  requirePermission("clients.delete"),
  asyncHandler(async (req, res) => {
    await clientService.deleteClient(req.user, req.params.id, requestMeta3(req));
    sendSuccess(res, { message: "Client archived." });
  })
);
router10.get(
  "/:clientId/contacts",
  requirePermission("contacts.read"),
  asyncHandler(async (req, res) => {
    const query = listContactsQuerySchema.parse(req.query);
    const { rows, total } = await contactService.listForClient(req.user.organizationId, req.params.clientId, query.page, query.limit);
    sendSuccess(res, { contacts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router10.post(
  "/:clientId/contacts",
  requirePermission("contacts.create"),
  asyncHandler(async (req, res) => {
    const input = createContactSchema.parse(req.body);
    const contact = await contactService.createForClient(req.user, req.params.clientId, input, requestMeta3(req));
    sendSuccess(res, { contact }, 201);
  })
);
router10.post(
  "/:clientId/onboarding/start",
  requirePermission("onboarding.create"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.startOnboarding(req.user, req.params.clientId, requestMeta3(req));
    sendSuccess(res, { onboarding: record }, 201);
  })
);
router10.get(
  "/:clientId/onboarding",
  requirePermission("onboarding.read"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.getOnboardingForClient(req.user.organizationId, req.params.clientId);
    sendSuccess(res, { onboarding: record });
  })
);
router10.post(
  "/:clientId/workspace/provision",
  requirePermission("workspaces.create"),
  asyncHandler(async (req, res) => {
    const input = provisionWorkspaceSchema.parse(req.body);
    const workspace = await workspaceService.provisionWorkspace(req.user, req.params.clientId, input, requestMeta3(req));
    sendSuccess(res, { workspace }, 201);
  })
);
var clientRoutes_default = router10;

// server/routes/v1/contactRoutes.ts
import { Router as Router11 } from "express";
var router11 = Router11();
router11.use(authenticateToken);
function requestMeta4(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router11.get(
  "/",
  requirePermission("contacts.read"),
  asyncHandler(async (req, res) => {
    const query = listAllContactsQuerySchema.parse(req.query);
    const { rows, total } = await contactService.listForOrg(
      req.user.organizationId,
      { search: query.search, clientId: query.clientId },
      query.page,
      query.limit
    );
    sendSuccess(res, { contacts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router11.get(
  "/:id",
  requirePermission("contacts.read"),
  asyncHandler(async (req, res) => {
    const contact = await contactService.getContact(req.user.organizationId, req.params.id);
    sendSuccess(res, { contact });
  })
);
router11.patch(
  "/:id",
  requirePermission("contacts.update"),
  asyncHandler(async (req, res) => {
    const input = updateContactSchema.parse(req.body);
    const contact = await contactService.updateContact(req.user, req.params.id, input, requestMeta4(req));
    sendSuccess(res, { contact });
  })
);
router11.delete(
  "/:id",
  requirePermission("contacts.delete"),
  asyncHandler(async (req, res) => {
    await contactService.deleteContact(req.user, req.params.id, requestMeta4(req));
    sendSuccess(res, { message: "Contact removed." });
  })
);
var contactRoutes_default = router11;

// server/routes/v1/crmRoutes.ts
import { Router as Router12 } from "express";
var router12 = Router12();
router12.use(authenticateToken);
router12.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const permissions = req.user.role.permissions;
    const organizationId = req.user.organizationId;
    const [leadCounts, leadRecent, clientCounts, clientRecent] = await Promise.all([
      permissions.includes("leads.read") ? leadService.dashboardCounts(organizationId) : Promise.resolve(null),
      permissions.includes("leads.read") ? leadService.recent(organizationId, 5) : Promise.resolve([]),
      permissions.includes("clients.read") ? clientService.dashboardCounts(organizationId) : Promise.resolve(null),
      permissions.includes("clients.read") ? clientService.recent(organizationId, 5) : Promise.resolve([])
    ]);
    sendSuccess(res, {
      leads: leadCounts && {
        total: Object.values(leadCounts).reduce((a, b) => a + b, 0),
        new: leadCounts.NEW ?? 0,
        contacted: leadCounts.CONTACTED ?? 0,
        qualified: leadCounts.QUALIFIED ?? 0,
        converted: leadCounts.CONVERTED ?? 0,
        lost: leadCounts.LOST ?? 0,
        recent: leadRecent
      },
      clients: clientCounts && {
        total: Object.values(clientCounts).reduce((a, b) => a + b, 0),
        prospect: clientCounts.PROSPECT ?? 0,
        active: clientCounts.ACTIVE ?? 0,
        inactive: clientCounts.INACTIVE ?? 0,
        suspended: clientCounts.SUSPENDED ?? 0,
        archived: clientCounts.ARCHIVED ?? 0,
        recent: clientRecent
      }
    });
  })
);
var crmRoutes_default = router12;

// server/routes/v1/onboardingRoutes.ts
import { Router as Router13 } from "express";
var router13 = Router13();
router13.use(authenticateToken);
function requestMeta5(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router13.get(
  "/",
  requirePermission("onboarding.read"),
  asyncHandler(async (req, res) => {
    const query = listOnboardingQuerySchema.parse(req.query);
    const { rows, total } = await onboardingService.listOnboarding(
      req.user.organizationId,
      { status: query.status, search: query.search },
      query.page,
      query.limit
    );
    sendSuccess(res, { onboarding: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router13.get(
  "/:id",
  requirePermission("onboarding.read"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.getOnboarding(req.user.organizationId, req.params.id);
    sendSuccess(res, { onboarding: record });
  })
);
router13.patch(
  "/:id",
  requirePermission("onboarding.update"),
  asyncHandler(async (req, res) => {
    const input = updateOnboardingSchema.parse(req.body);
    const record = await onboardingService.updateOnboarding(req.user, req.params.id, input, requestMeta5(req));
    sendSuccess(res, { onboarding: record });
  })
);
router13.post(
  "/:id/complete",
  requirePermission("onboarding.complete"),
  asyncHandler(async (req, res) => {
    const record = await onboardingService.completeOnboarding(req.user, req.params.id, requestMeta5(req));
    sendSuccess(res, { onboarding: record });
  })
);
var onboardingRoutes_default = router13;

// server/routes/v1/workspaceRoutes.ts
import { Router as Router14 } from "express";

// server/repositories/workspaceInvitationRepository.ts
var workspaceInvitationRepository = {
  async create(data) {
    return prisma.workspaceInvitation.create({
      data: {
        organizationId: data.organizationId,
        email: data.email.trim().toLowerCase(),
        roleId: data.roleId,
        tokenHash: hashToken(data.token),
        expiresAt: data.expiresAt,
        invitedById: data.invitedById
      }
    });
  },
  /** Invalidates any prior outstanding invitation for the same (organization, email) — at most one usable credential at a time, mirroring passwordResetRepository.invalidateAllForUser. */
  async revokePendingForEmail(organizationId, email) {
    await prisma.workspaceInvitation.updateMany({
      where: { organizationId, email: email.trim().toLowerCase(), acceptedAt: null, revokedAt: null },
      data: { revokedAt: /* @__PURE__ */ new Date() }
    });
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.workspaceInvitation.findFirst({ where: { id, organizationId } });
  },
  /** No organization filter — callers must separately verify the invitation's workspace (organizationId) belongs to their tenant via workspaceRepository.findByIdForOwner, since an invitation's own organizationId IS the workspace id, not the caller's CRM-owning org. */
  async findById(id) {
    return prisma.workspaceInvitation.findUnique({ where: { id } });
  },
  async findByToken(token) {
    return prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { organization: true, role: true }
    });
  },
  async list(organizationId, page, limit) {
    const where = { organizationId };
    const [rows, total] = await Promise.all([
      prisma.workspaceInvitation.findMany({
        where,
        include: {
          role: { select: { key: true, name: true } },
          invitedBy: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.workspaceInvitation.count({ where })
    ]);
    return { rows, total };
  },
  async revoke(id) {
    await prisma.workspaceInvitation.update({ where: { id }, data: { revokedAt: /* @__PURE__ */ new Date() } });
  }
};

// server/services/invitationService.ts
import { Prisma as Prisma3 } from "@prisma/client";
var CLIENT_ADMIN_ROLE_KEY = "ADMIN";
function computeInvitationStatus(invite) {
  if (invite.acceptedAt) return "ACCEPTED";
  if (invite.revokedAt) return "REVOKED";
  if (invite.expiresAt.getTime() <= Date.now()) return "EXPIRED";
  return "PENDING";
}
async function loadWorkspaceForOwnerOrThrow2(workspaceId, ownerOrganizationId) {
  const workspace = await workspaceRepository.findByIdForOwner(workspaceId, ownerOrganizationId);
  if (!workspace) throw new NotFoundError("Workspace not found.");
  return workspace;
}
var invitationService = {
  async listInvitations(caller, workspaceId, page, limit) {
    await loadWorkspaceForOwnerOrThrow2(workspaceId, caller.organizationId);
    const { rows, total } = await workspaceInvitationRepository.list(workspaceId, page, limit);
    return {
      rows: rows.map((r) => {
        const { tokenHash: _tokenHash, ...safe } = r;
        return { ...safe, status: computeInvitationStatus(r) };
      }),
      total
    };
  },
  async createInvitation(caller, workspaceId, input, meta = {}) {
    const workspace = await loadWorkspaceForOwnerOrThrow2(workspaceId, caller.organizationId);
    const adminRole = await roleRepository.findByKey(CLIENT_ADMIN_ROLE_KEY);
    if (!adminRole) throw new InternalError("Required role configuration is missing.");
    const email = input.email.trim().toLowerCase();
    const token = generateInvitationToken();
    const expiresAt = new Date(Date.now() + config.invitationTokenTtlHours * 60 * 60 * 1e3);
    const invitation = await prisma.$transaction(async (tx) => {
      await tx.workspaceInvitation.updateMany({
        where: { organizationId: workspace.id, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: /* @__PURE__ */ new Date() }
      });
      return tx.workspaceInvitation.create({
        data: {
          organizationId: workspace.id,
          email,
          roleId: adminRole.id,
          tokenHash: hashToken(token),
          expiresAt,
          invitedById: caller.id
        }
      });
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ADMIN_INVITED",
      resourceType: "workspace_invitation",
      resourceId: invitation.id,
      afterData: { workspaceId: workspace.id, email, roleKey: CLIENT_ADMIN_ROLE_KEY },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    if (workspace.provisionedForClient) {
      await onboardingService.completeStepForClient(workspace.provisionedForClient.id, "ADMINISTRATOR_INVITED", caller.id);
    }
    return { invitation, devToken: config.isProduction ? void 0 : token };
  },
  async revokeInvitation(caller, invitationId, meta = {}) {
    const invitation = await workspaceInvitationRepository.findById(invitationId);
    const workspace = invitation ? await workspaceRepository.findByIdForOwner(invitation.organizationId, caller.organizationId) : null;
    if (!invitation || !workspace) throw new NotFoundError("Invitation not found.");
    const status = computeInvitationStatus(invitation);
    if (status !== "PENDING") {
      throw new ConflictError(`This invitation is already ${status.toLowerCase()} and cannot be revoked.`);
    }
    await workspaceInvitationRepository.revoke(invitationId);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CLIENT_ADMIN_INVITATION_REVOKED",
      resourceType: "workspace_invitation",
      resourceId: invitationId,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  },
  /** Public, unauthenticated lookup for the acceptance page (§26) — returns only what's needed to render a safe form, never the token hash or workspace internals. */
  async previewInvitation(token) {
    const invitation = await workspaceInvitationRepository.findByToken(token);
    if (!invitation || computeInvitationStatus(invitation) !== "PENDING") {
      throw new NotFoundError("This invitation link is invalid or has expired.");
    }
    const existingUser = await userRepository.findByEmail(invitation.email);
    return {
      email: invitation.email,
      workspaceName: invitation.organization.name,
      roleName: invitation.role.name,
      expiresAt: invitation.expiresAt,
      requiresPassword: !existingUser
    };
  },
  /** Transactional acceptance (§21) — race-safe against double-acceptance via a conditional updateMany, same TOCTOU-guard pattern as leadService.convertLead. */
  async acceptInvitation(token, input, meta = {}) {
    const invitation = await workspaceInvitationRepository.findByToken(token);
    if (!invitation || computeInvitationStatus(invitation) !== "PENDING") {
      throw new AuthenticationError("This invitation link is invalid or has expired.");
    }
    const existingUser = await userRepository.findByEmail(invitation.email);
    if (!existingUser && !input.password) {
      throw new ValidationError("A password is required to create your account.");
    }
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        let user = existingUser;
        if (!user) {
          const passwordHash = await hashPassword(input.password);
          user = await tx.user.create({
            data: {
              organizationId: invitation.organizationId,
              email: invitation.email,
              passwordHash,
              firstName: input.firstName?.trim() || "Workspace",
              lastName: input.lastName?.trim() || "Administrator",
              displayName: `${input.firstName?.trim() || "Workspace"} ${input.lastName?.trim() || "Administrator"}`.trim(),
              title: "Workspace Administrator",
              roleId: invitation.roleId
            }
          });
        }
        const existingMembership = await tx.organizationMembership.findUnique({
          where: { userId_organizationId: { userId: user.id, organizationId: invitation.organizationId } }
        });
        if (!existingMembership) {
          await tx.organizationMembership.create({
            data: {
              userId: user.id,
              organizationId: invitation.organizationId,
              roleId: invitation.roleId,
              status: "ACTIVE",
              isPrimary: !existingUser
            }
          });
        }
        const accepted = await tx.workspaceInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: /* @__PURE__ */ new Date(), acceptedUserId: user.id }
        });
        if (accepted.count !== 1) {
          throw new ConflictError("This invitation has already been accepted.");
        }
        return user;
      });
    } catch (err) {
      if (err instanceof Prisma3.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictError("This invitation has already been accepted.");
      }
      throw err;
    }
    if (!result) throw new InternalError("Invitation acceptance did not resolve a user.");
    const sessionToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1e3);
    await sessionRepository.create({
      token: sessionToken,
      userId: result.id,
      organizationId: invitation.organizationId,
      expiresAt,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    const role = await roleRepository.resolveById(invitation.roleId);
    if (!role) throw new InternalError("Role could not be resolved.");
    const sanitized = sanitizeUser({ ...result, organizationId: invitation.organizationId }, role);
    await auditLogRepository.record({
      organizationId: invitation.organizationId,
      actorUserId: result.id,
      actorType: "USER",
      action: "CLIENT_ADMIN_ACCEPTED",
      resourceType: "workspace_invitation",
      resourceId: invitation.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    const client3 = await prisma.client.findUnique({ where: { workspaceOrganizationId: invitation.organizationId } });
    if (client3) {
      await onboardingService.completeStepForClient(client3.id, "ADMINISTRATOR_ACCEPTED", result.id);
    }
    return { session: { token: sessionToken, expiresAt }, user: sanitized };
  }
};

// server/schemas/invitationSchemas.ts
import { z as z12 } from "zod";
var createInvitationSchema = z12.object({
  email: z12.string().trim().min(1).email()
});
var listInvitationsQuerySchema = z12.object({
  page: z12.coerce.number().int().positive().default(1),
  limit: z12.coerce.number().int().positive().max(100).default(20)
});
var newPasswordSchema3 = z12.string().superRefine((password, ctx) => {
  const issue = validatePasswordPolicy(password);
  if (issue) ctx.addIssue({ code: z12.ZodIssueCode.custom, message: issue });
});
var acceptInvitationSchema = z12.object({
  firstName: z12.string().trim().min(1).max(100).optional(),
  lastName: z12.string().trim().min(1).max(100).optional(),
  password: newPasswordSchema3.optional()
});

// server/routes/v1/workspaceRoutes.ts
var router14 = Router14();
router14.use(authenticateToken);
function requestMeta6(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router14.get(
  "/",
  requirePermission("workspaces.read"),
  asyncHandler(async (req, res) => {
    const query = listWorkspacesQuerySchema.parse(req.query);
    const { rows, total } = await workspaceService.listWorkspaces(
      req.user.organizationId,
      { status: query.status, search: query.search },
      query.page,
      query.limit
    );
    sendSuccess(res, { workspaces: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router14.get(
  "/:id",
  requirePermission("workspaces.read"),
  asyncHandler(async (req, res) => {
    const workspace = await workspaceService.getWorkspace(req.user.organizationId, req.params.id);
    sendSuccess(res, { workspace });
  })
);
router14.patch(
  "/:id",
  requirePermission("workspaces.update"),
  asyncHandler(async (req, res) => {
    const input = updateWorkspaceSchema.parse(req.body);
    const workspace = await workspaceService.updateWorkspace(req.user, req.params.id, input, req.user.role.permissions, requestMeta6(req));
    sendSuccess(res, { workspace });
  })
);
router14.get(
  "/:id/members",
  requirePermission("workspaces.read"),
  asyncHandler(async (req, res) => {
    const query = listWorkspacesQuerySchema.pick({ page: true, limit: true }).parse(req.query);
    const { rows, total } = await workspaceService.listMembers(req.user, req.params.id, query.page, query.limit);
    const members = rows.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      displayName: m.user.displayName,
      status: m.status,
      isPrimary: m.isPrimary,
      roleKey: m.role.key,
      roleName: m.role.name,
      joinedAt: m.joinedAt
    }));
    sendSuccess(res, { members }, 200, { page: query.page, limit: query.limit, total });
  })
);
router14.get(
  "/:id/invitations",
  requirePermission("invitations.read"),
  asyncHandler(async (req, res) => {
    const query = listInvitationsQuerySchema.parse(req.query);
    const { rows, total } = await invitationService.listInvitations(req.user, req.params.id, query.page, query.limit);
    sendSuccess(res, { invitations: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router14.post(
  "/:id/invitations",
  requirePermission("invitations.create"),
  asyncHandler(async (req, res) => {
    const input = createInvitationSchema.parse(req.body);
    const { invitation, devToken } = await invitationService.createInvitation(req.user, req.params.id, input, requestMeta6(req));
    const { tokenHash: _tokenHash, ...safeInvitation } = invitation;
    sendSuccess(res, { invitation: safeInvitation, devToken }, 201);
  })
);
var workspaceRoutes_default = router14;

// server/routes/v1/invitationRoutes.ts
import { Router as Router15 } from "express";
var router15 = Router15();
function requestMeta7(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router15.post(
  "/:id/revoke",
  authenticateToken,
  requirePermission("invitations.revoke"),
  asyncHandler(async (req, res) => {
    await invitationService.revokeInvitation(req.user, req.params.id, requestMeta7(req));
    sendSuccess(res, { message: "Invitation revoked." });
  })
);
router15.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const preview = await invitationService.previewInvitation(req.params.token);
    sendSuccess(res, preview);
  })
);
router15.post(
  "/:token/accept",
  asyncHandler(async (req, res) => {
    const input = acceptInvitationSchema.parse(req.body);
    const result = await invitationService.acceptInvitation(req.params.token, input, requestMeta7(req));
    sendSuccess(res, result, 201);
  })
);
var invitationRoutes_default = router15;

// server/routes/v1/productRoutes.ts
import { Router as Router16 } from "express";

// server/repositories/productRepository.ts
function slugify3(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 100);
}
function buildWhere5(filters) {
  const where = {};
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  if (filters.isFeatured !== void 0) where.isFeatured = filters.isFeatured;
  if (filters.search) {
    const term = filters.search;
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { code: { contains: term, mode: "insensitive" } },
      { slug: { contains: term, mode: "insensitive" } }
    ];
  }
  return where;
}
var productRepository = {
  async list(filters, page, limit, sort, order) {
    const where = buildWhere5(filters);
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.product.count({ where })
    ]);
    return { rows, total };
  },
  async findById(id) {
    return prisma.product.findUnique({ where: { id } });
  },
  async findByCode(code) {
    return prisma.product.findUnique({ where: { code } });
  },
  async findBySlug(slug) {
    return prisma.product.findUnique({ where: { slug } });
  },
  /** Server-generated, collision-safe (§7) — never trusts a frontend-supplied slug for uniqueness beyond a caller-requested starting point. */
  async findUniqueSlug(base) {
    const baseSlug = slugify3(base) || "product";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlug(slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async create(data) {
    return prisma.product.create({
      data: {
        code: data.code,
        name: data.name,
        slug: data.slug,
        type: data.type,
        shortDescription: data.shortDescription,
        description: data.description,
        status: data.status ?? "DRAFT",
        isFeatured: data.isFeatured ?? false,
        displayOrder: data.displayOrder ?? 0,
        createdById: data.createdById,
        updatedById: data.createdById
      }
    });
  },
  async update(id, data) {
    return prisma.product.update({ where: { id }, data });
  }
};

// server/services/productService.ts
var TERMINAL_STATUSES3 = /* @__PURE__ */ new Set(["ARCHIVED"]);
var ALLOWED_TRANSITIONS2 = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["INACTIVE", "ARCHIVED"],
  INACTIVE: ["ACTIVE", "ARCHIVED"],
  ARCHIVED: []
};
function assertValidTransition2(current, next) {
  if (current === next) return;
  if (!ALLOWED_TRANSITIONS2[current]?.includes(next)) {
    throw new ConflictError(`Product cannot move from ${current} to ${next}.`);
  }
}
async function loadProductOrThrow(id) {
  const product = await productRepository.findById(id);
  if (!product) throw new NotFoundError("Product not found.");
  return product;
}
var productService = {
  async listProducts(filters, page, limit, sort, order) {
    return productRepository.list(filters, page, limit, sort, order);
  },
  async getProduct(id) {
    return loadProductOrThrow(id);
  },
  async createProduct(caller, input, meta = {}) {
    const existingCode = await productRepository.findByCode(input.code);
    if (existingCode) throw new ConflictError(`A product with code "${input.code}" already exists.`, { existingProductId: existingCode.id });
    let slug;
    if (input.slug) {
      const existingSlug = await productRepository.findBySlug(input.slug);
      if (existingSlug) throw new ConflictError(`A product with slug "${input.slug}" already exists.`, { existingProductId: existingSlug.id });
      slug = input.slug;
    } else {
      slug = await productRepository.findUniqueSlug(input.name);
    }
    let product;
    try {
      product = await productRepository.create({
        code: input.code,
        name: input.name,
        slug,
        type: input.type,
        shortDescription: input.shortDescription,
        description: input.description,
        status: input.status,
        isFeatured: input.isFeatured,
        displayOrder: input.displayOrder,
        createdById: caller.id
      });
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A product with this code or slug already exists.") : err;
    }
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_CREATED",
      resourceType: "product",
      resourceId: product.id,
      afterData: { code: product.code, name: product.name, type: product.type, status: product.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return product;
  },
  async updateProduct(caller, id, input, meta = {}) {
    const existing = await loadProductOrThrow(id);
    if (TERMINAL_STATUSES3.has(existing.status)) {
      throw new ConflictError("This product is archived and can no longer be edited.");
    }
    if (input.status !== void 0) {
      if (input.status === "ARCHIVED") {
        throw new ValidationError('Use POST /products/:id/archive to archive a product \u2014 status cannot be set to "ARCHIVED" directly.');
      }
      assertValidTransition2(existing.status, input.status);
    }
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await productRepository.findBySlug(input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A product with slug "${input.slug}" already exists.`, { existingProductId: dup.id });
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.slug !== void 0) patch.slug = input.slug;
    if (input.type !== void 0) patch.type = input.type;
    if (input.shortDescription !== void 0) patch.shortDescription = input.shortDescription;
    if (input.description !== void 0) patch.description = input.description;
    if (input.status !== void 0) patch.status = input.status;
    if (input.isFeatured !== void 0) patch.isFeatured = input.isFeatured;
    if (input.displayOrder !== void 0) patch.displayOrder = input.displayOrder;
    patch.updatedById = caller.id;
    let updated;
    try {
      updated = await productRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError(err) ? new ConflictError("A product with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_UPDATED",
      resourceType: "product",
      resourceId: id,
      beforeData: { status: existing.status, name: existing.name },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async archiveProduct(caller, id, meta = {}) {
    const existing = await loadProductOrThrow(id);
    if (existing.status === "ARCHIVED") {
      throw new ConflictError("This product is already archived.");
    }
    const archived = await productRepository.update(id, { status: "ARCHIVED", updatedBy: { connect: { id: caller.id } } });
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_ARCHIVED",
      resourceType: "product",
      resourceId: id,
      beforeData: { status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return archived;
  }
};
function isUniqueConstraintError(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}

// server/repositories/productModuleRepository.ts
function slugify4(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 100);
}
var productModuleRepository = {
  async listForProduct(productId, status, page, limit) {
    const where = { productId };
    if (status) where.status = status;
    const [rows, total] = await Promise.all([
      prisma.productModule.findMany({
        where,
        orderBy: { displayOrder: "asc" },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.productModule.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdForProduct(id, productId) {
    return prisma.productModule.findFirst({ where: { id, productId } });
  },
  /** Standalone lookup for the flat /product-modules/:id routes, which take no separate productId to cross-check against — the id itself is authoritative for the record and its true parent product, so there is no manipulation surface here (unlike the nested /products/:id/modules routes, which use findByIdForProduct). */
  async findById(id) {
    return prisma.productModule.findUnique({ where: { id } });
  },
  async findByCodeForProduct(productId, code) {
    return prisma.productModule.findFirst({ where: { productId, code } });
  },
  async findBySlugForProduct(productId, slug) {
    return prisma.productModule.findFirst({ where: { productId, slug } });
  },
  async findUniqueSlugForProduct(productId, base) {
    const baseSlug = slugify4(base) || "module";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugForProduct(productId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  /** Unpaginated id list for one product — used only to validate a reorder request covers exactly this product's modules (§36), never returned to a client. */
  async listAllIdsForProduct(productId) {
    const rows = await prisma.productModule.findMany({ where: { productId }, select: { id: true } });
    return rows.map((r) => r.id);
  },
  async maxDisplayOrder(productId) {
    const top = await prisma.productModule.findFirst({ where: { productId }, orderBy: { displayOrder: "desc" } });
    return top?.displayOrder ?? -1;
  },
  async create(data) {
    return prisma.productModule.create({
      data: {
        productId: data.productId,
        code: data.code,
        name: data.name,
        slug: data.slug,
        description: data.description,
        status: data.status ?? "DRAFT",
        isCore: data.isCore ?? false,
        displayOrder: data.displayOrder
      }
    });
  },
  async update(id, data) {
    return prisma.productModule.update({ where: { id }, data });
  },
  /** All-or-nothing reorder — validated one product's worth of module ids, applied transactionally (§36). */
  async reorder(productId, orderedIds) {
    await prisma.$transaction(orderedIds.map((id, index) => prisma.productModule.update({ where: { id, productId }, data: { displayOrder: index } })));
  }
};

// server/services/productModuleService.ts
function isUniqueConstraintError2(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}
async function loadProductOrThrow2(productId) {
  const product = await productRepository.findById(productId);
  if (!product) throw new NotFoundError("Product not found.");
  return product;
}
async function loadModuleOrThrow(id) {
  const module_ = await productModuleRepository.findById(id);
  if (!module_) throw new NotFoundError("Product module not found.");
  return module_;
}
var productModuleService = {
  async listModulesForProduct(productId, status, page, limit) {
    await loadProductOrThrow2(productId);
    return productModuleRepository.listForProduct(productId, status, page, limit);
  },
  async getModule(id) {
    return loadModuleOrThrow(id);
  },
  async createModule(caller, productId, input, meta = {}) {
    const product = await loadProductOrThrow2(productId);
    if (product.status === "ARCHIVED") {
      throw new ConflictError("Cannot add a module to an archived product.");
    }
    const existingCode = await productModuleRepository.findByCodeForProduct(productId, input.code);
    if (existingCode) throw new ConflictError(`A module with code "${input.code}" already exists on this product.`);
    let slug;
    if (input.slug) {
      const existingSlug = await productModuleRepository.findBySlugForProduct(productId, input.slug);
      if (existingSlug) throw new ConflictError(`A module with slug "${input.slug}" already exists on this product.`);
      slug = input.slug;
    } else {
      slug = await productModuleRepository.findUniqueSlugForProduct(productId, input.name);
    }
    const displayOrder = input.displayOrder ?? await productModuleRepository.maxDisplayOrder(productId) + 1;
    let module_;
    try {
      module_ = await productModuleRepository.create({
        productId,
        code: input.code,
        name: input.name,
        slug,
        description: input.description,
        status: input.status,
        isCore: input.isCore,
        displayOrder
      });
    } catch (err) {
      throw isUniqueConstraintError2(err) ? new ConflictError("A module with this code or slug already exists on this product.") : err;
    }
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_CREATED",
      resourceType: "product_module",
      resourceId: module_.id,
      afterData: { productId, code: module_.code, name: module_.name, status: module_.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return module_;
  },
  async updateModule(caller, id, input, meta = {}) {
    const existing = await loadModuleOrThrow(id);
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await productModuleRepository.findBySlugForProduct(existing.productId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A module with slug "${input.slug}" already exists on this product.`);
    }
    if (input.status === "INACTIVE" && existing.isCore) {
      throw new ValidationError("Use POST /product-modules/:id/archive to deactivate a core module.");
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.slug !== void 0) patch.slug = input.slug;
    if (input.description !== void 0) patch.description = input.description;
    if (input.status !== void 0) patch.status = input.status;
    if (input.isCore !== void 0) patch.isCore = input.isCore;
    if (input.displayOrder !== void 0) patch.displayOrder = input.displayOrder;
    let updated;
    try {
      updated = await productModuleRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError2(err) ? new ConflictError("A module with this slug already exists on this product.") : err;
    }
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_UPDATED",
      resourceType: "product_module",
      resourceId: id,
      beforeData: { status: existing.status, name: existing.name },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async archiveModule(caller, id, meta = {}) {
    const existing = await loadModuleOrThrow(id);
    if (existing.status === "INACTIVE") {
      throw new ConflictError("This module is already inactive.");
    }
    const archived = await productModuleRepository.update(id, { status: "INACTIVE" });
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_ARCHIVED",
      resourceType: "product_module",
      resourceId: id,
      beforeData: { status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return archived;
  },
  /** Transactional, all-or-nothing reorder — validates every id belongs to this exact product before applying anything (§36). */
  async reorderModules(caller, productId, moduleIds, meta = {}) {
    await loadProductOrThrow2(productId);
    const existingIds = await productModuleRepository.listAllIdsForProduct(productId);
    const existingSet = new Set(existingIds);
    const requestedSet = new Set(moduleIds);
    if (moduleIds.length !== existingIds.length || existingIds.some((id) => !requestedSet.has(id)) || moduleIds.some((id) => !existingSet.has(id))) {
      throw new ValidationError("The reorder request must include exactly this product's current modules, each exactly once.");
    }
    await productModuleRepository.reorder(productId, moduleIds);
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "PRODUCT_MODULE_REORDERED",
      resourceType: "product",
      resourceId: productId,
      afterData: { order: moduleIds },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/schemas/productSchemas.ts
import { z as z13 } from "zod";
var productTypeSchema = z13.enum(["PRODUCT", "SERVICE"]);
var productStatusSchema = z13.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]);
var SORT_FIELDS = ["name", "code", "type", "status", "displayOrder", "createdAt", "updatedAt"];
var listProductsQuerySchema = z13.object({
  page: z13.coerce.number().int().positive().default(1),
  limit: z13.coerce.number().int().positive().max(100).default(20),
  search: z13.string().trim().max(200).optional(),
  type: productTypeSchema.optional(),
  status: productStatusSchema.optional(),
  isFeatured: z13.coerce.boolean().optional(),
  sort: z13.enum(SORT_FIELDS).default("displayOrder"),
  order: z13.enum(["asc", "desc"]).default("asc")
});
var codeSchema = z13.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, "code may only contain letters, numbers, dots, underscores, and hyphens").transform((v) => v.toUpperCase());
var createProductSchema = z13.object({
  code: codeSchema,
  name: z13.string().trim().min(1).max(200),
  slug: z13.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)").optional(),
  type: productTypeSchema,
  shortDescription: z13.string().trim().max(300).optional(),
  description: z13.string().trim().max(1e4).optional(),
  status: productStatusSchema.optional(),
  isFeatured: z13.boolean().optional(),
  displayOrder: z13.number().int().min(0).optional()
});
var updateProductSchema = z13.object({
  name: z13.string().trim().min(1).max(200).optional(),
  slug: z13.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)").optional(),
  type: productTypeSchema.optional(),
  shortDescription: z13.string().trim().max(300).nullable().optional(),
  description: z13.string().trim().max(1e4).nullable().optional(),
  status: productStatusSchema.optional(),
  isFeatured: z13.boolean().optional(),
  displayOrder: z13.number().int().min(0).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/schemas/productModuleSchemas.ts
import { z as z14 } from "zod";
var productModuleStatusSchema = z14.enum(["DRAFT", "ACTIVE", "INACTIVE"]);
var listProductModulesQuerySchema = z14.object({
  page: z14.coerce.number().int().positive().default(1),
  limit: z14.coerce.number().int().positive().max(100).default(50),
  status: productModuleStatusSchema.optional()
});
var codeSchema2 = z14.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/, "code may only contain letters, numbers, dots, underscores, and hyphens").transform((v) => v.toUpperCase());
var slugSchema = z14.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");
var createProductModuleSchema = z14.object({
  code: codeSchema2,
  name: z14.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  description: z14.string().trim().max(1e4).optional(),
  status: productModuleStatusSchema.optional(),
  isCore: z14.boolean().optional(),
  displayOrder: z14.number().int().min(0).optional()
});
var updateProductModuleSchema = z14.object({
  name: z14.string().trim().min(1).max(200).optional(),
  slug: slugSchema.optional(),
  description: z14.string().trim().max(1e4).nullable().optional(),
  status: productModuleStatusSchema.optional(),
  isCore: z14.boolean().optional(),
  displayOrder: z14.number().int().min(0).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
var reorderProductModulesSchema = z14.object({
  moduleIds: z14.array(z14.string().trim().uuid()).min(1).max(200)
});

// server/routes/v1/productRoutes.ts
var router16 = Router16();
router16.use(authenticateToken);
function requestMeta8(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router16.get(
  "/",
  requirePermission("products.read"),
  asyncHandler(async (req, res) => {
    const query = listProductsQuerySchema.parse(req.query);
    const { rows, total } = await productService.listProducts(
      { search: query.search, type: query.type, status: query.status, isFeatured: query.isFeatured },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { products: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router16.get(
  "/:id",
  requirePermission("products.read"),
  asyncHandler(async (req, res) => {
    const product = await productService.getProduct(req.params.id);
    sendSuccess(res, { product });
  })
);
router16.post(
  "/",
  requirePermission("products.create"),
  asyncHandler(async (req, res) => {
    const input = createProductSchema.parse(req.body);
    const product = await productService.createProduct(req.user, input, requestMeta8(req));
    sendSuccess(res, { product }, 201);
  })
);
router16.patch(
  "/:id",
  requirePermission("products.update"),
  asyncHandler(async (req, res) => {
    const input = updateProductSchema.parse(req.body);
    const product = await productService.updateProduct(req.user, req.params.id, input, requestMeta8(req));
    sendSuccess(res, { product });
  })
);
router16.post(
  "/:id/archive",
  requirePermission("products.archive"),
  asyncHandler(async (req, res) => {
    const product = await productService.archiveProduct(req.user, req.params.id, requestMeta8(req));
    sendSuccess(res, { product });
  })
);
router16.get(
  "/:id/modules",
  requirePermission("product_modules.read"),
  asyncHandler(async (req, res) => {
    const query = listProductModulesQuerySchema.parse(req.query);
    const { rows, total } = await productModuleService.listModulesForProduct(req.params.id, query.status, query.page, query.limit);
    sendSuccess(res, { modules: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router16.post(
  "/:id/modules",
  requirePermission("product_modules.create"),
  asyncHandler(async (req, res) => {
    const input = createProductModuleSchema.parse(req.body);
    const module_ = await productModuleService.createModule(req.user, req.params.id, input, requestMeta8(req));
    sendSuccess(res, { module: module_ }, 201);
  })
);
router16.post(
  "/:id/modules/reorder",
  requirePermission("product_modules.reorder"),
  asyncHandler(async (req, res) => {
    const input = reorderProductModulesSchema.parse(req.body);
    await productModuleService.reorderModules(req.user, req.params.id, input.moduleIds, requestMeta8(req));
    sendSuccess(res, { message: "Modules reordered." });
  })
);
var productRoutes_default = router16;

// server/routes/v1/productModuleRoutes.ts
import { Router as Router17 } from "express";
var router17 = Router17();
router17.use(authenticateToken);
function requestMeta9(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router17.get(
  "/:id",
  requirePermission("product_modules.read"),
  asyncHandler(async (req, res) => {
    const module_ = await productModuleService.getModule(req.params.id);
    sendSuccess(res, { module: module_ });
  })
);
router17.patch(
  "/:id",
  requirePermission("product_modules.update"),
  asyncHandler(async (req, res) => {
    const input = updateProductModuleSchema.parse(req.body);
    const module_ = await productModuleService.updateModule(req.user, req.params.id, input, requestMeta9(req));
    sendSuccess(res, { module: module_ });
  })
);
router17.post(
  "/:id/archive",
  requirePermission("product_modules.archive"),
  asyncHandler(async (req, res) => {
    const module_ = await productModuleService.archiveModule(req.user, req.params.id, requestMeta9(req));
    sendSuccess(res, { module: module_ });
  })
);
var productModuleRoutes_default = router17;

// server/routes/v1/pageRoutes.ts
import { Router as Router18 } from "express";

// server/repositories/pageRepository.ts
function slugify5(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 150);
}
var withCurrentRevision = { include: { currentRevision: true } };
var withPublicRelations = { include: { currentRevision: true, featuredMedia: true } };
function buildWhere6(organizationId, filters) {
  const where = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.search) {
    where.OR = [{ title: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }];
  }
  return where;
}
var pageRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere6(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.page.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.page.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.page.findFirst({ where: { id, organizationId, deletedAt: null }, ...withCurrentRevision });
  },
  async findBySlugInOrg(organizationId, slug) {
    return prisma.page.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },
  /** Phase 11 public projection — PUBLISHED only, with the revision content and featured media needed to render the page (docs/PUBLIC_API_ARCHITECTURE.md). Never returns DRAFT/IN_REVIEW/SCHEDULED/ARCHIVED. */
  async findPublishedBySlugWithMedia(organizationId, slug) {
    return prisma.page.findFirst({ where: { organizationId, slug, status: "PUBLISHED", deletedAt: null }, ...withPublicRelations });
  },
  async findUniqueSlugInOrg(organizationId, base) {
    const baseSlug = slugify5(base) || "page";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async listRevisions(pageId) {
    return prisma.contentRevision.findMany({ where: { pageId }, orderBy: { version: "desc" } });
  },
  async softDelete(id) {
    await prisma.page.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  }
};

// server/services/mediaService.ts
import { randomUUID as randomUUID2 } from "node:crypto";

// server/repositories/mediaRepository.ts
function toApiMedia(row) {
  return { ...row, sizeBytes: Number(row.sizeBytes) };
}
function buildWhere7(organizationId, filters) {
  const where = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.mimeType) where.mimeType = filters.mimeType;
  if (filters.uploadedById) where.uploadedById = filters.uploadedById;
  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...filters.dateFrom ? { gte: filters.dateFrom } : {},
      ...filters.dateTo ? { lte: filters.dateTo } : {}
    };
  }
  if (filters.search) {
    where.OR = [
      { originalFilename: { contains: filters.search, mode: "insensitive" } },
      { displayName: { contains: filters.search, mode: "insensitive" } }
    ];
  }
  return where;
}
var mediaRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere7(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.mediaAsset.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.mediaAsset.count({ where })
    ]);
    return { rows: rows.map(toApiMedia), total };
  },
  /** The only lookup-by-id this module exposes — always organization-scoped (§11). */
  async findByIdInOrg(id, organizationId) {
    return prisma.mediaAsset.findFirst({ where: { id, organizationId, deletedAt: null } });
  },
  async create(data) {
    return prisma.mediaAsset.create({
      data: { ...data, sizeBytes: BigInt(data.sizeBytes), status: "PENDING" }
    });
  },
  async update(id, data) {
    return prisma.mediaAsset.update({ where: { id }, data });
  },
  /**
   * Race-safe conditional update — `WHERE id = ? AND status IN (...)`, the
   * same conditional-updateMany-plus-row-count pattern used for lead
   * conversion, workspace provisioning, and CMS optimistic concurrency
   * (Phases 5-8). Returns the affected row count so the caller can tell a
   * genuine race (0 rows — someone else already completed/archived it)
   * from success (1 row), never trusting a prior JS-level status check
   * alone against a concurrent request.
   */
  async updateWhereStatus(id, fromStatuses, data) {
    const result = await prisma.mediaAsset.updateMany({ where: { id, status: { in: fromStatuses } }, data });
    return result.count;
  },
  async markActive(id, data) {
    return this.updateWhereStatus(id, ["PENDING"], {
      status: "ACTIVE",
      sizeBytes: BigInt(data.sizeBytes),
      mimeType: data.mimeType,
      checksum: data.checksum,
      width: data.width,
      height: data.height
    });
  },
  async markFailed(id) {
    await prisma.mediaAsset.updateMany({ where: { id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "FAILED" } });
  },
  async softDelete(id) {
    await prisma.mediaAsset.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  },
  /** How many non-deleted Page/Post rows currently use this media as their featured image — used to block a hard delete of referenced media (§19). */
  async countContentReferences(id) {
    const [pages, posts] = await Promise.all([
      prisma.page.count({ where: { featuredMediaId: id, deletedAt: null } }),
      prisma.post.count({ where: { featuredMediaId: id, deletedAt: null } })
    ]);
    return pages + posts;
  }
};

// server/repositories/mediaUploadSessionRepository.ts
var mediaUploadSessionRepository = {
  async create(data) {
    return prisma.mediaUploadSession.create({ data });
  },
  async findByMediaId(mediaId) {
    return prisma.mediaUploadSession.findUnique({ where: { mediaId } });
  },
  /** Verifies possession of the upload secret via a DB equality lookup on its hash — never a fetch-then-compare in application code, matching workspaceInvitationRepository.findByToken's convention. */
  async findByMediaIdAndTokenHash(mediaId, tokenHash) {
    return prisma.mediaUploadSession.findFirst({ where: { mediaId, tokenHash } });
  },
  /** Race-safe conditional completion — `WHERE id = ? AND completed_at IS NULL`. Returns the affected row count so a concurrent double-completion is visible as 0, never silently re-applied. */
  async markCompleted(id) {
    const result = await prisma.mediaUploadSession.updateMany({ where: { id, completedAt: null }, data: { completedAt: /* @__PURE__ */ new Date() } });
    return result.count;
  }
};

// server/storage/localFilesystemProvider.ts
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
var HMAC_DOMAIN = "media-local-storage";
function rootDir() {
  return join(process.cwd(), config.localStorageDir);
}
function resolvePath(key) {
  const root = rootDir();
  const target = normalize(join(root, key));
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`Refusing to resolve storage key outside the local storage root: ${key}`);
  }
  return target;
}
function signLocalStorageToken(action, key, expiresAt) {
  return signHmac(config.sessionSecret, `${HMAC_DOMAIN}:${action}:${key}:${expiresAt.getTime()}`);
}
function verifyLocalStorageToken(action, key, expiresAtMs, signature) {
  if (Date.now() > expiresAtMs) return false;
  return verifyHmacSignature(config.sessionSecret, `${HMAC_DOMAIN}:${action}:${key}:${expiresAtMs}`, signature);
}
var LocalFilesystemStorageProvider = class {
  constructor() {
    this.name = "local";
  }
  async createSignedUploadUrl(params) {
    const expiresAt = new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1e3);
    const sig = signLocalStorageToken("upload", params.key, expiresAt);
    const url = `/api/v1/media/local-object?key=${encodeURIComponent(params.key)}&exp=${expiresAt.getTime()}&sig=${sig}`;
    return { url, method: "PUT", headers: { "Content-Type": params.contentType }, expiresAt };
  }
  async createSignedReadUrl(params) {
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1e3);
    const sig = signLocalStorageToken("read", params.key, expiresAt);
    return `/api/v1/media/local-object?key=${encodeURIComponent(params.key)}&exp=${expiresAt.getTime()}&sig=${sig}`;
  }
  async headObject(key) {
    try {
      const s = await stat(resolvePath(key));
      if (!s.isFile()) return { exists: false };
      return { exists: true, sizeBytes: s.size };
    } catch {
      return { exists: false };
    }
  }
  async readHeadBytes(key, byteLength) {
    let handle;
    try {
      handle = await open(resolvePath(key), "r");
      const buf = Buffer.alloc(byteLength);
      const { bytesRead } = await handle.read(buf, 0, byteLength, 0);
      return buf.subarray(0, bytesRead);
    } catch {
      return Buffer.alloc(0);
    } finally {
      await handle?.close();
    }
  }
  async deleteObject(key) {
    try {
      await rm(resolvePath(key), { force: true });
    } catch {
    }
  }
  async writeObject(key, bytes) {
    const path = resolvePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  async readObject(key) {
    return readFile(resolvePath(key));
  }
};
var localFilesystemStorageProvider = new LocalFilesystemStorageProvider();

// server/storage/s3CompatibleProvider.ts
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
var client = null;
function getClient() {
  if (!client) {
    client = new S3Client({
      region: config.objectStorageRegion || "auto",
      endpoint: config.objectStorageEndpoint || void 0,
      forcePathStyle: config.objectStorageForcePathStyle,
      credentials: { accessKeyId: config.objectStorageAccessKeyId, secretAccessKey: config.objectStorageSecretAccessKey }
    });
  }
  return client;
}
var S3CompatibleStorageProvider = class {
  constructor() {
    this.name = config.objectStorageProvider === "r2" ? "r2" : "s3";
  }
  async createSignedUploadUrl(params) {
    const command = new PutObjectCommand({ Bucket: config.objectStorageBucket, Key: params.key, ContentType: params.contentType });
    const url = await getSignedUrl(getClient(), command, { expiresIn: config.mediaSignedUrlTtlSeconds });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
      expiresAt: new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1e3)
    };
  }
  async createSignedReadUrl(params) {
    const command = new GetObjectCommand({ Bucket: config.objectStorageBucket, Key: params.key });
    return getSignedUrl(getClient(), command, { expiresIn: params.expiresInSeconds });
  }
  async headObject(key) {
    try {
      const res = await getClient().send(new HeadObjectCommand({ Bucket: config.objectStorageBucket, Key: key }));
      return { exists: true, sizeBytes: res.ContentLength, contentType: res.ContentType };
    } catch {
      return { exists: false };
    }
  }
  async readHeadBytes(key, byteLength) {
    try {
      const res = await getClient().send(
        new GetObjectCommand({ Bucket: config.objectStorageBucket, Key: key, Range: `bytes=0-${byteLength - 1}` })
      );
      if (!res.Body) return Buffer.alloc(0);
      const chunks = [];
      for await (const chunk of res.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch {
      return Buffer.alloc(0);
    }
  }
  async deleteObject(key) {
    await getClient().send(new DeleteObjectCommand({ Bucket: config.objectStorageBucket, Key: key }));
  }
};
var s3CompatibleStorageProvider = new S3CompatibleStorageProvider();

// server/storage/supabaseStorageProvider.ts
import { createClient } from "@supabase/supabase-js";
var client2 = null;
function getClient2() {
  if (!client2) {
    client2 = createClient(config.supabaseStorageUrl, config.supabaseStorageServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client2;
}
var SupabaseStorageProvider = class {
  constructor() {
    this.name = "supabase";
  }
  async createSignedUploadUrl(params) {
    const { data, error } = await getClient2().storage.from(config.objectStorageBucket).createSignedUploadUrl(params.key);
    if (error || !data) throw new Error(`Supabase Storage: failed to create a signed upload URL (${error?.message ?? "unknown error"})`);
    return {
      url: `${config.supabaseStorageUrl}/storage/v1${data.signedUrl.startsWith("/") ? "" : "/"}${data.signedUrl}`,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
      expiresAt: new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1e3)
    };
  }
  async createSignedReadUrl(params) {
    const { data, error } = await getClient2().storage.from(config.objectStorageBucket).createSignedUrl(params.key, params.expiresInSeconds);
    if (error || !data) throw new Error(`Supabase Storage: failed to create a signed read URL (${error?.message ?? "unknown error"})`);
    return data.signedUrl;
  }
  async headObject(key) {
    const dir = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
    const name = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
    const { data, error } = await getClient2().storage.from(config.objectStorageBucket).list(dir, { search: name, limit: 1 });
    if (error || !data || data.length === 0) return { exists: false };
    const found = data.find((f) => f.name === name);
    if (!found) return { exists: false };
    return { exists: true, sizeBytes: found.metadata?.size, contentType: found.metadata?.mimetype };
  }
  async readHeadBytes(key, byteLength) {
    const { data, error } = await getClient2().storage.from(config.objectStorageBucket).download(key, { transform: void 0 });
    if (error || !data) return Buffer.alloc(0);
    const arrayBuffer = await data.slice(0, byteLength).arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  async deleteObject(key) {
    const { error } = await getClient2().storage.from(config.objectStorageBucket).remove([key]);
    if (error && !/not.*found/i.test(error.message)) throw new Error(`Supabase Storage: delete failed (${error.message})`);
  }
};
var supabaseStorageProvider = new SupabaseStorageProvider();

// server/storage/testStorageProvider.ts
var TestStorageProvider = class {
  constructor() {
    this.name = "test";
    this.objects = /* @__PURE__ */ new Map();
    /** Test-only hook: keys in this set report `headObject`/`readHeadBytes` as if the object never arrived — simulates an abandoned/failed upload (§20 orphan handling). */
    this.missingKeys = /* @__PURE__ */ new Set();
  }
  /** Test helper — simulates the browser's PUT to the signed URL succeeding, without a real HTTP round-trip. */
  seedObject(key, bytes, contentType) {
    this.objects.set(key, { bytes, contentType });
  }
  reset() {
    this.objects.clear();
    this.missingKeys.clear();
  }
  async createSignedUploadUrl(params) {
    return {
      url: `https://test-storage.invalid/upload/${encodeURIComponent(params.key)}`,
      method: "PUT",
      headers: { "Content-Type": params.contentType },
      expiresAt: new Date(Date.now() + 15 * 60 * 1e3)
    };
  }
  async createSignedReadUrl(params) {
    return `https://test-storage.invalid/read/${encodeURIComponent(params.key)}?exp=${Date.now() + params.expiresInSeconds * 1e3}`;
  }
  async headObject(key) {
    if (this.missingKeys.has(key)) return { exists: false };
    const obj = this.objects.get(key);
    if (!obj) return { exists: false };
    return { exists: true, sizeBytes: obj.bytes.length, contentType: obj.contentType };
  }
  async readHeadBytes(key, byteLength) {
    if (this.missingKeys.has(key)) return Buffer.alloc(0);
    const obj = this.objects.get(key);
    if (!obj) return Buffer.alloc(0);
    return obj.bytes.subarray(0, byteLength);
  }
  async deleteObject(key) {
    this.objects.delete(key);
  }
};
var testStorageProvider = new TestStorageProvider();

// server/storage/index.ts
function getStorageProvider() {
  if (config.nodeEnv === "test") return testStorageProvider;
  switch (config.objectStorageProvider) {
    case "supabase":
      return supabaseStorageProvider;
    case "s3":
    case "r2":
      return s3CompatibleStorageProvider;
    case "none":
    default:
      return localFilesystemStorageProvider;
  }
}

// server/utils/storageKey.ts
function sanitizeFilename(original) {
  const base = original.split(/[/\\]/).pop() ?? "file";
  let safe = base.normalize("NFKD").replace(/[^a-zA-Z0-9.\-_]/g, "-").replace(/-{2,}/g, "-").replace(/^[.\-]+/, "").slice(0, 150);
  if (!safe || safe === "." || safe === "..") safe = "file";
  return safe;
}
function buildStorageKey(organizationId, mediaId, originalFilename) {
  return `organizations/${organizationId}/media/${mediaId}/${sanitizeFilename(originalFilename)}`;
}

// server/utils/fileSignature.ts
var ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
var ALLOWED_DOCUMENT_MIME_TYPES = ["application/pdf"];
var ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_MIME_TYPES, ...ALLOWED_DOCUMENT_MIME_TYPES];
function isImageMimeType(mimeType) {
  return ALLOWED_IMAGE_MIME_TYPES.includes(mimeType);
}
function mediaCategoryFor(mimeType) {
  return isImageMimeType(mimeType) ? "image" : "document";
}
var EXTENSION_BY_MIME = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "image/svg+xml": ["svg"],
  "application/pdf": ["pdf"]
};
function extensionMatchesMimeType(filename, mimeType) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  return EXTENSION_BY_MIME[mimeType].includes(ext);
}
function verifyFileSignature(mimeType, head) {
  if (mimeType === "image/svg+xml") {
    const text = head.toString("utf8", 0, Math.min(head.length, 512)).trimStart().toLowerCase();
    return text.startsWith("<?xml") || text.startsWith("<svg");
  }
  if (mimeType === "image/webp") return isValidWebp(head);
  const sig = SIGNATURES[mimeType];
  if (!sig) return false;
  return sig.some((candidate) => head.length >= candidate.length && candidate.every((byte, i) => head[i] === byte));
}
var SIGNATURES = {
  "image/jpeg": [[255, 216, 255]],
  "image/png": [[137, 80, 78, 71, 13, 10, 26, 10]],
  "image/gif": [
    [71, 73, 70, 56, 55, 97],
    [71, 73, 70, 56, 57, 97]
  ],
  "application/pdf": [[37, 80, 68, 70]]
};
function isValidWebp(head) {
  if (head.length < 12) return false;
  return head[0] === 82 && head[1] === 73 && head[2] === 70 && head[3] === 70 && head.subarray(8, 12).toString("ascii") === "WEBP";
}

// server/services/mediaService.ts
function maxSizeFor(mimeType) {
  return isImageMimeType(mimeType) ? config.mediaMaxImageSizeBytes : config.mediaMaxDocumentSizeBytes;
}
async function loadMediaOrThrow(id, organizationId) {
  const media = await mediaRepository.findByIdInOrg(id, organizationId);
  if (!media) throw new NotFoundError("Media not found.");
  return media;
}
async function assertFeaturedMediaUsable(mediaId, organizationId) {
  const media = await mediaRepository.findByIdInOrg(mediaId, organizationId);
  if (!media) throw new ValidationError("featuredMediaId does not refer to a media asset in this organization.");
  if (media.status !== "ACTIVE") throw new ValidationError("featuredMediaId must refer to an ACTIVE media asset.");
  if (!isImageMimeType(media.mimeType)) throw new ValidationError("featuredMediaId must refer to an image.");
}
var mediaService = {
  async listMedia(organizationId, filters, page, limit, sort, order) {
    return mediaRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getMedia(organizationId, id) {
    return toApiMedia(await loadMediaOrThrow(id, organizationId));
  },
  async createUploadSession(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    if (!extensionMatchesMimeType(input.filename, input.mimeType)) {
      throw new ValidationError(`The file extension does not match the declared type (${input.mimeType}).`);
    }
    const maxSize = maxSizeFor(input.mimeType);
    if (input.sizeBytes > maxSize) {
      throw new ValidationError(`File exceeds the maximum allowed size for ${mediaCategoryFor(input.mimeType)}s (${maxSize} bytes).`);
    }
    const mediaId = randomUUID2();
    const storageKey = buildStorageKey(organizationId, mediaId, input.filename);
    const provider = getStorageProvider();
    const media = await mediaRepository.create({
      id: mediaId,
      organizationId,
      originalFilename: input.filename,
      displayName: input.displayName,
      storageProvider: provider.name,
      storageBucket: config.objectStorageBucket || provider.name,
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      altText: input.altText,
      caption: input.caption,
      uploadedById: caller.id
    });
    const upload = await provider.createSignedUploadUrl({ key: storageKey, contentType: input.mimeType, maxSizeBytes: maxSize });
    const rawToken = generateUploadToken();
    await mediaUploadSessionRepository.create({
      mediaId,
      organizationId,
      uploadedById: caller.id,
      storageKey,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + config.mediaUploadSessionTtlMinutes * 60 * 1e3)
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_UPLOAD_INITIATED",
      resourceType: "media",
      resourceId: mediaId,
      afterData: { originalFilename: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { media: toApiMedia(media), upload, uploadToken: rawToken };
  },
  async completeUpload(caller, id, token, meta = {}) {
    const organizationId = caller.organizationId;
    const media = await loadMediaOrThrow(id, organizationId);
    if (media.status !== "PENDING") {
      throw new ConflictError(`This upload cannot be completed \u2014 media status is ${media.status}, not PENDING.`);
    }
    const session = await mediaUploadSessionRepository.findByMediaIdAndTokenHash(id, hashToken(token));
    if (!session) throw new ValidationError("Invalid upload token for this media.");
    if (session.completedAt) throw new ConflictError("This upload session has already been completed.");
    if (session.expiresAt.getTime() < Date.now()) {
      await mediaRepository.markFailed(id);
      throw new ConflictError("This upload session has expired. Start a new upload.");
    }
    const provider = getStorageProvider();
    const head = await provider.headObject(media.storageKey);
    if (!head.exists) {
      await mediaRepository.markFailed(id);
      throw new ConflictError("No object was found at the expected storage location \u2014 the upload did not complete.");
    }
    const headBytes = await provider.readHeadBytes(media.storageKey, 32);
    if (headBytes.length > 0 && !verifyFileSignature(media.mimeType, headBytes)) {
      await mediaRepository.markFailed(id);
      throw new ValidationError("The uploaded file's content does not match its declared type.");
    }
    const maxSize = maxSizeFor(media.mimeType);
    const verifiedSize = head.sizeBytes ?? Number(media.sizeBytes);
    if (verifiedSize > maxSize) {
      await mediaRepository.markFailed(id);
      throw new ValidationError(`The uploaded file exceeds the maximum allowed size (${maxSize} bytes).`);
    }
    const claimed = await mediaUploadSessionRepository.markCompleted(session.id);
    if (claimed === 0) throw new ConflictError("This upload session has already been completed.");
    const activatedCount = await mediaRepository.markActive(id, { sizeBytes: verifiedSize, mimeType: head.contentType ?? media.mimeType });
    if (activatedCount === 0) throw new ConflictError(`This upload cannot be completed \u2014 media status is no longer PENDING.`);
    const activated = await loadMediaOrThrow(id, organizationId);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_UPLOAD_COMPLETED",
      resourceType: "media",
      resourceId: id,
      afterData: { sizeBytes: verifiedSize },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return toApiMedia(activated);
  },
  async getReadUrl(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const media = await loadMediaOrThrow(id, organizationId);
    if (media.status !== "ACTIVE" && media.status !== "ARCHIVED") {
      throw new ConflictError("This media has no readable object yet.");
    }
    const provider = getStorageProvider();
    const url = await provider.createSignedReadUrl({ key: media.storageKey, expiresInSeconds: config.mediaSignedUrlTtlSeconds });
    const expiresAt = new Date(Date.now() + config.mediaSignedUrlTtlSeconds * 1e3);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_SIGNED_URL_ISSUED",
      resourceType: "media",
      resourceId: id,
      afterData: { expiresAt: expiresAt.toISOString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { url, expiresAt: expiresAt.toISOString() };
  },
  async updateMedia(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadMediaOrThrow(id, organizationId);
    const patch = {};
    if (input.displayName !== void 0) patch.displayName = input.displayName;
    if (input.altText !== void 0) patch.altText = input.altText;
    if (input.caption !== void 0) patch.caption = input.caption;
    if (input.visibility !== void 0) patch.visibility = input.visibility;
    const updated = await mediaRepository.update(id, patch);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_METADATA_UPDATED",
      resourceType: "media",
      resourceId: id,
      beforeData: { displayName: existing.displayName, altText: existing.altText, caption: existing.caption, visibility: existing.visibility },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return toApiMedia(updated);
  },
  async archiveMedia(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadMediaOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("This media is already archived.");
    const archivedCount = await mediaRepository.updateWhereStatus(id, ["PENDING", "ACTIVE", "FAILED"], { status: "ARCHIVED" });
    if (archivedCount === 0) throw new ConflictError("This media is already archived.");
    const updated = await loadMediaOrThrow(id, organizationId);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_ARCHIVED",
      resourceType: "media",
      resourceId: id,
      beforeData: { status: existing.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return toApiMedia(updated);
  },
  async deleteMedia(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadMediaOrThrow(id, organizationId);
    const referenceCount = await mediaRepository.countContentReferences(id);
    if (referenceCount > 0) {
      throw new ConflictError(
        `This media is currently used as a featured image by ${referenceCount} page/post \u2014 detach it from that content before deleting.`
      );
    }
    await mediaRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "MEDIA_DELETED",
      resourceType: "media",
      resourceId: id,
      beforeData: { status: existing.status, originalFilename: existing.originalFilename },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/services/pageService.ts
var CONTENT_EDIT_BLOCKED_STATUSES = /* @__PURE__ */ new Set(["PUBLISHED", "ARCHIVED"]);
function isUniqueConstraintError3(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}
function assertHasPublishableContent(revision) {
  if (!revision || !revision.title.trim() || !revision.body.trim()) {
    throw new ValidationError("This page needs a title and body before it can be published or scheduled.");
  }
}
async function loadPageOrThrow(id, organizationId) {
  const page = await pageRepository.findByIdInOrg(id, organizationId);
  if (!page) throw new NotFoundError("Page not found.");
  return page;
}
var pageService = {
  async listPages(organizationId, filters, page, limit, sort, order) {
    return pageRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getPage(organizationId, id) {
    return loadPageOrThrow(id, organizationId);
  },
  async listRevisions(organizationId, id) {
    await loadPageOrThrow(id, organizationId);
    return pageRepository.listRevisions(id);
  },
  async createPage(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    if (input.slug) {
      const dup = await pageRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A page with slug "${input.slug}" already exists.`, { existingPageId: dup.id });
    }
    if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    const slug = input.slug ?? await pageRepository.findUniqueSlugInOrg(organizationId, input.title);
    let createdId;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const page = await tx.page.create({
          data: { organizationId, slug, title: input.title, status: "DRAFT", createdById: caller.id, featuredMediaId: input.featuredMediaId }
        });
        const revision = await tx.contentRevision.create({
          data: {
            pageId: page.id,
            version: 1,
            status: "DRAFT",
            title: input.title,
            body: input.body,
            metadata: input.metadata ?? {},
            createdById: caller.id
          }
        });
        await tx.page.update({ where: { id: page.id }, data: { currentRevisionId: revision.id } });
        return page.id;
      });
    } catch (err) {
      throw isUniqueConstraintError3(err) ? new ConflictError("A page with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_CREATED",
      resourceType: "page",
      resourceId: createdId,
      afterData: { title: input.title, slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(createdId, organizationId);
  },
  async updatePage(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    const effectiveStatus = input.status ?? existing.status;
    const hasContentEdit = input.title !== void 0 || input.body !== void 0 || input.metadata !== void 0 || input.slug !== void 0;
    if (hasContentEdit && CONTENT_EDIT_BLOCKED_STATUSES.has(effectiveStatus)) {
      throw new ConflictError(`Page content cannot be edited while status is ${effectiveStatus}.`);
    }
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await pageRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A page with slug "${input.slug}" already exists.`, { existingPageId: dup.id });
    }
    const hasFeaturedMediaEdit = input.featuredMediaId !== void 0;
    if (hasFeaturedMediaEdit) {
      if (existing.status === "ARCHIVED") throw new ConflictError("Page content cannot be edited while status is ARCHIVED.");
      if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    }
    const unpublishing = existing.status === "PUBLISHED" && input.status === "DRAFT";
    const currentRevision = existing.currentRevision;
    try {
      await prisma.$transaction(async (tx) => {
        const pagePatch = {};
        if (input.status !== void 0) pagePatch.status = input.status;
        if (input.slug !== void 0) pagePatch.slug = input.slug;
        if (input.title !== void 0) pagePatch.title = input.title;
        if (hasFeaturedMediaEdit) pagePatch.featuredMediaId = input.featuredMediaId;
        if (unpublishing) pagePatch.publishedAt = null;
        if (currentRevision && (unpublishing || hasContentEdit && currentRevision.status === "PUBLISHED")) {
          const newRevision = await tx.contentRevision.create({
            data: {
              pageId: id,
              version: currentRevision.version + 1,
              status: "DRAFT",
              title: input.title ?? currentRevision.title,
              body: input.body ?? currentRevision.body,
              metadata: input.metadata ?? currentRevision.metadata,
              createdById: caller.id
            }
          });
          pagePatch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch = {};
          if (input.title !== void 0) revisionPatch.title = input.title;
          if (input.body !== void 0) revisionPatch.body = input.body;
          if (input.metadata !== void 0) revisionPatch.metadata = input.metadata;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.contentRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }
        if (hasContentEdit && Object.keys(pagePatch).length === 0) {
          pagePatch.updatedAt = /* @__PURE__ */ new Date();
        }
        if (Object.keys(pagePatch).length > 0) {
          const where = { id, ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {} };
          const result = await tx.page.updateMany({ where, data: pagePatch });
          if (result.count === 0) {
            throw new ConflictError("This page was changed by someone else since you loaded it. Reload and try again.");
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError3(err) ? new ConflictError("A page with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_UPDATED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      afterData: { status: input.status, title: input.title, slug: input.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    if (hasFeaturedMediaEdit && input.featuredMediaId !== existing.featuredMediaId) {
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: input.featuredMediaId ? "MEDIA_ATTACHED_TO_CONTENT" : "MEDIA_DETACHED_FROM_CONTENT",
        resourceType: "page",
        resourceId: id,
        beforeData: { featuredMediaId: existing.featuredMediaId },
        afterData: { featuredMediaId: input.featuredMediaId ?? null },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
    return loadPageOrThrow(id, organizationId);
  },
  async submitForReview(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    if (existing.status !== "DRAFT") throw new ConflictError(`Only a DRAFT page can be submitted for review (current status: ${existing.status}).`);
    if (!existing.currentRevision || !existing.currentRevision.body.trim()) {
      throw new ValidationError("This page needs body content before it can be submitted for review.");
    }
    await prisma.page.update({ where: { id }, data: { status: "IN_REVIEW" } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_SUBMITTED_FOR_REVIEW",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "IN_REVIEW" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(id, organizationId);
  },
  async publishPage(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before it can be published.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This page is already published.");
    if (!existing.currentRevisionId) throw new ConflictError("This page has no content revision to publish.");
    assertHasPublishableContent(existing.currentRevision);
    const now = /* @__PURE__ */ new Date();
    await prisma.$transaction([
      prisma.contentRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.page.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } })
    ]);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_PUBLISHED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PUBLISHED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(id, organizationId);
  },
  async schedulePage(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before it can be scheduled.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This page is already published.");
    assertHasPublishableContent(existing.currentRevision);
    await prisma.page.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_SCHEDULED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SCHEDULED", scheduledAt: input.scheduledAt },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(id, organizationId);
  },
  async archivePage(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("This page is already archived.");
    await prisma.page.update({ where: { id }, data: { status: "ARCHIVED" } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_ARCHIVED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(id, organizationId);
  },
  async revertPage(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived page must be restored before its content can be reverted.");
    const target = await prisma.contentRevision.findFirst({ where: { id: input.revisionId, pageId: id } });
    if (!target) throw new NotFoundError("Revision not found on this page.");
    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    const wasPublished = existing.status === "PUBLISHED";
    await prisma.$transaction(async (tx) => {
      const newRevision = await tx.contentRevision.create({
        data: {
          pageId: id,
          version: nextVersion,
          status: "DRAFT",
          title: target.title,
          body: target.body,
          metadata: target.metadata,
          createdById: caller.id
        }
      });
      await tx.page.update({
        where: { id },
        data: {
          currentRevisionId: newRevision.id,
          ...wasPublished ? { status: "DRAFT", publishedAt: null } : {}
        }
      });
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_REVERTED",
      resourceType: "page",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPageOrThrow(id, organizationId);
  },
  async deletePage(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPageOrThrow(id, organizationId);
    await pageRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAGE_DELETED",
      resourceType: "page",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/schemas/pageSchemas.ts
import { z as z16 } from "zod";

// server/schemas/contentSchemas.ts
import { z as z15 } from "zod";
var contentStatusSchema = z15.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]);
var patchableContentStatusSchema = z15.enum(["DRAFT"]);
var expectedUpdatedAtSchema = z15.coerce.date().optional();
var revertContentSchema = z15.object({
  revisionId: z15.string().trim().uuid()
});
var SORT_FIELDS2 = ["title", "slug", "status", "createdAt", "updatedAt", "publishedAt"];
var listContentQuerySchema = z15.object({
  page: z15.coerce.number().int().positive().default(1),
  limit: z15.coerce.number().int().positive().max(100).default(20),
  search: z15.string().trim().max(200).optional(),
  status: contentStatusSchema.optional(),
  sort: z15.enum(SORT_FIELDS2).default("updatedAt"),
  order: z15.enum(["asc", "desc"]).default("desc")
});
var scheduleContentSchema = z15.object({
  scheduledAt: z15.coerce.date().refine((d) => d.getTime() > Date.now(), { message: "scheduledAt must be in the future" })
});
var slugSchema2 = z15.string().trim().min(1).max(150).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");
var createCategorySchema = z15.object({
  name: z15.string().trim().min(1).max(150),
  slug: slugSchema2.optional(),
  description: z15.string().trim().max(2e3).optional()
});
var updateCategorySchema = z15.object({
  name: z15.string().trim().min(1).max(150).optional(),
  slug: slugSchema2.optional(),
  description: z15.string().trim().max(2e3).nullable().optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });
var createTagSchema = z15.object({
  name: z15.string().trim().min(1).max(100),
  slug: slugSchema2.optional()
});
var updateTagSchema = z15.object({
  name: z15.string().trim().min(1).max(100).optional(),
  slug: slugSchema2.optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/schemas/pageSchemas.ts
var slugSchema3 = z16.string().trim().min(1).max(150).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");
var createPageSchema = z16.object({
  title: z16.string().trim().min(1).max(200),
  slug: slugSchema3.optional(),
  body: z16.string().trim().max(5e5).default(""),
  metadata: z16.record(z16.unknown()).optional(),
  featuredMediaId: z16.string().trim().uuid().optional()
});
var updatePageSchema = z16.object({
  title: z16.string().trim().min(1).max(200).optional(),
  slug: slugSchema3.optional(),
  body: z16.string().trim().max(5e5).optional(),
  metadata: z16.record(z16.unknown()).optional(),
  status: patchableContentStatusSchema.optional(),
  featuredMediaId: z16.string().trim().uuid().nullable().optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema
}).refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });

// server/routes/v1/pageRoutes.ts
var router18 = Router18();
router18.use(authenticateToken);
function requestMeta10(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router18.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const query = listContentQuerySchema.parse(req.query);
    const { rows, total } = await pageService.listPages(
      req.user.organizationId,
      { search: query.search, status: query.status },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { pages: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router18.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const page = await pageService.getPage(req.user.organizationId, req.params.id);
    sendSuccess(res, { page });
  })
);
router18.get(
  "/:id/revisions",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const revisions = await pageService.listRevisions(req.user.organizationId, req.params.id);
    sendSuccess(res, { revisions });
  })
);
router18.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createPageSchema.parse(req.body);
    const page = await pageService.createPage(req.user, input, requestMeta10(req));
    sendSuccess(res, { page }, 201);
  })
);
router18.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updatePageSchema.parse(req.body);
    const page = await pageService.updatePage(req.user, req.params.id, input, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.post(
  "/:id/submit-review",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const page = await pageService.submitForReview(req.user, req.params.id, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.post(
  "/:id/publish",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const page = await pageService.publishPage(req.user, req.params.id, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.post(
  "/:id/schedule",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const input = scheduleContentSchema.parse(req.body);
    const page = await pageService.schedulePage(req.user, req.params.id, input, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.post(
  "/:id/archive",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const page = await pageService.archivePage(req.user, req.params.id, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.post(
  "/:id/revert",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = revertContentSchema.parse(req.body);
    const page = await pageService.revertPage(req.user, req.params.id, input, requestMeta10(req));
    sendSuccess(res, { page });
  })
);
router18.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await pageService.deletePage(req.user, req.params.id, requestMeta10(req));
    sendSuccess(res, { message: "Page deleted." });
  })
);
var pageRoutes_default = router18;

// server/routes/v1/postRoutes.ts
import { Router as Router19 } from "express";

// server/repositories/postRepository.ts
function slugify6(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 150);
}
var withRelations = { include: { currentRevision: true, category: true, author: true, tags: { include: { tag: true } } } };
var withPublicRelations2 = {
  include: {
    currentRevision: true,
    category: true,
    author: { include: { user: { select: { firstName: true, lastName: true } } } },
    tags: { include: { tag: true } },
    featuredMedia: true
  }
};
function buildWhere8(organizationId, filters) {
  const where = { organizationId, deletedAt: null };
  if (filters.status) where.status = filters.status;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.tagId) where.tags = { some: { tagId: filters.tagId } };
  if (filters.search) {
    where.OR = [{ title: { contains: filters.search, mode: "insensitive" } }, { slug: { contains: filters.search, mode: "insensitive" } }];
  }
  return where;
}
var postRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere8(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.post.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.post.findFirst({ where: { id, organizationId, deletedAt: null }, ...withRelations });
  },
  async findBySlugInOrg(organizationId, slug) {
    return prisma.post.findFirst({ where: { organizationId, slug, deletedAt: null } });
  },
  /** Phase 11 public projection — PUBLISHED only, with category/author/tags/featured media/revision content (docs/PUBLIC_API_ARCHITECTURE.md). Never returns DRAFT/IN_REVIEW/SCHEDULED/ARCHIVED. */
  async findPublishedBySlugWithMedia(organizationId, slug) {
    return prisma.post.findFirst({ where: { organizationId, slug, status: "PUBLISHED", deletedAt: null }, ...withPublicRelations2 });
  },
  /** Phase 11 public projection — PUBLISHED only, paginated, with the same relations as findPublishedBySlugWithMedia. */
  async listPublished(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere8(organizationId, { ...filters, status: "PUBLISHED" });
    const [rows, total] = await Promise.all([
      prisma.post.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withPublicRelations2 }),
      prisma.post.count({ where })
    ]);
    return { rows, total };
  },
  async findUniqueSlugInOrg(organizationId, base) {
    const baseSlug = slugify6(base) || "post";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async listRevisions(postId) {
    return prisma.contentRevision.findMany({ where: { postId }, orderBy: { version: "desc" } });
  },
  async setTags(postId, tagIds) {
    await prisma.$transaction([
      prisma.postTag.deleteMany({ where: { postId } }),
      ...tagIds.length > 0 ? [prisma.postTag.createMany({ data: tagIds.map((tagId) => ({ postId, tagId })) })] : []
    ]);
  },
  async softDelete(id) {
    await prisma.post.update({ where: { id }, data: { deletedAt: /* @__PURE__ */ new Date() } });
  }
};

// server/repositories/categoryRepository.ts
function slugify7(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 150);
}
var categoryRepository = {
  async list(organizationId) {
    return prisma.category.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.category.findFirst({ where: { id, organizationId } });
  },
  async findBySlugInOrg(organizationId, slug) {
    return prisma.category.findFirst({ where: { organizationId, slug } });
  },
  async findUniqueSlugInOrg(organizationId, base) {
    const baseSlug = slugify7(base) || "category";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async create(data) {
    return prisma.category.create({ data });
  },
  async update(id, data) {
    return prisma.category.update({ where: { id }, data });
  },
  async delete(id) {
    await prisma.category.delete({ where: { id } });
  }
};

// server/repositories/tagRepository.ts
function slugify8(input) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 150);
}
var tagRepository = {
  async list(organizationId) {
    return prisma.tag.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.tag.findFirst({ where: { id, organizationId } });
  },
  async findBySlugInOrg(organizationId, slug) {
    return prisma.tag.findFirst({ where: { organizationId, slug } });
  },
  async findUniqueSlugInOrg(organizationId, base) {
    const baseSlug = slugify8(base) || "tag";
    let slug = baseSlug;
    let attempt = 1;
    while (await this.findBySlugInOrg(organizationId, slug)) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
      if (attempt > 50) break;
    }
    return slug;
  },
  async findByIdsInOrg(ids, organizationId) {
    if (ids.length === 0) return [];
    return prisma.tag.findMany({ where: { id: { in: ids }, organizationId } });
  },
  async create(data) {
    return prisma.tag.create({ data });
  },
  async update(id, data) {
    return prisma.tag.update({ where: { id }, data });
  },
  async delete(id) {
    await prisma.tag.delete({ where: { id } });
  }
};

// server/services/postService.ts
var CONTENT_EDIT_BLOCKED_STATUSES2 = /* @__PURE__ */ new Set(["PUBLISHED", "ARCHIVED"]);
function isUniqueConstraintError4(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}
function assertHasPublishableContent2(revision) {
  if (!revision || !revision.title.trim() || !revision.body.trim()) {
    throw new ValidationError("This post needs a title and body before it can be published or scheduled.");
  }
}
async function loadPostOrThrow(id, organizationId) {
  const post = await postRepository.findByIdInOrg(id, organizationId);
  if (!post) throw new NotFoundError("Post not found.");
  return post;
}
async function assertCategoryInOrg(categoryId, organizationId) {
  if (!categoryId) return;
  const category = await categoryRepository.findByIdInOrg(categoryId, organizationId);
  if (!category) throw new ValidationError("categoryId does not refer to a category in this organization.");
}
async function assertTagsInOrg(tagIds, organizationId) {
  if (!tagIds || tagIds.length === 0) return;
  const found = await tagRepository.findByIdsInOrg(tagIds, organizationId);
  if (found.length !== new Set(tagIds).size) {
    throw new ValidationError("One or more tagIds do not refer to a tag in this organization.");
  }
}
var postService = {
  async listPosts(organizationId, filters, page, limit, sort, order) {
    return postRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getPost(organizationId, id) {
    return loadPostOrThrow(id, organizationId);
  },
  async listRevisions(organizationId, id) {
    await loadPostOrThrow(id, organizationId);
    return postRepository.listRevisions(id);
  },
  async createPost(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    await assertCategoryInOrg(input.categoryId, organizationId);
    await assertTagsInOrg(input.tagIds, organizationId);
    if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    if (input.slug) {
      const dup = await postRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A post with slug "${input.slug}" already exists.`, { existingPostId: dup.id });
    }
    const slug = input.slug ?? await postRepository.findUniqueSlugInOrg(organizationId, input.title);
    let createdId;
    try {
      createdId = await prisma.$transaction(async (tx) => {
        const post = await tx.post.create({
          data: {
            organizationId,
            slug,
            title: input.title,
            status: "DRAFT",
            categoryId: input.categoryId,
            authorId: input.authorId,
            featuredMediaId: input.featuredMediaId,
            createdById: caller.id
          }
        });
        const revision = await tx.contentRevision.create({
          data: {
            postId: post.id,
            version: 1,
            status: "DRAFT",
            title: input.title,
            body: input.body,
            metadata: input.metadata ?? {},
            createdById: caller.id
          }
        });
        await tx.post.update({ where: { id: post.id }, data: { currentRevisionId: revision.id } });
        if (input.tagIds && input.tagIds.length > 0) {
          await tx.postTag.createMany({ data: input.tagIds.map((tagId) => ({ postId: post.id, tagId })) });
        }
        return post.id;
      });
    } catch (err) {
      throw isUniqueConstraintError4(err) ? new ConflictError("A post with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_CREATED",
      resourceType: "post",
      resourceId: createdId,
      afterData: { title: input.title, slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(createdId, organizationId);
  },
  async updatePost(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    const effectiveStatus = input.status ?? existing.status;
    const hasContentEdit = input.title !== void 0 || input.body !== void 0 || input.metadata !== void 0 || input.slug !== void 0;
    if (hasContentEdit && CONTENT_EDIT_BLOCKED_STATUSES2.has(effectiveStatus)) {
      throw new ConflictError(`Post content cannot be edited while status is ${effectiveStatus}.`);
    }
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await postRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A post with slug "${input.slug}" already exists.`, { existingPostId: dup.id });
    }
    if (input.categoryId !== void 0) await assertCategoryInOrg(input.categoryId, organizationId);
    if (input.tagIds !== void 0) await assertTagsInOrg(input.tagIds, organizationId);
    const hasFeaturedMediaEdit = input.featuredMediaId !== void 0;
    if (hasFeaturedMediaEdit) {
      if (existing.status === "ARCHIVED") throw new ConflictError("Post content cannot be edited while status is ARCHIVED.");
      if (input.featuredMediaId) await assertFeaturedMediaUsable(input.featuredMediaId, organizationId);
    }
    const unpublishing = existing.status === "PUBLISHED" && input.status === "DRAFT";
    const currentRevision = existing.currentRevision;
    try {
      await prisma.$transaction(async (tx) => {
        const postPatch = {};
        if (input.status !== void 0) postPatch.status = input.status;
        if (input.slug !== void 0) postPatch.slug = input.slug;
        if (input.title !== void 0) postPatch.title = input.title;
        if (input.categoryId !== void 0) postPatch.categoryId = input.categoryId;
        if (input.authorId !== void 0) postPatch.authorId = input.authorId;
        if (hasFeaturedMediaEdit) postPatch.featuredMediaId = input.featuredMediaId;
        if (unpublishing) postPatch.publishedAt = null;
        if (currentRevision && (unpublishing || hasContentEdit && currentRevision.status === "PUBLISHED")) {
          const newRevision = await tx.contentRevision.create({
            data: {
              postId: id,
              version: currentRevision.version + 1,
              status: "DRAFT",
              title: input.title ?? currentRevision.title,
              body: input.body ?? currentRevision.body,
              metadata: input.metadata ?? currentRevision.metadata,
              createdById: caller.id
            }
          });
          postPatch.currentRevisionId = newRevision.id;
        } else if (hasContentEdit && currentRevision) {
          const revisionPatch = {};
          if (input.title !== void 0) revisionPatch.title = input.title;
          if (input.body !== void 0) revisionPatch.body = input.body;
          if (input.metadata !== void 0) revisionPatch.metadata = input.metadata;
          if (Object.keys(revisionPatch).length > 0) {
            await tx.contentRevision.update({ where: { id: currentRevision.id }, data: revisionPatch });
          }
        }
        const willTouchTags = input.tagIds !== void 0;
        if (hasContentEdit && Object.keys(postPatch).length === 0 && !willTouchTags) {
          postPatch.updatedAt = /* @__PURE__ */ new Date();
        }
        if (Object.keys(postPatch).length > 0) {
          const where = { id, ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {} };
          const result = await tx.post.updateMany({ where, data: postPatch });
          if (result.count === 0) {
            throw new ConflictError("This post was changed by someone else since you loaded it. Reload and try again.");
          }
        }
        if (input.tagIds !== void 0) {
          await tx.postTag.deleteMany({ where: { postId: id } });
          if (input.tagIds.length > 0) {
            await tx.postTag.createMany({ data: input.tagIds.map((tagId) => ({ postId: id, tagId })) });
          }
        }
      });
    } catch (err) {
      throw isUniqueConstraintError4(err) ? new ConflictError("A post with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_UPDATED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      afterData: { status: input.status, title: input.title, slug: input.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    if (hasFeaturedMediaEdit && input.featuredMediaId !== existing.featuredMediaId) {
      await auditLogRepository.record({
        organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: input.featuredMediaId ? "MEDIA_ATTACHED_TO_CONTENT" : "MEDIA_DETACHED_FROM_CONTENT",
        resourceType: "post",
        resourceId: id,
        beforeData: { featuredMediaId: existing.featuredMediaId },
        afterData: { featuredMediaId: input.featuredMediaId ?? null },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
    }
    return loadPostOrThrow(id, organizationId);
  },
  async submitForReview(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    if (existing.status !== "DRAFT") throw new ConflictError(`Only a DRAFT post can be submitted for review (current status: ${existing.status}).`);
    if (!existing.currentRevision || !existing.currentRevision.body.trim()) {
      throw new ValidationError("This post needs body content before it can be submitted for review.");
    }
    await prisma.post.update({ where: { id }, data: { status: "IN_REVIEW" } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_SUBMITTED_FOR_REVIEW",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "IN_REVIEW" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(id, organizationId);
  },
  async publishPost(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before it can be published.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This post is already published.");
    if (!existing.currentRevisionId) throw new ConflictError("This post has no content revision to publish.");
    assertHasPublishableContent2(existing.currentRevision);
    const now = /* @__PURE__ */ new Date();
    await prisma.$transaction([
      prisma.contentRevision.update({ where: { id: existing.currentRevisionId }, data: { status: "PUBLISHED", publishedAt: now } }),
      prisma.post.update({ where: { id }, data: { status: "PUBLISHED", publishedAt: now, scheduledAt: null } })
    ]);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_PUBLISHED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PUBLISHED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(id, organizationId);
  },
  async schedulePost(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before it can be scheduled.");
    if (existing.status === "PUBLISHED") throw new ConflictError("This post is already published.");
    assertHasPublishableContent2(existing.currentRevision);
    await prisma.post.update({ where: { id }, data: { status: "SCHEDULED", scheduledAt: input.scheduledAt } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_SCHEDULED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SCHEDULED", scheduledAt: input.scheduledAt },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(id, organizationId);
  },
  async archivePost(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("This post is already archived.");
    await prisma.post.update({ where: { id }, data: { status: "ARCHIVED" } });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_ARCHIVED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ARCHIVED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(id, organizationId);
  },
  async revertPost(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    if (existing.status === "ARCHIVED") throw new ConflictError("An archived post must be restored before its content can be reverted.");
    const target = await prisma.contentRevision.findFirst({ where: { id: input.revisionId, postId: id } });
    if (!target) throw new NotFoundError("Revision not found on this post.");
    const current = existing.currentRevision;
    const nextVersion = (current?.version ?? 0) + 1;
    const wasPublished = existing.status === "PUBLISHED";
    await prisma.$transaction(async (tx) => {
      const newRevision = await tx.contentRevision.create({
        data: {
          postId: id,
          version: nextVersion,
          status: "DRAFT",
          title: target.title,
          body: target.body,
          metadata: target.metadata,
          createdById: caller.id
        }
      });
      await tx.post.update({
        where: { id },
        data: {
          currentRevisionId: newRevision.id,
          ...wasPublished ? { status: "DRAFT", publishedAt: null } : {}
        }
      });
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_REVERTED",
      resourceType: "post",
      resourceId: id,
      beforeData: { fromVersion: current?.version, revertedToRevisionId: target.id, revertedToVersion: target.version },
      afterData: { newVersion: nextVersion },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPostOrThrow(id, organizationId);
  },
  async deletePost(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPostOrThrow(id, organizationId);
    await postRepository.softDelete(id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "POST_DELETED",
      resourceType: "post",
      resourceId: id,
      beforeData: { status: existing.status, title: existing.title },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/schemas/postSchemas.ts
import { z as z17 } from "zod";
var slugSchema4 = z17.string().trim().min(1).max(150).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)");
var createPostSchema = z17.object({
  title: z17.string().trim().min(1).max(200),
  slug: slugSchema4.optional(),
  body: z17.string().trim().max(5e5).default(""),
  metadata: z17.record(z17.unknown()).optional(),
  categoryId: z17.string().trim().uuid().optional(),
  authorId: z17.string().trim().uuid().optional(),
  tagIds: z17.array(z17.string().trim().uuid()).max(50).optional(),
  featuredMediaId: z17.string().trim().uuid().optional()
});
var updatePostSchema = z17.object({
  title: z17.string().trim().min(1).max(200).optional(),
  slug: slugSchema4.optional(),
  body: z17.string().trim().max(5e5).optional(),
  metadata: z17.record(z17.unknown()).optional(),
  status: patchableContentStatusSchema.optional(),
  categoryId: z17.string().trim().uuid().nullable().optional(),
  authorId: z17.string().trim().uuid().nullable().optional(),
  tagIds: z17.array(z17.string().trim().uuid()).max(50).optional(),
  featuredMediaId: z17.string().trim().uuid().nullable().optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema
}).refine((v) => Object.keys(v).filter((k) => k !== "expectedUpdatedAt").length > 0, { message: "At least one field must be provided." });
var listPostsQuerySchema = z17.object({
  page: z17.coerce.number().int().positive().default(1),
  limit: z17.coerce.number().int().positive().max(100).default(20),
  search: z17.string().trim().max(200).optional(),
  status: z17.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  categoryId: z17.string().trim().uuid().optional(),
  tagId: z17.string().trim().uuid().optional(),
  sort: z17.enum(["title", "slug", "status", "createdAt", "updatedAt", "publishedAt"]).default("updatedAt"),
  order: z17.enum(["asc", "desc"]).default("desc")
});

// server/routes/v1/postRoutes.ts
var router19 = Router19();
router19.use(authenticateToken);
function requestMeta11(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router19.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const query = listPostsQuerySchema.parse(req.query);
    const { rows, total } = await postService.listPosts(
      req.user.organizationId,
      { search: query.search, status: query.status, categoryId: query.categoryId, tagId: query.tagId },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { posts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router19.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const post = await postService.getPost(req.user.organizationId, req.params.id);
    sendSuccess(res, { post });
  })
);
router19.get(
  "/:id/revisions",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const revisions = await postService.listRevisions(req.user.organizationId, req.params.id);
    sendSuccess(res, { revisions });
  })
);
router19.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createPostSchema.parse(req.body);
    const post = await postService.createPost(req.user, input, requestMeta11(req));
    sendSuccess(res, { post }, 201);
  })
);
router19.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updatePostSchema.parse(req.body);
    const post = await postService.updatePost(req.user, req.params.id, input, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.post(
  "/:id/submit-review",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const post = await postService.submitForReview(req.user, req.params.id, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.post(
  "/:id/publish",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const post = await postService.publishPost(req.user, req.params.id, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.post(
  "/:id/schedule",
  requirePermission("content.publish"),
  asyncHandler(async (req, res) => {
    const input = scheduleContentSchema.parse(req.body);
    const post = await postService.schedulePost(req.user, req.params.id, input, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.post(
  "/:id/archive",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    const post = await postService.archivePost(req.user, req.params.id, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.post(
  "/:id/revert",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = revertContentSchema.parse(req.body);
    const post = await postService.revertPost(req.user, req.params.id, input, requestMeta11(req));
    sendSuccess(res, { post });
  })
);
router19.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await postService.deletePost(req.user, req.params.id, requestMeta11(req));
    sendSuccess(res, { message: "Post deleted." });
  })
);
var postRoutes_default = router19;

// server/routes/v1/categoryRoutes.ts
import { Router as Router20 } from "express";

// server/services/categoryService.ts
function isUniqueConstraintError5(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}
async function loadCategoryOrThrow(id, organizationId) {
  const category = await categoryRepository.findByIdInOrg(id, organizationId);
  if (!category) throw new NotFoundError("Category not found.");
  return category;
}
var categoryService = {
  async listCategories(organizationId) {
    return categoryRepository.list(organizationId);
  },
  async getCategory(organizationId, id) {
    return loadCategoryOrThrow(id, organizationId);
  },
  async createCategory(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    if (input.slug) {
      const dup = await categoryRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A category with slug "${input.slug}" already exists.`, { existingCategoryId: dup.id });
    }
    const slug = input.slug ?? await categoryRepository.findUniqueSlugInOrg(organizationId, input.name);
    let category;
    try {
      category = await categoryRepository.create({ organizationId, name: input.name, slug, description: input.description });
    } catch (err) {
      throw isUniqueConstraintError5(err) ? new ConflictError("A category with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_CREATED",
      resourceType: "category",
      resourceId: category.id,
      afterData: { name: category.name, slug: category.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return category;
  },
  async updateCategory(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadCategoryOrThrow(id, organizationId);
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await categoryRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A category with slug "${input.slug}" already exists.`, { existingCategoryId: dup.id });
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.slug !== void 0) patch.slug = input.slug;
    if (input.description !== void 0) patch.description = input.description;
    let updated;
    try {
      updated = await categoryRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError5(err) ? new ConflictError("A category with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_UPDATED",
      resourceType: "category",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async deleteCategory(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadCategoryOrThrow(id, organizationId);
    await categoryRepository.delete(id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CATEGORY_DELETED",
      resourceType: "category",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/routes/v1/categoryRoutes.ts
var router20 = Router20();
router20.use(authenticateToken);
function requestMeta12(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router20.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const categories = await categoryService.listCategories(req.user.organizationId);
    sendSuccess(res, { categories });
  })
);
router20.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const category = await categoryService.getCategory(req.user.organizationId, req.params.id);
    sendSuccess(res, { category });
  })
);
router20.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createCategorySchema.parse(req.body);
    const category = await categoryService.createCategory(req.user, input, requestMeta12(req));
    sendSuccess(res, { category }, 201);
  })
);
router20.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updateCategorySchema.parse(req.body);
    const category = await categoryService.updateCategory(req.user, req.params.id, input, requestMeta12(req));
    sendSuccess(res, { category });
  })
);
router20.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await categoryService.deleteCategory(req.user, req.params.id, requestMeta12(req));
    sendSuccess(res, { message: "Category deleted." });
  })
);
var categoryRoutes_default = router20;

// server/routes/v1/tagRoutes.ts
import { Router as Router21 } from "express";

// server/services/tagService.ts
function isUniqueConstraintError6(err) {
  return !!err && typeof err === "object" && "code" in err && err.code === "P2002";
}
async function loadTagOrThrow(id, organizationId) {
  const tag = await tagRepository.findByIdInOrg(id, organizationId);
  if (!tag) throw new NotFoundError("Tag not found.");
  return tag;
}
var tagService = {
  async listTags(organizationId) {
    return tagRepository.list(organizationId);
  },
  async getTag(organizationId, id) {
    return loadTagOrThrow(id, organizationId);
  },
  async createTag(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    if (input.slug) {
      const dup = await tagRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup) throw new ConflictError(`A tag with slug "${input.slug}" already exists.`, { existingTagId: dup.id });
    }
    const slug = input.slug ?? await tagRepository.findUniqueSlugInOrg(organizationId, input.name);
    let tag;
    try {
      tag = await tagRepository.create({ organizationId, name: input.name, slug });
    } catch (err) {
      throw isUniqueConstraintError6(err) ? new ConflictError("A tag with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TAG_CREATED",
      resourceType: "tag",
      resourceId: tag.id,
      afterData: { name: tag.name, slug: tag.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return tag;
  },
  async updateTag(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadTagOrThrow(id, organizationId);
    if (input.slug !== void 0 && input.slug !== existing.slug) {
      const dup = await tagRepository.findBySlugInOrg(organizationId, input.slug);
      if (dup && dup.id !== id) throw new ConflictError(`A tag with slug "${input.slug}" already exists.`, { existingTagId: dup.id });
    }
    const patch = {};
    if (input.name !== void 0) patch.name = input.name;
    if (input.slug !== void 0) patch.slug = input.slug;
    let updated;
    try {
      updated = await tagRepository.update(id, patch);
    } catch (err) {
      throw isUniqueConstraintError6(err) ? new ConflictError("A tag with this slug already exists.") : err;
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TAG_UPDATED",
      resourceType: "tag",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  },
  async deleteTag(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadTagOrThrow(id, organizationId);
    await tagRepository.delete(id);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "TAG_DELETED",
      resourceType: "tag",
      resourceId: id,
      beforeData: { name: existing.name, slug: existing.slug },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/routes/v1/tagRoutes.ts
var router21 = Router21();
router21.use(authenticateToken);
function requestMeta13(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router21.get(
  "/",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const tags = await tagService.listTags(req.user.organizationId);
    sendSuccess(res, { tags });
  })
);
router21.get(
  "/:id",
  requirePermission("content.read"),
  asyncHandler(async (req, res) => {
    const tag = await tagService.getTag(req.user.organizationId, req.params.id);
    sendSuccess(res, { tag });
  })
);
router21.post(
  "/",
  requirePermission("content.create"),
  asyncHandler(async (req, res) => {
    const input = createTagSchema.parse(req.body);
    const tag = await tagService.createTag(req.user, input, requestMeta13(req));
    sendSuccess(res, { tag }, 201);
  })
);
router21.patch(
  "/:id",
  requirePermission("content.update"),
  asyncHandler(async (req, res) => {
    const input = updateTagSchema.parse(req.body);
    const tag = await tagService.updateTag(req.user, req.params.id, input, requestMeta13(req));
    sendSuccess(res, { tag });
  })
);
router21.delete(
  "/:id",
  requirePermission("content.delete"),
  asyncHandler(async (req, res) => {
    await tagService.deleteTag(req.user, req.params.id, requestMeta13(req));
    sendSuccess(res, { message: "Tag deleted." });
  })
);
var tagRoutes_default = router21;

// server/routes/v1/authorRoutes.ts
import { Router as Router22 } from "express";

// server/repositories/authorRepository.ts
var withUser = { include: { user: { select: { id: true, email: true, firstName: true, lastName: true, displayName: true, status: true } } } };
var authorRepository = {
  async list() {
    return prisma.author.findMany({ ...withUser, orderBy: { createdAt: "desc" } });
  },
  async findById(id) {
    return prisma.author.findUnique({ where: { id }, ...withUser });
  },
  async findByUserId(userId) {
    return prisma.author.findUnique({ where: { userId } });
  },
  async create(data) {
    return prisma.author.create({ data, ...withUser });
  },
  async update(id, data) {
    return prisma.author.update({ where: { id }, data, ...withUser });
  }
};

// server/services/authorService.ts
async function loadAuthorOrThrow(id) {
  const author = await authorRepository.findById(id);
  if (!author) throw new NotFoundError("Author not found.");
  return author;
}
var authorService = {
  async listAuthors() {
    return authorRepository.list();
  },
  async getAuthor(id) {
    return loadAuthorOrThrow(id);
  },
  async createAuthor(caller, input, meta = {}) {
    const user = await userRepository.findById(input.userId);
    if (!user) throw new ValidationError("userId does not refer to an existing user.");
    const existing = await authorRepository.findByUserId(input.userId);
    if (existing) throw new ConflictError("This user already has an author profile.", { existingAuthorId: existing.id });
    const author = await authorRepository.create({ userId: input.userId, bio: input.bio, avatarUrl: input.avatarUrl });
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "AUTHOR_CREATED",
      resourceType: "author",
      resourceId: author.id,
      afterData: { userId: input.userId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return author;
  },
  async updateAuthor(caller, id, input, meta = {}) {
    const existing = await loadAuthorOrThrow(id);
    const patch = {};
    if (input.bio !== void 0) patch.bio = input.bio;
    if (input.avatarUrl !== void 0) patch.avatarUrl = input.avatarUrl;
    const updated = await authorRepository.update(id, patch);
    await auditLogRepository.record({
      actorUserId: caller.id,
      actorType: "USER",
      action: "AUTHOR_UPDATED",
      resourceType: "author",
      resourceId: id,
      beforeData: { bio: existing.bio, avatarUrl: existing.avatarUrl },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return updated;
  }
};

// server/schemas/authorSchemas.ts
import { z as z18 } from "zod";
var createAuthorSchema = z18.object({
  userId: z18.string().trim().uuid(),
  bio: z18.string().trim().max(2e3).optional(),
  avatarUrl: z18.string().trim().url().max(500).optional()
});
var updateAuthorSchema = z18.object({
  bio: z18.string().trim().max(2e3).nullable().optional(),
  avatarUrl: z18.string().trim().url().max(500).nullable().optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/routes/v1/authorRoutes.ts
var router22 = Router22();
router22.use(authenticateToken);
function requestMeta14(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router22.get(
  "/",
  requirePermission("authors.read"),
  asyncHandler(async (_req, res) => {
    const authors = await authorService.listAuthors();
    sendSuccess(res, { authors });
  })
);
router22.get(
  "/:id",
  requirePermission("authors.read"),
  asyncHandler(async (req, res) => {
    const author = await authorService.getAuthor(req.params.id);
    sendSuccess(res, { author });
  })
);
router22.post(
  "/",
  requirePermission("authors.create"),
  asyncHandler(async (req, res) => {
    const input = createAuthorSchema.parse(req.body);
    const author = await authorService.createAuthor(req.user, input, requestMeta14(req));
    sendSuccess(res, { author }, 201);
  })
);
router22.patch(
  "/:id",
  requirePermission("authors.update"),
  asyncHandler(async (req, res) => {
    const input = updateAuthorSchema.parse(req.body);
    const author = await authorService.updateAuthor(req.user, req.params.id, input, requestMeta14(req));
    sendSuccess(res, { author });
  })
);
var authorRoutes_default = router22;

// server/routes/v1/mediaRoutes.ts
import { Router as Router23 } from "express";
import express2 from "express";

// server/schemas/mediaSchemas.ts
import { z as z19 } from "zod";
var SORT_FIELDS3 = ["originalFilename", "displayName", "mimeType", "sizeBytes", "status", "createdAt", "updatedAt"];
var listMediaQuerySchema = z19.object({
  page: z19.coerce.number().int().positive().default(1),
  limit: z19.coerce.number().int().positive().max(100).default(20),
  search: z19.string().trim().max(200).optional(),
  status: z19.enum(["PENDING", "ACTIVE", "FAILED", "ARCHIVED"]).optional(),
  mimeType: z19.enum(ALLOWED_MIME_TYPES).optional(),
  uploadedById: z19.string().trim().uuid().optional(),
  dateFrom: z19.coerce.date().optional(),
  dateTo: z19.coerce.date().optional(),
  sort: z19.enum(SORT_FIELDS3).default("createdAt"),
  order: z19.enum(["asc", "desc"]).default("desc")
});
var createUploadSessionSchema = z19.object({
  filename: z19.string().trim().min(1).max(255),
  mimeType: z19.enum(ALLOWED_MIME_TYPES),
  sizeBytes: z19.number().int().positive(),
  displayName: z19.string().trim().max(255).optional(),
  altText: z19.string().trim().max(500).optional(),
  caption: z19.string().trim().max(1e3).optional()
});
var completeUploadSchema = z19.object({
  token: z19.string().trim().min(1)
});
var updateMediaSchema = z19.object({
  displayName: z19.string().trim().max(255).nullable().optional(),
  altText: z19.string().trim().max(500).nullable().optional(),
  caption: z19.string().trim().max(1e3).nullable().optional(),
  visibility: z19.enum(["PRIVATE", "PUBLIC"]).optional()
}).refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided." });

// server/routes/v1/mediaRoutes.ts
var router23 = Router23();
function requestMeta15(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router23.put(
  "/local-object",
  express2.raw({ type: () => true, limit: Math.max(config.mediaMaxImageSizeBytes, config.mediaMaxDocumentSizeBytes) }),
  asyncHandler(async (req, res) => {
    if (getStorageProvider().name !== "local") {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const key = String(req.query.key ?? "");
    const exp = Number(req.query.exp ?? 0);
    const sig = String(req.query.sig ?? "");
    if (!key || !exp || !sig || !verifyLocalStorageToken("upload", key, exp, sig)) {
      res.status(403).json({ error: "Invalid or expired upload authorization." });
      return;
    }
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    await localFilesystemStorageProvider.writeObject(key, body);
    res.status(200).json({ ok: true });
  })
);
router23.get(
  "/local-object",
  asyncHandler(async (req, res) => {
    if (getStorageProvider().name !== "local") {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const key = String(req.query.key ?? "");
    const exp = Number(req.query.exp ?? 0);
    const sig = String(req.query.sig ?? "");
    if (!key || !exp || !sig || !verifyLocalStorageToken("read", key, exp, sig)) {
      res.status(403).json({ error: "Invalid or expired read authorization." });
      return;
    }
    try {
      const bytes = await localFilesystemStorageProvider.readObject(key);
      res.status(200).end(bytes);
    } catch {
      res.status(404).json({ error: "Object not found." });
    }
  })
);
router23.use(authenticateToken);
router23.get(
  "/",
  requirePermission("media.read"),
  asyncHandler(async (req, res) => {
    const query = listMediaQuerySchema.parse(req.query);
    const { rows, total } = await mediaService.listMedia(
      req.user.organizationId,
      { search: query.search, status: query.status, mimeType: query.mimeType, uploadedById: query.uploadedById, dateFrom: query.dateFrom, dateTo: query.dateTo },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { media: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router23.get(
  "/:id",
  requirePermission("media.read"),
  asyncHandler(async (req, res) => {
    const media = await mediaService.getMedia(req.user.organizationId, req.params.id);
    sendSuccess(res, { media });
  })
);
router23.get(
  "/:id/url",
  requirePermission("media.read"),
  asyncHandler(async (req, res) => {
    const result = await mediaService.getReadUrl(req.user, req.params.id, requestMeta15(req));
    sendSuccess(res, result);
  })
);
router23.post(
  "/upload-session",
  requirePermission("media.upload"),
  asyncHandler(async (req, res) => {
    const input = createUploadSessionSchema.parse(req.body);
    const result = await mediaService.createUploadSession(req.user, input, requestMeta15(req));
    sendSuccess(res, result, 201);
  })
);
router23.post(
  "/:id/complete",
  requirePermission("media.upload"),
  asyncHandler(async (req, res) => {
    const input = completeUploadSchema.parse(req.body);
    if (!input.token) throw new ValidationError("token is required.");
    const media = await mediaService.completeUpload(req.user, req.params.id, input.token, requestMeta15(req));
    sendSuccess(res, { media });
  })
);
router23.patch(
  "/:id",
  requirePermission("media.update"),
  asyncHandler(async (req, res) => {
    const input = updateMediaSchema.parse(req.body);
    const media = await mediaService.updateMedia(req.user, req.params.id, input, requestMeta15(req));
    sendSuccess(res, { media });
  })
);
router23.post(
  "/:id/archive",
  requirePermission("media.delete"),
  asyncHandler(async (req, res) => {
    const media = await mediaService.archiveMedia(req.user, req.params.id, requestMeta15(req));
    sendSuccess(res, { media });
  })
);
router23.delete(
  "/:id",
  requirePermission("media.delete"),
  asyncHandler(async (req, res) => {
    await mediaService.deleteMedia(req.user, req.params.id, requestMeta15(req));
    sendSuccess(res, { message: "Media deleted." });
  })
);
var mediaRoutes_default = router23;

// server/routes/v1/contractRoutes.ts
import { Router as Router24 } from "express";

// server/repositories/contractRepository.ts
var withVariations = { include: { variations: { orderBy: { variationNumber: "asc" } } } };
function buildWhere9(organizationId, filters) {
  const where = { organizationId };
  if (filters.status) where.status = filters.status;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.search) {
    where.OR = [
      { contractNumber: { contains: filters.search, mode: "insensitive" } },
      { title: { contains: filters.search, mode: "insensitive" } }
    ];
  }
  return where;
}
var contractRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere9(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.contract.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit, ...withVariations }),
      prisma.contract.count({ where })
    ]);
    return { rows, total };
  },
  /** The only lookup-by-id this module exposes — always organization-scoped (§25 IDOR requirement). */
  async findByIdInOrg(id, organizationId) {
    return prisma.contract.findFirst({ where: { id, organizationId }, ...withVariations });
  },
  async listForClientInOrg(clientId, organizationId) {
    return prisma.contract.findMany({ where: { clientId, organizationId }, orderBy: { createdAt: "desc" } });
  },
  async create(data) {
    return prisma.contract.create({ data });
  },
  async update(id, data) {
    return prisma.contract.update({ where: { id }, data });
  },
  /**
   * Race-safe conditional status transition — `WHERE id = ? AND status IN
   * (...)`, the same conditional-updateMany-plus-row-count pattern used
   * throughout this codebase since Phase 5 (lead conversion, workspace
   * provisioning, CMS optimistic concurrency, Phase 9 media). Returns the
   * affected row count so the caller can distinguish a genuine race from
   * success without a separate read-then-write.
   */
  async transitionStatus(id, fromStatuses, toStatus) {
    const result = await prisma.contract.updateMany({
      where: { id, status: { in: fromStatuses } },
      data: { status: toStatus }
    });
    return result.count;
  },
  async createVariation(data) {
    return prisma.contractVariation.create({ data });
  },
  async lastVariationNumber(tx, contractId) {
    const last = await tx.contractVariation.findFirst({ where: { contractId }, orderBy: { variationNumber: "desc" } });
    return last?.variationNumber ?? 0;
  },
  /** Row-locks the parent Contract so concurrent variation creates against the same contract serialize instead of racing on `variationNumber` (§37). */
  async lockForVariation(tx, id) {
    await tx.$queryRaw`SELECT id FROM contracts WHERE id = ${id} FOR UPDATE`;
  }
};

// server/utils/money.ts
import { Prisma as Prisma4 } from "@prisma/client";
var MONEY_DECIMALS = 3;
var DEFAULT_CURRENCY = "OMR";
function toMoney(value) {
  return new Prisma4.Decimal(value);
}
var ZERO = toMoney(0);
function roundMoney(value) {
  return new Prisma4.Decimal(value).toDecimalPlaces(MONEY_DECIMALS, Prisma4.Decimal.ROUND_HALF_UP);
}
function addMoney(a, b) {
  return roundMoney(new Prisma4.Decimal(a).plus(b));
}
function subtractMoney(a, b) {
  return roundMoney(new Prisma4.Decimal(a).minus(b));
}
function sumMoney(values) {
  return roundMoney(values.reduce((acc, v) => acc.plus(v), new Prisma4.Decimal(0)));
}
function multiplyMoney(unitPrice, quantity) {
  return roundMoney(new Prisma4.Decimal(unitPrice).times(quantity));
}
function isPositive(value) {
  return new Prisma4.Decimal(value).greaterThan(0);
}
function isNonNegative(value) {
  return new Prisma4.Decimal(value).greaterThanOrEqualTo(0);
}
function assertSameCurrency(a, b, context = "these records") {
  if (a !== b) {
    throw new ValidationError(`Currency mismatch: ${context} use different currencies (${a} vs ${b}).`);
  }
}

// server/services/billingCalculations.ts
function calculateLineItem(input) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new ValidationError("Line item quantity must be a positive integer.");
  }
  const gross = multiplyMoney(input.unitPrice, input.quantity);
  const lineTotal = subtractMoney(gross, input.discount);
  if (!isNonNegative(lineTotal)) {
    throw new ValidationError("A line item's discount cannot exceed its quantity \xD7 unit price.");
  }
  return { ...input, lineTotal };
}
function calculateInvoiceTotals(lines, invoiceDiscount, tax) {
  const subtotal = sumMoney(lines.map((l) => l.lineTotal));
  const total = addMoney(subtractMoney(subtotal, invoiceDiscount), tax);
  if (!isNonNegative(total)) {
    throw new ValidationError("Invoice discount cannot exceed subtotal plus tax.");
  }
  return { subtotal, total };
}
function calculateInvoiceBalance(total, completedPaymentAmounts) {
  const amountPaid = sumMoney(completedPaymentAmounts);
  const amountDue = subtractMoney(total, amountPaid);
  return { amountPaid, amountDue: isNonNegative(amountDue) ? amountDue : toMoney(0) };
}
function calculateContractCurrentValue(originalValue, variationAmounts) {
  return addMoney(originalValue, sumMoney(variationAmounts));
}
function effectiveInvoiceStatus(invoice, now = /* @__PURE__ */ new Date()) {
  if ((invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID") && invoice.dueDate.getTime() < now.getTime()) {
    return "OVERDUE";
  }
  return invoice.status;
}

// server/utils/sequence.ts
var SEQUENCES = {
  contract: "contract_number_seq",
  subscription: "subscription_number_seq",
  invoice: "invoice_number_seq"
};
async function nextSequenceValue(kind) {
  const rows = await prisma.$queryRawUnsafe(`SELECT nextval('${SEQUENCES[kind]}') AS nextval`);
  return Number(rows[0].nextval);
}
function pad(value) {
  return String(value).padStart(6, "0");
}
async function nextContractNumber() {
  return `CTR-${pad(await nextSequenceValue("contract"))}`;
}
async function nextSubscriptionNumber() {
  return `SUB-${pad(await nextSequenceValue("subscription"))}`;
}
async function nextInvoiceNumber() {
  return `INV-${pad(await nextSequenceValue("invoice"))}`;
}

// server/services/contractService.ts
var ACTIVATABLE_FROM = ["DRAFT", "SUSPENDED"];
var SUSPENDABLE_FROM = ["ACTIVE"];
var TERMINABLE_FROM = ["DRAFT", "ACTIVE", "SUSPENDED"];
function withCurrentValue(contract) {
  return { ...contract, currentValue: calculateContractCurrentValue(contract.contractValue, contract.variations.map((v) => v.amount)) };
}
async function loadContractOrThrow(id, organizationId) {
  const contract = await contractRepository.findByIdInOrg(id, organizationId);
  if (!contract) throw new NotFoundError("Contract not found.");
  return contract;
}
async function assertClientInOrg2(clientId, organizationId) {
  const client3 = await clientRepository.findByIdInOrg(clientId, organizationId);
  if (!client3) throw new ValidationError("The specified client does not exist in this organization.");
}
var contractService = {
  async listContracts(organizationId, filters, page, limit, sort, order) {
    const { rows, total } = await contractRepository.list(organizationId, filters, page, limit, sort, order);
    return { rows: rows.map(withCurrentValue), total };
  },
  async getContract(organizationId, id) {
    return withCurrentValue(await loadContractOrThrow(id, organizationId));
  },
  async createContract(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    await assertClientInOrg2(input.clientId, organizationId);
    if (input.endDate && input.endDate.getTime() < input.startDate.getTime()) {
      throw new ValidationError("endDate cannot be before startDate.");
    }
    const contractNumber = await nextContractNumber();
    const contract = await contractRepository.create({
      contractNumber,
      organizationId,
      clientId: input.clientId,
      title: input.title,
      description: input.description,
      startDate: input.startDate,
      endDate: input.endDate,
      contractValue: toMoney(input.contractValue),
      currency: input.currency ?? DEFAULT_CURRENCY,
      notes: input.notes,
      createdById: caller.id
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_CREATED",
      resourceType: "contract",
      resourceId: contract.id,
      afterData: { contractNumber, clientId: input.clientId, contractValue: contract.contractValue.toString(), currency: contract.currency },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, contract.id);
  },
  async updateContract(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    if (existing.status === "TERMINATED" || existing.status === "EXPIRED") {
      throw new ConflictError(`A ${existing.status.toLowerCase()} contract can no longer be edited.`);
    }
    const patch = {};
    if (input.title !== void 0) patch.title = input.title;
    if (input.description !== void 0) patch.description = input.description;
    if (input.endDate !== void 0) patch.endDate = input.endDate;
    if (input.notes !== void 0) patch.notes = input.notes;
    const where = { id, ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {} };
    const result = await prisma.contract.updateMany({ where, data: patch });
    if (result.count === 0) {
      throw new ConflictError("This contract was changed by someone else since you loaded it. Reload and try again.");
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_UPDATED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { title: existing.title },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, id);
  },
  async activateContract(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    const count = await contractRepository.transitionStatus(id, ACTIVATABLE_FROM, "ACTIVE");
    if (count === 0) throw new ConflictError(`Contract cannot move from ${existing.status} to ACTIVE.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_ACTIVATED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ACTIVE" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, id);
  },
  async suspendContract(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    const count = await contractRepository.transitionStatus(id, SUSPENDABLE_FROM, "SUSPENDED");
    if (count === 0) throw new ConflictError(`Contract cannot move from ${existing.status} to SUSPENDED.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_SUSPENDED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "SUSPENDED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, id);
  },
  async terminateContract(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(id, organizationId);
    const count = await contractRepository.transitionStatus(id, TERMINABLE_FROM, "TERMINATED");
    if (count === 0) throw new ConflictError(`Contract cannot move from ${existing.status} to TERMINATED.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_TERMINATED",
      resourceType: "contract",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "TERMINATED", reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, id);
  },
  async createVariation(caller, contractId, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadContractOrThrow(contractId, organizationId);
    if (existing.status === "TERMINATED" || existing.status === "EXPIRED") {
      throw new ConflictError(`A ${existing.status.toLowerCase()} contract can no longer be varied.`);
    }
    const amount = toMoney(input.amount);
    if (amount.isZero()) throw new ValidationError("A contract variation's amount cannot be zero.");
    await prisma.$transaction(async (tx) => {
      await contractRepository.lockForVariation(tx, contractId);
      const nextNumber = await contractRepository.lastVariationNumber(tx, contractId) + 1;
      await tx.contractVariation.create({
        data: { contractId, variationNumber: nextNumber, amount, effectiveDate: input.effectiveDate, reason: input.reason, createdById: caller.id }
      });
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "CONTRACT_VARIATION_CREATED",
      resourceType: "contract",
      resourceId: contractId,
      afterData: { amount: amount.toString(), effectiveDate: input.effectiveDate, reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getContract(organizationId, contractId);
  }
};

// server/schemas/contractSchemas.ts
import { z as z21 } from "zod";

// server/schemas/commercialSchemas.ts
import { z as z20 } from "zod";
var expectedUpdatedAtSchema2 = z20.coerce.date().optional();
var currencyCodeSchema = z20.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "currency must be a 3-letter ISO 4217 code").default(DEFAULT_CURRENCY);
var moneyAmountSchema = z20.union([z20.string(), z20.number()]).transform((v) => String(v).trim()).refine((v) => /^\d+(\.\d{1,3})?$/.test(v), { message: "amount must be a non-negative number with at most 3 decimal places" });
var signedMoneyAmountSchema = z20.union([z20.string(), z20.number()]).transform((v) => String(v).trim()).refine((v) => /^-?\d+(\.\d{1,3})?$/.test(v), { message: "amount must be a number with at most 3 decimal places" });
var SORT_ORDER = ["asc", "desc"];
function paginationQuerySchema(sortFields, defaultSort, defaultOrder = "desc") {
  return {
    page: z20.coerce.number().int().positive().default(1),
    limit: z20.coerce.number().int().positive().max(100).default(20),
    search: z20.string().trim().max(200).optional(),
    sort: z20.enum(sortFields).default(defaultSort),
    order: z20.enum(SORT_ORDER).default(defaultOrder)
  };
}

// server/schemas/contractSchemas.ts
var contractStatusSchema = z21.enum(["DRAFT", "ACTIVE", "SUSPENDED", "EXPIRED", "TERMINATED"]);
var SORT_FIELDS4 = ["contractNumber", "title", "status", "startDate", "endDate", "createdAt", "updatedAt"];
var listContractsQuerySchema = z21.object({
  ...paginationQuerySchema(SORT_FIELDS4, "createdAt"),
  status: contractStatusSchema.optional(),
  clientId: z21.string().trim().uuid().optional()
});
var createContractSchema = z21.object({
  clientId: z21.string().trim().uuid(),
  title: z21.string().trim().min(1).max(200),
  description: z21.string().trim().max(5e3).optional(),
  startDate: z21.coerce.date(),
  endDate: z21.coerce.date().optional(),
  contractValue: moneyAmountSchema,
  currency: currencyCodeSchema.optional(),
  notes: z21.string().trim().max(5e3).optional()
});
var updateContractSchema = z21.object({
  title: z21.string().trim().min(1).max(200).optional(),
  description: z21.string().trim().max(5e3).nullable().optional(),
  endDate: z21.coerce.date().nullable().optional(),
  notes: z21.string().trim().max(5e3).nullable().optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema2
}).refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt"), { message: "At least one field must be provided." });
var terminateContractSchema = z21.object({
  reason: z21.string().trim().min(1).max(1e3)
});
var createContractVariationSchema = z21.object({
  amount: signedMoneyAmountSchema,
  effectiveDate: z21.coerce.date(),
  reason: z21.string().trim().min(1).max(1e3)
});

// server/routes/v1/contractRoutes.ts
var router24 = Router24();
router24.use(authenticateToken);
function requestMeta16(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router24.get(
  "/",
  requirePermission("contracts.read"),
  asyncHandler(async (req, res) => {
    const query = listContractsQuerySchema.parse(req.query);
    const { rows, total } = await contractService.listContracts(
      req.user.organizationId,
      { search: query.search, status: query.status, clientId: query.clientId },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { contracts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router24.get(
  "/:id",
  requirePermission("contracts.read"),
  asyncHandler(async (req, res) => {
    const contract = await contractService.getContract(req.user.organizationId, req.params.id);
    sendSuccess(res, { contract });
  })
);
router24.post(
  "/",
  requirePermission("contracts.create"),
  asyncHandler(async (req, res) => {
    const input = createContractSchema.parse(req.body);
    const contract = await contractService.createContract(req.user, input, requestMeta16(req));
    sendSuccess(res, { contract }, 201);
  })
);
router24.patch(
  "/:id",
  requirePermission("contracts.update"),
  asyncHandler(async (req, res) => {
    const input = updateContractSchema.parse(req.body);
    const contract = await contractService.updateContract(req.user, req.params.id, input, requestMeta16(req));
    sendSuccess(res, { contract });
  })
);
router24.post(
  "/:id/activate",
  requirePermission("contracts.activate"),
  asyncHandler(async (req, res) => {
    const contract = await contractService.activateContract(req.user, req.params.id, requestMeta16(req));
    sendSuccess(res, { contract });
  })
);
router24.post(
  "/:id/suspend",
  requirePermission("contracts.suspend"),
  asyncHandler(async (req, res) => {
    const contract = await contractService.suspendContract(req.user, req.params.id, requestMeta16(req));
    sendSuccess(res, { contract });
  })
);
router24.post(
  "/:id/terminate",
  requirePermission("contracts.terminate"),
  asyncHandler(async (req, res) => {
    const input = terminateContractSchema.parse(req.body);
    const contract = await contractService.terminateContract(req.user, req.params.id, input, requestMeta16(req));
    sendSuccess(res, { contract });
  })
);
router24.post(
  "/:id/variations",
  requirePermission("contracts.variations.create"),
  asyncHandler(async (req, res) => {
    const input = createContractVariationSchema.parse(req.body);
    const contract = await contractService.createVariation(req.user, req.params.id, input, requestMeta16(req));
    sendSuccess(res, { contract }, 201);
  })
);
var contractRoutes_default = router24;

// server/routes/v1/subscriptionRoutes.ts
import { Router as Router25 } from "express";

// server/repositories/subscriptionRepository.ts
var withItems = { include: { items: true } };
function buildWhere10(organizationId, filters) {
  const where = { organizationId };
  if (filters.status) where.status = filters.status;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.productId) where.productId = filters.productId;
  if (filters.search) where.subscriptionNumber = { contains: filters.search, mode: "insensitive" };
  return where;
}
var subscriptionRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere10(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.subscription.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.subscription.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.subscription.findFirst({ where: { id, organizationId }, ...withItems });
  },
  async listForClientInOrg(clientId, organizationId) {
    return prisma.subscription.findMany({ where: { clientId, organizationId }, orderBy: { createdAt: "desc" } });
  },
  async create(data, items) {
    return prisma.subscription.create({
      data: {
        subscriptionNumber: data.subscriptionNumber,
        organizationId: data.organizationId,
        clientId: data.clientId,
        productId: data.productId,
        startDate: data.startDate,
        billingCycle: data.billingCycle,
        quantity: data.quantity,
        price: data.price,
        currency: data.currency,
        createdById: data.createdById,
        items: { create: items }
      },
      ...withItems
    });
  },
  async update(id, data) {
    return prisma.subscription.update({ where: { id }, data });
  },
  /** Race-safe conditional status transition — see contractRepository.transitionStatus for the pattern rationale. */
  async transitionStatus(id, fromStatuses, data) {
    const result = await prisma.subscription.updateMany({
      where: { id, status: { in: fromStatuses } },
      data
    });
    return result.count;
  }
};

// server/services/subscriptionService.ts
var ACTIVATABLE_FROM2 = ["DRAFT", "TRIALING", "PAUSED"];
var PAUSABLE_FROM = ["ACTIVE", "PAST_DUE"];
var CANCELLABLE_FROM = ["DRAFT", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"];
async function loadSubscriptionOrThrow(id, organizationId) {
  const subscription = await subscriptionRepository.findByIdInOrg(id, organizationId);
  if (!subscription) throw new NotFoundError("Subscription not found.");
  return subscription;
}
var subscriptionService = {
  async listSubscriptions(organizationId, filters, page, limit, sort, order) {
    return subscriptionRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getSubscription(organizationId, id) {
    return loadSubscriptionOrThrow(id, organizationId);
  },
  async createSubscription(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    const client3 = await clientRepository.findByIdInOrg(input.clientId, organizationId);
    if (!client3) throw new ValidationError("The specified client does not exist in this organization.");
    const product = await productRepository.findById(input.productId);
    if (!product) throw new ValidationError("The specified product does not exist.");
    const currency = input.currency ?? DEFAULT_CURRENCY;
    for (const item of input.items) {
      if (item.productModuleId) {
        const module_ = await productModuleRepository.findByIdForProduct(item.productModuleId, input.productId);
        if (!module_) throw new ValidationError(`Product module ${item.productModuleId} does not belong to the selected product.`);
      }
    }
    const subscriptionNumber = await nextSubscriptionNumber();
    const subscription = await subscriptionRepository.create(
      {
        subscriptionNumber,
        organizationId,
        clientId: input.clientId,
        productId: input.productId,
        startDate: input.startDate,
        billingCycle: input.billingCycle,
        quantity: input.quantity,
        price: toMoney(input.price),
        currency,
        createdById: caller.id
      },
      input.items.map((item) => ({
        productModuleId: item.productModuleId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: toMoney(item.unitPrice),
        currency
      }))
    );
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_CREATED",
      resourceType: "subscription",
      resourceId: subscription.id,
      afterData: { subscriptionNumber, clientId: input.clientId, productId: input.productId, price: subscription.price.toString(), currency },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return subscription;
  },
  async updateSubscription(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    if (existing.status === "CANCELLED" || existing.status === "EXPIRED") {
      throw new ConflictError(`A ${existing.status.toLowerCase()} subscription can no longer be edited.`);
    }
    const patch = {};
    if (input.renewalDate !== void 0) patch.renewalDate = input.renewalDate;
    if (input.endDate !== void 0) patch.endDate = input.endDate;
    if (input.quantity !== void 0) patch.quantity = input.quantity;
    if (input.price !== void 0) patch.price = toMoney(input.price);
    const where = { id, ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {} };
    const result = await prisma.subscription.updateMany({ where, data: patch });
    if (result.count === 0) {
      throw new ConflictError("This subscription was changed by someone else since you loaded it. Reload and try again.");
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_UPDATED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { quantity: existing.quantity, price: existing.price.toString() },
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadSubscriptionOrThrow(id, organizationId);
  },
  async activateSubscription(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    const count = await subscriptionRepository.transitionStatus(id, ACTIVATABLE_FROM2, { status: "ACTIVE" });
    if (count === 0) throw new ConflictError(`Subscription cannot move from ${existing.status} to ACTIVE.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_ACTIVATED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ACTIVE" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadSubscriptionOrThrow(id, organizationId);
  },
  async pauseSubscription(caller, id, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    const count = await subscriptionRepository.transitionStatus(id, PAUSABLE_FROM, { status: "PAUSED" });
    if (count === 0) throw new ConflictError(`Subscription cannot move from ${existing.status} to PAUSED.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_PAUSED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "PAUSED" },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadSubscriptionOrThrow(id, organizationId);
  },
  async cancelSubscription(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadSubscriptionOrThrow(id, organizationId);
    const now = /* @__PURE__ */ new Date();
    const count = await subscriptionRepository.transitionStatus(id, CANCELLABLE_FROM, {
      status: "CANCELLED",
      cancelledAt: now,
      cancellationReason: input.reason,
      cancelledById: caller.id
    });
    if (count === 0) throw new ConflictError(`Subscription cannot move from ${existing.status} to CANCELLED.`);
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "SUBSCRIPTION_CANCELLED",
      resourceType: "subscription",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "CANCELLED", reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadSubscriptionOrThrow(id, organizationId);
  }
};

// server/schemas/subscriptionSchemas.ts
import { z as z22 } from "zod";
var subscriptionStatusSchema = z22.enum(["DRAFT", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELLED", "EXPIRED"]);
var billingCycleSchema = z22.enum(["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL"]);
var SORT_FIELDS5 = ["subscriptionNumber", "status", "startDate", "renewalDate", "createdAt", "updatedAt"];
var listSubscriptionsQuerySchema = z22.object({
  ...paginationQuerySchema(SORT_FIELDS5, "createdAt"),
  status: subscriptionStatusSchema.optional(),
  clientId: z22.string().trim().uuid().optional(),
  productId: z22.string().trim().uuid().optional()
});
var subscriptionItemInputSchema = z22.object({
  productModuleId: z22.string().trim().uuid().optional(),
  description: z22.string().trim().min(1).max(500),
  quantity: z22.number().int().positive().default(1),
  unitPrice: moneyAmountSchema
});
var createSubscriptionSchema = z22.object({
  clientId: z22.string().trim().uuid(),
  productId: z22.string().trim().uuid(),
  startDate: z22.coerce.date(),
  billingCycle: billingCycleSchema,
  quantity: z22.number().int().positive().default(1),
  price: moneyAmountSchema,
  currency: currencyCodeSchema.optional(),
  items: z22.array(subscriptionItemInputSchema).default([])
});
var updateSubscriptionSchema = z22.object({
  renewalDate: z22.coerce.date().nullable().optional(),
  endDate: z22.coerce.date().nullable().optional(),
  quantity: z22.number().int().positive().optional(),
  price: moneyAmountSchema.optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema2
}).refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt"), { message: "At least one field must be provided." });
var cancelSubscriptionSchema = z22.object({
  reason: z22.string().trim().min(1).max(1e3)
});

// server/routes/v1/subscriptionRoutes.ts
var router25 = Router25();
router25.use(authenticateToken);
function requestMeta17(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router25.get(
  "/",
  requirePermission("subscriptions.read"),
  asyncHandler(async (req, res) => {
    const query = listSubscriptionsQuerySchema.parse(req.query);
    const { rows, total } = await subscriptionService.listSubscriptions(
      req.user.organizationId,
      { search: query.search, status: query.status, clientId: query.clientId, productId: query.productId },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { subscriptions: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router25.get(
  "/:id",
  requirePermission("subscriptions.read"),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.getSubscription(req.user.organizationId, req.params.id);
    sendSuccess(res, { subscription });
  })
);
router25.post(
  "/",
  requirePermission("subscriptions.create"),
  asyncHandler(async (req, res) => {
    const input = createSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.createSubscription(req.user, input, requestMeta17(req));
    sendSuccess(res, { subscription }, 201);
  })
);
router25.patch(
  "/:id",
  requirePermission("subscriptions.update"),
  asyncHandler(async (req, res) => {
    const input = updateSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.updateSubscription(req.user, req.params.id, input, requestMeta17(req));
    sendSuccess(res, { subscription });
  })
);
router25.post(
  "/:id/activate",
  requirePermission("subscriptions.activate"),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.activateSubscription(req.user, req.params.id, requestMeta17(req));
    sendSuccess(res, { subscription });
  })
);
router25.post(
  "/:id/pause",
  requirePermission("subscriptions.pause"),
  asyncHandler(async (req, res) => {
    const subscription = await subscriptionService.pauseSubscription(req.user, req.params.id, requestMeta17(req));
    sendSuccess(res, { subscription });
  })
);
router25.post(
  "/:id/cancel",
  requirePermission("subscriptions.cancel"),
  asyncHandler(async (req, res) => {
    const input = cancelSubscriptionSchema.parse(req.body);
    const subscription = await subscriptionService.cancelSubscription(req.user, req.params.id, input, requestMeta17(req));
    sendSuccess(res, { subscription });
  })
);
var subscriptionRoutes_default = router25;

// server/routes/v1/invoiceRoutes.ts
import { Router as Router26 } from "express";

// server/repositories/invoiceRepository.ts
var withItemsAndPayments = { include: { items: true, payments: { orderBy: { createdAt: "asc" } } } };
function buildWhere11(organizationId, filters) {
  const where = { organizationId };
  if (filters.status) where.status = filters.status;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.contractId) where.contractId = filters.contractId;
  if (filters.subscriptionId) where.subscriptionId = filters.subscriptionId;
  if (filters.dateFrom || filters.dateTo) {
    where.issueDate = {
      ...filters.dateFrom ? { gte: filters.dateFrom } : {},
      ...filters.dateTo ? { lte: filters.dateTo } : {}
    };
  }
  if (filters.search) where.invoiceNumber = { contains: filters.search, mode: "insensitive" };
  return where;
}
var invoiceRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere11(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.invoice.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.invoice.findFirst({ where: { id, organizationId }, ...withItemsAndPayments });
  },
  async listForClientInOrg(clientId, organizationId) {
    return prisma.invoice.findMany({ where: { clientId, organizationId }, orderBy: { issueDate: "desc" } });
  },
  async create(data, items) {
    return prisma.invoice.create({
      data: { ...data, items: { create: items } },
      ...withItemsAndPayments
    });
  },
  async update(id, data) {
    return prisma.invoice.update({ where: { id }, data });
  },
  async replaceItems(tx, invoiceId, items) {
    await tx.invoiceItem.deleteMany({ where: { invoiceId } });
    await tx.invoiceItem.createMany({ data: items.map((item) => ({ ...item, invoiceId })) });
  },
  /** Race-safe conditional status transition — see contractRepository.transitionStatus for the pattern rationale. */
  async transitionStatus(id, fromStatuses, data) {
    const result = await prisma.invoice.updateMany({
      where: { id, status: { in: fromStatuses } },
      data
    });
    return result.count;
  },
  /** Serializes concurrent payment record/reversal against the same invoice — required because those operations read a computed sum (Σ completed payments) and validate against it before writing, which a plain conditional updateMany cannot express (§37). */
  async lockForPayment(tx, id) {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`;
  },
  async completedPaymentAmounts(tx, invoiceId) {
    const rows = await tx.payment.findMany({ where: { invoiceId, status: "COMPLETED" }, select: { amount: true } });
    return rows.map((r) => r.amount);
  }
};

// server/repositories/paymentRepository.ts
function buildWhere12(organizationId, filters) {
  const where = { organizationId };
  if (filters.status) where.status = filters.status;
  if (filters.method) where.method = filters.method;
  if (filters.invoiceId) where.invoiceId = filters.invoiceId;
  if (filters.clientId) where.invoice = { clientId: filters.clientId };
  if (filters.dateFrom || filters.dateTo) {
    where.paymentDate = {
      ...filters.dateFrom ? { gte: filters.dateFrom } : {},
      ...filters.dateTo ? { lte: filters.dateTo } : {}
    };
  }
  return where;
}
var paymentRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = buildWhere12(organizationId, filters);
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.payment.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.payment.findFirst({ where: { id, organizationId } });
  },
  async listForInvoiceInOrg(invoiceId, organizationId) {
    return prisma.payment.findMany({ where: { invoiceId, organizationId }, orderBy: { createdAt: "asc" } });
  },
  async create(tx, data) {
    return tx.payment.create({
      data: {
        invoiceId: data.invoiceId,
        organizationId: data.organizationId,
        amount: data.amount,
        currency: data.currency,
        paymentDate: data.paymentDate,
        method: data.method,
        reference: data.reference,
        notes: data.notes,
        createdById: data.createdById,
        status: "COMPLETED"
      }
    });
  },
  /** Race-safe conditional reversal — only a COMPLETED payment can be reversed, and the invoice row must already be locked (FOR UPDATE) by the caller within the same transaction (§37). */
  async reverse(tx, id, data) {
    const result = await tx.payment.updateMany({
      where: { id, status: "COMPLETED" },
      data: { status: "REVERSED", reversalReason: data.reversalReason, reversedById: data.reversedById, reversedAt: data.reversedAt }
    });
    return result.count;
  }
};

// server/services/invoiceService.ts
var ISSUABLE_FROM = ["DRAFT"];
var PAYABLE_STATUSES = ["ISSUED", "PARTIALLY_PAID"];
function withEffectiveStatus(invoice) {
  return { ...invoice, effectiveStatus: effectiveInvoiceStatus(invoice) };
}
function statusForBalance(amountPaid, amountDue) {
  if (amountDue.isZero()) return "PAID";
  if (amountPaid.isZero()) return "ISSUED";
  return "PARTIALLY_PAID";
}
async function loadInvoiceOrThrow(id, organizationId) {
  const invoice = await invoiceRepository.findByIdInOrg(id, organizationId);
  if (!invoice) throw new NotFoundError("Invoice not found.");
  return invoice;
}
async function buildLineItems(items, productId) {
  const calculated = items.map((item) => calculateLineItem({ quantity: item.quantity, unitPrice: toMoney(item.unitPrice), discount: toMoney(item.discount) }));
  for (const item of items) {
    if (item.productModuleId && productId) {
      const module_ = await productModuleRepository.findByIdForProduct(item.productModuleId, productId);
      if (!module_) throw new ValidationError(`Product module ${item.productModuleId} does not belong to the linked subscription's product.`);
    }
  }
  return items.map((item, i) => ({
    productModuleId: item.productModuleId,
    description: item.description,
    quantity: item.quantity,
    unitPrice: calculated[i].unitPrice,
    discount: calculated[i].discount,
    lineTotal: calculated[i].lineTotal
  }));
}
var invoiceService = {
  async listInvoices(organizationId, filters, page, limit, sort, order) {
    const { rows, total } = await invoiceRepository.list(organizationId, filters, page, limit, sort, order);
    return { rows: rows.map((row) => ({ ...row, effectiveStatus: effectiveInvoiceStatus(row) })), total };
  },
  async getInvoice(organizationId, id) {
    return withEffectiveStatus(await loadInvoiceOrThrow(id, organizationId));
  },
  async createInvoice(caller, input, meta = {}) {
    const organizationId = caller.organizationId;
    const client3 = await clientRepository.findByIdInOrg(input.clientId, organizationId);
    if (!client3) throw new ValidationError("The specified client does not exist in this organization.");
    let productId;
    if (input.contractId) {
      const contract = await contractRepository.findByIdInOrg(input.contractId, organizationId);
      if (!contract || contract.clientId !== input.clientId) throw new ValidationError("The specified contract does not belong to this client.");
    }
    if (input.subscriptionId) {
      const subscription = await subscriptionRepository.findByIdInOrg(input.subscriptionId, organizationId);
      if (!subscription || subscription.clientId !== input.clientId) throw new ValidationError("The specified subscription does not belong to this client.");
      productId = subscription.productId;
    }
    if (input.dueDate.getTime() < input.issueDate.getTime()) {
      throw new ValidationError("dueDate cannot be before issueDate.");
    }
    const currency = input.currency ?? DEFAULT_CURRENCY;
    const lines = await buildLineItems(input.items, productId);
    const calculatedLines = lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, lineTotal: l.lineTotal }));
    const { subtotal, total } = calculateInvoiceTotals(calculatedLines, toMoney(input.discount), toMoney(input.tax));
    const { amountDue } = calculateInvoiceBalance(total, []);
    const invoiceNumber = await nextInvoiceNumber();
    const invoice = await invoiceRepository.create(
      {
        invoiceNumber,
        organizationId,
        clientId: input.clientId,
        contractId: input.contractId,
        subscriptionId: input.subscriptionId,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency,
        subtotal,
        tax: toMoney(input.tax),
        discount: toMoney(input.discount),
        total,
        amountDue,
        notes: input.notes,
        createdById: caller.id
      },
      lines
    );
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "INVOICE_CREATED",
      resourceType: "invoice",
      resourceId: invoice.id,
      afterData: { invoiceNumber, clientId: input.clientId, total: total.toString(), currency },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return withEffectiveStatus(invoice);
  },
  async updateInvoice(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(id, organizationId);
    if (existing.status !== "DRAFT") {
      throw new ConflictError("Only a DRAFT invoice can be edited \u2014 once issued, an invoice is immutable (correct via credit/void instead).");
    }
    const issueDate = input.issueDate ?? existing.issueDate;
    const dueDate = input.dueDate ?? existing.dueDate;
    if (dueDate.getTime() < issueDate.getTime()) throw new ValidationError("dueDate cannot be before issueDate.");
    await prisma.$transaction(async (tx) => {
      const patch = {};
      if (input.issueDate !== void 0) patch.issueDate = input.issueDate;
      if (input.dueDate !== void 0) patch.dueDate = input.dueDate;
      if (input.notes !== void 0) patch.notes = input.notes;
      let lines = existing.items.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, lineTotal: item.lineTotal }));
      if (input.items !== void 0) {
        const built = await buildLineItems(input.items, void 0);
        await invoiceRepository.replaceItems(tx, id, built);
        lines = built;
      }
      const discount = input.discount !== void 0 ? toMoney(input.discount) : existing.discount;
      const tax = input.tax !== void 0 ? toMoney(input.tax) : existing.tax;
      const { subtotal, total } = calculateInvoiceTotals(lines, discount, tax);
      const { amountDue } = calculateInvoiceBalance(total, []);
      patch.discount = discount;
      patch.tax = tax;
      patch.subtotal = subtotal;
      patch.total = total;
      patch.amountDue = amountDue;
      const where = {
        id,
        status: "DRAFT",
        ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {}
      };
      const result = await tx.invoice.updateMany({ where, data: patch });
      if (result.count === 0) {
        throw new ConflictError("This invoice was changed by someone else since you loaded it. Reload and try again.");
      }
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "INVOICE_UPDATED",
      resourceType: "invoice",
      resourceId: id,
      beforeData: { total: existing.total.toString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getInvoice(organizationId, id);
  },
  async issueInvoice(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(id, organizationId);
    if (existing.items.length === 0) throw new ValidationError("An invoice needs at least one line item before it can be issued.");
    const where = {
      id,
      status: { in: ISSUABLE_FROM },
      ...input.expectedUpdatedAt !== void 0 ? { updatedAt: input.expectedUpdatedAt } : {}
    };
    const result = await prisma.invoice.updateMany({ where, data: { status: "ISSUED" } });
    if (result.count === 0) {
      throw new ConflictError(`Invoice cannot be issued from status ${existing.status}, or it was changed by someone else. Reload and try again.`);
    }
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "INVOICE_ISSUED",
      resourceType: "invoice",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: "ISSUED", total: existing.total.toString() },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getInvoice(organizationId, id);
  },
  async voidInvoice(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(id, organizationId);
    if (existing.status === "VOID" || existing.status === "CANCELLED" || existing.status === "PAID") {
      throw new ConflictError(`An invoice with status ${existing.status} cannot be voided.`);
    }
    if (isPositive(existing.amountPaid)) {
      throw new ConflictError("This invoice has completed payments \u2014 reverse them before voiding the invoice.");
    }
    const targetStatus = existing.status === "DRAFT" ? "CANCELLED" : "VOID";
    const count = await invoiceRepository.transitionStatus(id, [existing.status], { status: targetStatus, voidReason: input.reason });
    if (count === 0) throw new ConflictError("This invoice was changed by someone else since you loaded it. Reload and try again.");
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: targetStatus === "VOID" ? "INVOICE_VOIDED" : "INVOICE_CANCELLED",
      resourceType: "invoice",
      resourceId: id,
      beforeData: { status: existing.status },
      afterData: { status: targetStatus, reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return this.getInvoice(organizationId, id);
  },
  async recordPayment(caller, invoiceId, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadInvoiceOrThrow(invoiceId, organizationId);
    const amount = toMoney(input.amount);
    if (!isPositive(amount)) throw new ValidationError("Payment amount must be positive.");
    const currency = input.currency ?? existing.currency;
    assertSameCurrency(currency, existing.currency, "the payment and the invoice");
    const payment = await prisma.$transaction(async (tx) => {
      await invoiceRepository.lockForPayment(tx, invoiceId);
      const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      if (!PAYABLE_STATUSES.includes(fresh.status)) {
        throw new ConflictError(`Payments can only be recorded against an issued invoice (current status: ${fresh.status}).`);
      }
      const completedAmounts = await invoiceRepository.completedPaymentAmounts(tx, invoiceId);
      const before = calculateInvoiceBalance(fresh.total, completedAmounts);
      if (amount.greaterThan(before.amountDue)) {
        throw new ValidationError(`Payment amount (${amount.toString()}) exceeds the outstanding balance of ${before.amountDue.toString()}.`);
      }
      const created = await paymentRepository.create(tx, {
        invoiceId,
        organizationId,
        amount,
        currency,
        paymentDate: input.paymentDate,
        method: input.method,
        reference: input.reference,
        notes: input.notes,
        createdById: caller.id
      });
      const after = calculateInvoiceBalance(fresh.total, [...completedAmounts, amount]);
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: after.amountPaid, amountDue: after.amountDue, status: statusForBalance(after.amountPaid, after.amountDue) }
      });
      return created;
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAYMENT_RECORDED",
      resourceType: "payment",
      resourceId: payment.id,
      afterData: { invoiceId, amount: amount.toString(), currency, method: input.method },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return payment;
  }
};

// server/services/paymentService.ts
function statusForBalance2(amountPaid, amountDue) {
  if (amountDue.isZero()) return "PAID";
  if (amountPaid.isZero()) return "ISSUED";
  return "PARTIALLY_PAID";
}
async function loadPaymentOrThrow(id, organizationId) {
  const payment = await paymentRepository.findByIdInOrg(id, organizationId);
  if (!payment) throw new NotFoundError("Payment not found.");
  return payment;
}
var paymentService = {
  async listPayments(organizationId, filters, page, limit, sort, order) {
    return paymentRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getPayment(organizationId, id) {
    return loadPaymentOrThrow(id, organizationId);
  },
  async reversePayment(caller, id, input, meta = {}) {
    const organizationId = caller.organizationId;
    const existing = await loadPaymentOrThrow(id, organizationId);
    if (existing.status !== "COMPLETED") {
      throw new ConflictError(`Only a COMPLETED payment can be reversed (current status: ${existing.status}).`);
    }
    const reversedAt = /* @__PURE__ */ new Date();
    await prisma.$transaction(async (tx) => {
      await invoiceRepository.lockForPayment(tx, existing.invoiceId);
      const result = await tx.payment.updateMany({
        where: { id, status: "COMPLETED" },
        data: { status: "REVERSED", reversalReason: input.reason, reversedById: caller.id, reversedAt }
      });
      if (result.count === 0) throw new ConflictError("This payment was already reversed by someone else.");
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: existing.invoiceId } });
      const completedAmounts = await invoiceRepository.completedPaymentAmounts(tx, existing.invoiceId);
      const balance = calculateInvoiceBalance(invoice.total, completedAmounts);
      await tx.invoice.update({
        where: { id: existing.invoiceId },
        data: { amountPaid: balance.amountPaid, amountDue: balance.amountDue, status: statusForBalance2(balance.amountPaid, balance.amountDue) }
      });
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "PAYMENT_REVERSED",
      resourceType: "payment",
      resourceId: id,
      beforeData: { status: "COMPLETED", amount: existing.amount.toString() },
      afterData: { status: "REVERSED", reason: input.reason },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return loadPaymentOrThrow(id, organizationId);
  }
};

// server/schemas/invoiceSchemas.ts
import { z as z23 } from "zod";
var invoiceStatusSchema = z23.enum(["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID", "CANCELLED"]);
var paymentMethodSchema = z23.enum(["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "ONLINE", "OTHER"]);
var paymentStatusSchema = z23.enum(["PENDING", "COMPLETED", "FAILED", "REVERSED"]);
var SORT_FIELDS6 = ["invoiceNumber", "status", "issueDate", "dueDate", "total", "amountDue", "createdAt", "updatedAt"];
var listInvoicesQuerySchema = z23.object({
  ...paginationQuerySchema(SORT_FIELDS6, "issueDate"),
  status: invoiceStatusSchema.optional(),
  clientId: z23.string().trim().uuid().optional(),
  contractId: z23.string().trim().uuid().optional(),
  subscriptionId: z23.string().trim().uuid().optional(),
  dateFrom: z23.coerce.date().optional(),
  dateTo: z23.coerce.date().optional()
});
var invoiceItemInputSchema = z23.object({
  productModuleId: z23.string().trim().uuid().optional(),
  description: z23.string().trim().min(1).max(500),
  quantity: z23.number().int().positive().default(1),
  unitPrice: moneyAmountSchema,
  discount: moneyAmountSchema.default("0")
});
var createInvoiceSchema = z23.object({
  clientId: z23.string().trim().uuid(),
  contractId: z23.string().trim().uuid().optional(),
  subscriptionId: z23.string().trim().uuid().optional(),
  issueDate: z23.coerce.date(),
  dueDate: z23.coerce.date(),
  currency: currencyCodeSchema.optional(),
  discount: moneyAmountSchema.default("0"),
  tax: moneyAmountSchema.default("0"),
  notes: z23.string().trim().max(5e3).optional(),
  items: z23.array(invoiceItemInputSchema).min(1, "An invoice needs at least one line item.")
});
var updateInvoiceSchema = z23.object({
  issueDate: z23.coerce.date().optional(),
  dueDate: z23.coerce.date().optional(),
  discount: moneyAmountSchema.optional(),
  tax: moneyAmountSchema.optional(),
  notes: z23.string().trim().max(5e3).nullable().optional(),
  items: z23.array(invoiceItemInputSchema).min(1).optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema2
}).refine((v) => Object.keys(v).some((k) => k !== "expectedUpdatedAt"), { message: "At least one field must be provided." });
var issueInvoiceSchema = z23.object({ expectedUpdatedAt: expectedUpdatedAtSchema2 });
var voidInvoiceSchema = z23.object({
  reason: z23.string().trim().min(1).max(1e3)
});
var recordPaymentSchema = z23.object({
  amount: moneyAmountSchema,
  currency: currencyCodeSchema.optional(),
  paymentDate: z23.coerce.date(),
  method: paymentMethodSchema,
  reference: z23.string().trim().max(200).optional(),
  notes: z23.string().trim().max(2e3).optional()
});

// server/routes/v1/invoiceRoutes.ts
var router26 = Router26();
router26.use(authenticateToken);
function requestMeta18(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router26.get(
  "/",
  requirePermission("invoices.read"),
  asyncHandler(async (req, res) => {
    const query = listInvoicesQuerySchema.parse(req.query);
    const { rows, total } = await invoiceService.listInvoices(
      req.user.organizationId,
      {
        search: query.search,
        status: query.status,
        clientId: query.clientId,
        contractId: query.contractId,
        subscriptionId: query.subscriptionId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo
      },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { invoices: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router26.get(
  "/:id",
  requirePermission("invoices.read"),
  asyncHandler(async (req, res) => {
    const invoice = await invoiceService.getInvoice(req.user.organizationId, req.params.id);
    sendSuccess(res, { invoice });
  })
);
router26.post(
  "/",
  requirePermission("invoices.create"),
  asyncHandler(async (req, res) => {
    const input = createInvoiceSchema.parse(req.body);
    const invoice = await invoiceService.createInvoice(req.user, input, requestMeta18(req));
    sendSuccess(res, { invoice }, 201);
  })
);
router26.patch(
  "/:id",
  requirePermission("invoices.update"),
  asyncHandler(async (req, res) => {
    const input = updateInvoiceSchema.parse(req.body);
    const invoice = await invoiceService.updateInvoice(req.user, req.params.id, input, requestMeta18(req));
    sendSuccess(res, { invoice });
  })
);
router26.post(
  "/:id/issue",
  requirePermission("invoices.issue"),
  asyncHandler(async (req, res) => {
    const input = issueInvoiceSchema.parse(req.body ?? {});
    const invoice = await invoiceService.issueInvoice(req.user, req.params.id, input, requestMeta18(req));
    sendSuccess(res, { invoice });
  })
);
router26.post(
  "/:id/void",
  requirePermission("invoices.void"),
  asyncHandler(async (req, res) => {
    const input = voidInvoiceSchema.parse(req.body);
    const invoice = await invoiceService.voidInvoice(req.user, req.params.id, input, requestMeta18(req));
    sendSuccess(res, { invoice });
  })
);
router26.get(
  "/:id/payments",
  requirePermission("payments.read"),
  asyncHandler(async (req, res) => {
    const { rows, total } = await paymentService.listPayments(req.user.organizationId, { invoiceId: req.params.id }, 1, 100, "paymentDate", "asc");
    sendSuccess(res, { payments: rows }, 200, { page: 1, limit: 100, total });
  })
);
router26.post(
  "/:id/payments",
  requirePermission("payments.create"),
  asyncHandler(async (req, res) => {
    const input = recordPaymentSchema.parse(req.body);
    const payment = await invoiceService.recordPayment(req.user, req.params.id, input, requestMeta18(req));
    sendSuccess(res, { payment }, 201);
  })
);
var invoiceRoutes_default = router26;

// server/routes/v1/paymentRoutes.ts
import { Router as Router27 } from "express";

// server/schemas/paymentSchemas.ts
import { z as z24 } from "zod";
var SORT_FIELDS7 = ["paymentDate", "amount", "status", "createdAt"];
var listPaymentsQuerySchema = z24.object({
  ...paginationQuerySchema(SORT_FIELDS7, "paymentDate"),
  status: paymentStatusSchema.optional(),
  method: paymentMethodSchema.optional(),
  invoiceId: z24.string().trim().uuid().optional(),
  clientId: z24.string().trim().uuid().optional(),
  dateFrom: z24.coerce.date().optional(),
  dateTo: z24.coerce.date().optional()
});
var reversePaymentSchema = z24.object({
  reason: z24.string().trim().min(1).max(1e3)
});

// server/routes/v1/paymentRoutes.ts
var router27 = Router27();
router27.use(authenticateToken);
function requestMeta19(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router27.get(
  "/",
  requirePermission("payments.read"),
  asyncHandler(async (req, res) => {
    const query = listPaymentsQuerySchema.parse(req.query);
    const { rows, total } = await paymentService.listPayments(
      req.user.organizationId,
      { status: query.status, method: query.method, invoiceId: query.invoiceId, clientId: query.clientId, dateFrom: query.dateFrom, dateTo: query.dateTo },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { payments: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router27.get(
  "/:id",
  requirePermission("payments.read"),
  asyncHandler(async (req, res) => {
    const payment = await paymentService.getPayment(req.user.organizationId, req.params.id);
    sendSuccess(res, { payment });
  })
);
router27.post(
  "/:id/reverse",
  requirePermission("payments.reverse"),
  asyncHandler(async (req, res) => {
    const input = reversePaymentSchema.parse(req.body);
    const payment = await paymentService.reversePayment(req.user, req.params.id, input, requestMeta19(req));
    sendSuccess(res, { payment });
  })
);
var paymentRoutes_default = router27;

// server/routes/v1/portalRoutes.ts
import { Router as Router28 } from "express";
import { z as z25 } from "zod";

// server/services/clientPortalService.ts
async function resolveClientForCaller(caller) {
  const client3 = await clientRepository.findByWorkspaceOrganizationId(caller.organizationId);
  if (!client3) throw new AuthorizationError("No client portal is associated with the current organization.");
  return client3;
}
var clientPortalService = {
  async getDashboard(caller) {
    const client3 = await resolveClientForCaller(caller);
    const [contracts, subscriptions, invoices, recentPayments] = await Promise.all([
      contractRepository.listForClientInOrg(client3.id, client3.organizationId),
      subscriptionRepository.listForClientInOrg(client3.id, client3.organizationId),
      invoiceRepository.listForClientInOrg(client3.id, client3.organizationId),
      paymentRepository.list(client3.organizationId, { clientId: client3.id }, 1, 5, "paymentDate", "desc")
    ]);
    const activeContracts = contracts.filter((c) => c.status === "ACTIVE");
    const activeSubscriptions = subscriptions.filter((s) => s.status === "ACTIVE");
    const outstandingInvoices = invoices.filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID");
    return {
      activeContractCount: activeContracts.length,
      activeSubscriptionCount: activeSubscriptions.length,
      outstandingInvoiceCount: outstandingInvoices.length,
      amountDue: sumMoney(outstandingInvoices.map((i) => i.amountDue)),
      currency: invoices[0]?.currency ?? subscriptions[0]?.currency ?? contracts[0]?.currency,
      recentPayments: recentPayments.rows
    };
  },
  async listContracts(caller, page, limit) {
    const client3 = await resolveClientForCaller(caller);
    const { rows, total } = await contractRepository.list(client3.organizationId, { clientId: client3.id }, page, limit, "createdAt", "desc");
    return { rows: rows.map((c) => ({ ...c, currentValue: calculateContractCurrentValue(c.contractValue, c.variations.map((v) => v.amount)) })), total };
  },
  async getContract(caller, id) {
    const client3 = await resolveClientForCaller(caller);
    const contract = await contractRepository.findByIdInOrg(id, client3.organizationId);
    if (!contract || contract.clientId !== client3.id) throw new NotFoundError("Contract not found.");
    return { ...contract, currentValue: calculateContractCurrentValue(contract.contractValue, contract.variations.map((v) => v.amount)) };
  },
  async listSubscriptions(caller, page, limit) {
    const client3 = await resolveClientForCaller(caller);
    return subscriptionRepository.list(client3.organizationId, { clientId: client3.id }, page, limit, "createdAt", "desc");
  },
  async getSubscription(caller, id) {
    const client3 = await resolveClientForCaller(caller);
    const subscription = await subscriptionRepository.findByIdInOrg(id, client3.organizationId);
    if (!subscription || subscription.clientId !== client3.id) throw new NotFoundError("Subscription not found.");
    return subscription;
  },
  async listInvoices(caller, page, limit, status) {
    const client3 = await resolveClientForCaller(caller);
    const { rows, total } = await invoiceRepository.list(client3.organizationId, { clientId: client3.id, status }, page, limit, "issueDate", "desc");
    return { rows: rows.map((i) => ({ ...i, effectiveStatus: effectiveInvoiceStatus(i) })), total };
  },
  async getInvoice(caller, id) {
    const client3 = await resolveClientForCaller(caller);
    const invoice = await invoiceRepository.findByIdInOrg(id, client3.organizationId);
    if (!invoice || invoice.clientId !== client3.id) throw new NotFoundError("Invoice not found.");
    return { ...invoice, effectiveStatus: effectiveInvoiceStatus(invoice) };
  },
  async listPayments(caller, page, limit) {
    const client3 = await resolveClientForCaller(caller);
    return paymentRepository.list(client3.organizationId, { clientId: client3.id }, page, limit, "paymentDate", "desc");
  }
};

// server/routes/v1/portalRoutes.ts
var router28 = Router28();
router28.use(authenticateToken);
var pageQuerySchema = z25.object({
  page: z25.coerce.number().int().positive().default(1),
  limit: z25.coerce.number().int().positive().max(100).default(20)
});
router28.get(
  "/dashboard",
  requirePermission("portal.dashboard.read"),
  asyncHandler(async (req, res) => {
    const dashboard = await clientPortalService.getDashboard(req.user);
    sendSuccess(res, { dashboard });
  })
);
router28.get(
  "/contracts",
  requirePermission("portal.contracts.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.parse(req.query);
    const { rows, total } = await clientPortalService.listContracts(req.user, query.page, query.limit);
    sendSuccess(res, { contracts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router28.get(
  "/contracts/:id",
  requirePermission("portal.contracts.read"),
  asyncHandler(async (req, res) => {
    const contract = await clientPortalService.getContract(req.user, req.params.id);
    sendSuccess(res, { contract });
  })
);
router28.get(
  "/subscriptions",
  requirePermission("portal.subscriptions.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.parse(req.query);
    const { rows, total } = await clientPortalService.listSubscriptions(req.user, query.page, query.limit);
    sendSuccess(res, { subscriptions: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router28.get(
  "/subscriptions/:id",
  requirePermission("portal.subscriptions.read"),
  asyncHandler(async (req, res) => {
    const subscription = await clientPortalService.getSubscription(req.user, req.params.id);
    sendSuccess(res, { subscription });
  })
);
router28.get(
  "/invoices",
  requirePermission("portal.invoices.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.extend({ status: invoiceStatusSchema.optional() }).parse(req.query);
    const { rows, total } = await clientPortalService.listInvoices(req.user, query.page, query.limit, query.status);
    sendSuccess(res, { invoices: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router28.get(
  "/invoices/:id",
  requirePermission("portal.invoices.read"),
  asyncHandler(async (req, res) => {
    const invoice = await clientPortalService.getInvoice(req.user, req.params.id);
    sendSuccess(res, { invoice });
  })
);
router28.get(
  "/payments",
  requirePermission("portal.payments.read"),
  asyncHandler(async (req, res) => {
    const query = pageQuerySchema.parse(req.query);
    const { rows, total } = await clientPortalService.listPayments(req.user, query.page, query.limit);
    sendSuccess(res, { payments: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
var portalRoutes_default = router28;

// server/routes/v1/publicRoutes.ts
import { Router as Router29 } from "express";

// server/services/publicSiteService.ts
async function projectPublicMedia(media) {
  if (!media || media.status !== "ACTIVE" || media.visibility !== "PUBLIC") return null;
  const provider = getStorageProvider();
  const url = await provider.createSignedReadUrl({ key: media.storageKey, expiresInSeconds: config.mediaSignedUrlTtlSeconds });
  return { url, altText: media.altText, caption: media.caption, width: media.width, height: media.height };
}
function hasPublicWebsiteOrganization() {
  return config.publicWebsiteOrganizationId.length > 0;
}
async function projectPage(page) {
  const revision = page.currentRevision;
  return {
    slug: page.slug,
    title: page.title,
    body: revision?.body ?? "",
    seo: revision?.metadata ?? {},
    featuredMedia: await projectPublicMedia(page.featuredMedia),
    publishedAt: page.publishedAt,
    updatedAt: page.updatedAt
  };
}
function projectAuthor(author) {
  if (!author) return null;
  return { name: `${author.user.firstName} ${author.user.lastName}`.trim(), bio: author.bio, avatarUrl: author.avatarUrl };
}
async function projectPost(post) {
  const revision = post.currentRevision;
  return {
    slug: post.slug,
    title: post.title,
    body: revision?.body ?? "",
    seo: revision?.metadata ?? {},
    category: post.category ? { slug: post.category.slug, name: post.category.name } : null,
    tags: post.tags.map((t) => ({ slug: t.tag.slug, name: t.tag.name })),
    author: projectAuthor(post.author),
    featuredMedia: await projectPublicMedia(post.featuredMedia),
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt
  };
}
var publicSiteService = {
  isConfigured: hasPublicWebsiteOrganization,
  async getPageBySlug(slug) {
    if (!hasPublicWebsiteOrganization()) throw new NotFoundError("Page not found.");
    const page = await pageRepository.findPublishedBySlugWithMedia(config.publicWebsiteOrganizationId, slug);
    if (!page) throw new NotFoundError("Page not found.");
    return projectPage(page);
  },
  async listPosts(filters, page, limit, sort, order) {
    if (!hasPublicWebsiteOrganization()) return { rows: [], total: 0 };
    const organizationId = config.publicWebsiteOrganizationId;
    let categoryId;
    if (filters.categorySlug) {
      const category = await categoryRepository.findBySlugInOrg(organizationId, filters.categorySlug);
      if (!category) return { rows: [], total: 0 };
      categoryId = category.id;
    }
    let tagId;
    if (filters.tagSlug) {
      const tag = await tagRepository.findBySlugInOrg(organizationId, filters.tagSlug);
      if (!tag) return { rows: [], total: 0 };
      tagId = tag.id;
    }
    const { rows, total } = await postRepository.listPublished(organizationId, { search: filters.search, categoryId, tagId }, page, limit, sort, order);
    return { rows: await Promise.all(rows.map(projectPost)), total };
  },
  async getPostBySlug(slug) {
    if (!hasPublicWebsiteOrganization()) throw new NotFoundError("Post not found.");
    const post = await postRepository.findPublishedBySlugWithMedia(config.publicWebsiteOrganizationId, slug);
    if (!post) throw new NotFoundError("Post not found.");
    return projectPost(post);
  },
  async listCategories() {
    if (!hasPublicWebsiteOrganization()) return [];
    const categories = await categoryRepository.list(config.publicWebsiteOrganizationId);
    return categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description }));
  },
  async listTags() {
    if (!hasPublicWebsiteOrganization()) return [];
    const tags = await tagRepository.list(config.publicWebsiteOrganizationId);
    return tags.map((t) => ({ slug: t.slug, name: t.name }));
  }
};

// server/services/publicProductService.ts
function projectProduct(product) {
  return {
    slug: product.slug,
    code: product.code,
    name: product.name,
    type: product.type,
    shortDescription: product.shortDescription,
    description: product.description,
    isFeatured: product.isFeatured,
    displayOrder: product.displayOrder
  };
}
function projectModule(module_) {
  return {
    slug: module_.slug,
    code: module_.code,
    name: module_.name,
    description: module_.description,
    isCore: module_.isCore,
    displayOrder: module_.displayOrder
  };
}
var publicProductService = {
  async listProducts(filters, page, limit) {
    const { rows, total } = await productRepository.list({ ...filters, status: "ACTIVE" }, page, limit, "displayOrder", "asc");
    return { rows: rows.map(projectProduct), total };
  },
  async getProductBySlug(slug) {
    const product = await productRepository.findBySlug(slug);
    if (!product || product.status !== "ACTIVE") throw new NotFoundError("Product not found.");
    return projectProduct(product);
  },
  async getProductModules(slug) {
    const product = await productRepository.findBySlug(slug);
    if (!product || product.status !== "ACTIVE") throw new NotFoundError("Product not found.");
    const { rows } = await productModuleRepository.listForProduct(product.id, "ACTIVE", 1, 100);
    return rows.map(projectModule);
  }
};

// server/services/publicLeadService.ts
function buildNotes(input) {
  const lines = [];
  if (input.subject) lines.push(`Subject: ${input.subject}`);
  if (input.productInterest) lines.push(`Product/service interest: ${input.productInterest}`);
  lines.push("", input.message.trim(), "", `Consent to be contacted: given (${input.source}).`);
  return lines.join("\n");
}
var publicLeadService = {
  /**
   * A non-empty `website` field (the honeypot — §8) means the caller is
   * almost certainly a bot: real visitors never see or fill it (hidden via
   * CSS). Returns `null` in that case — accepted-but-discarded, exactly
   * like a real submission from the caller's point of view, so a bot
   * learns nothing about which field gave it away.
   */
  async createLead(input, meta = {}) {
    if (input.website) {
      return null;
    }
    const organizationId = config.publicWebsiteOrganizationId;
    if (!organizationId) {
      throw new InfrastructureError("Public lead intake is not configured.");
    }
    const lead = await leadRepository.create({
      organizationId,
      companyName: input.company || input.name,
      contactName: input.name,
      email: input.email,
      phone: input.phone,
      source: `website:${input.source}`,
      notes: buildNotes(input)
    });
    await auditLogRepository.record({
      organizationId,
      actorType: "SYSTEM",
      actorName: "Public Website",
      action: "LEAD_CREATED",
      resourceType: "lead",
      resourceId: lead.id,
      afterData: { companyName: lead.companyName, source: lead.source },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return lead;
  }
};

// server/schemas/publicSchemas.ts
import { z as z26 } from "zod";
var SORT_FIELDS8 = ["publishedAt", "createdAt", "title"];
var listPublicPostsQuerySchema = z26.object({
  page: z26.coerce.number().int().positive().default(1),
  limit: z26.coerce.number().int().positive().max(50).default(12),
  search: z26.string().trim().max(200).optional(),
  category: z26.string().trim().max(150).optional(),
  tag: z26.string().trim().max(150).optional(),
  sort: z26.enum(SORT_FIELDS8).default("publishedAt"),
  order: z26.enum(["asc", "desc"]).default("desc")
});
var listPublicProductsQuerySchema = z26.object({
  page: z26.coerce.number().int().positive().default(1),
  limit: z26.coerce.number().int().positive().max(50).default(20),
  search: z26.string().trim().max(200).optional(),
  type: z26.enum(["PRODUCT", "SERVICE"]).optional()
});
var nonEmptyTrimmed = (max) => z26.string().trim().min(1).max(max);
var createPublicLeadSchema = z26.object({
  name: nonEmptyTrimmed(200),
  company: z26.string().trim().max(200).optional(),
  email: z26.string().trim().email().max(320),
  phone: z26.string().trim().max(50).optional(),
  subject: z26.string().trim().max(200).optional(),
  message: nonEmptyTrimmed(5e3),
  productInterest: z26.string().trim().max(200).optional(),
  source: z26.enum(["contact_form", "product_inquiry", "project_brief", "other"]).default("contact_form"),
  consent: z26.literal(true, { errorMap: () => ({ message: "Consent is required to submit this form." }) }),
  website: z26.string().trim().max(200).optional()
});

// server/routes/v1/publicRoutes.ts
var router29 = Router29();
function requestMeta20(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"] };
}
router29.get(
  "/site",
  asyncHandler(async (_req, res) => {
    sendSuccess(res, { configured: publicSiteService.isConfigured() });
  })
);
router29.get(
  "/pages/:slug",
  asyncHandler(async (req, res) => {
    const page = await publicSiteService.getPageBySlug(req.params.slug);
    sendSuccess(res, { page });
  })
);
router29.get(
  "/posts",
  asyncHandler(async (req, res) => {
    const query = listPublicPostsQuerySchema.parse(req.query);
    const { rows, total } = await publicSiteService.listPosts(
      { search: query.search, categorySlug: query.category, tagSlug: query.tag },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { posts: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router29.get(
  "/posts/:slug",
  asyncHandler(async (req, res) => {
    const post = await publicSiteService.getPostBySlug(req.params.slug);
    sendSuccess(res, { post });
  })
);
router29.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const categories = await publicSiteService.listCategories();
    sendSuccess(res, { categories });
  })
);
router29.get(
  "/tags",
  asyncHandler(async (_req, res) => {
    const tags = await publicSiteService.listTags();
    sendSuccess(res, { tags });
  })
);
router29.get(
  "/products",
  asyncHandler(async (req, res) => {
    const query = listPublicProductsQuerySchema.parse(req.query);
    const { rows, total } = await publicProductService.listProducts({ search: query.search, type: query.type }, query.page, query.limit);
    sendSuccess(res, { products: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router29.get(
  "/products/:slug",
  asyncHandler(async (req, res) => {
    const product = await publicProductService.getProductBySlug(req.params.slug);
    sendSuccess(res, { product });
  })
);
router29.get(
  "/products/:slug/modules",
  asyncHandler(async (req, res) => {
    const modules = await publicProductService.getProductModules(req.params.slug);
    sendSuccess(res, { modules });
  })
);
router29.post(
  "/leads",
  publicLeadLimiter,
  asyncHandler(async (req, res) => {
    const input = createPublicLeadSchema.parse(req.body);
    await publicLeadService.createLead(input, requestMeta20(req));
    sendSuccess(res, { message: "Thank you \u2014 your message has been received. We'll be in touch shortly." }, 201);
  })
);
var publicRoutes_default = router29;

// server/routes/v1/aiProviderRoutes.ts
import { Router as Router30 } from "express";

// server/repositories/aiProviderRepository.ts
var aiProviderRepository = {
  async listProviders() {
    return prisma.aIProvider.findMany({ include: { models: true }, orderBy: { name: "asc" } });
  },
  async getProvider(id) {
    return prisma.aIProvider.findUnique({ where: { id }, include: { models: true } });
  },
  async findProviderByCode(code) {
    return prisma.aIProvider.findUnique({ where: { code } });
  },
  async createProvider(input) {
    return prisma.aIProvider.create({
      data: { code: input.code, name: input.name, status: input.status ?? "INACTIVE", isDefault: input.isDefault ?? false }
    });
  },
  async updateProvider(id, input) {
    return prisma.aIProvider.update({ where: { id }, data: input });
  },
  async clearDefaultProviders() {
    await prisma.aIProvider.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
  },
  async listModels(providerId) {
    return prisma.aIModel.findMany({ where: providerId ? { providerId } : void 0, orderBy: { displayName: "asc" } });
  },
  async getModel(id) {
    return prisma.aIModel.findUnique({ where: { id } });
  },
  async createModel(input) {
    return prisma.aIModel.create({
      data: {
        providerId: input.providerId,
        modelId: input.modelId,
        displayName: input.displayName,
        contextWindow: input.contextWindow,
        supportsStructuredOutput: input.supportsStructuredOutput ?? false,
        supportsToolCalling: input.supportsToolCalling ?? false,
        inputPricePerMillionTokens: input.inputPricePerMillionTokens,
        outputPricePerMillionTokens: input.outputPricePerMillionTokens,
        isActive: input.isActive ?? true,
        isDefault: input.isDefault ?? false
      }
    });
  },
  async updateModel(id, input) {
    return prisma.aIModel.update({ where: { id }, data: input });
  },
  async clearDefaultModels(providerId) {
    await prisma.aIModel.updateMany({ where: { providerId, isDefault: true }, data: { isDefault: false } });
  }
};

// server/services/aiProviderService.ts
var aiProviderService = {
  async listProviders() {
    return aiProviderRepository.listProviders();
  },
  async getProvider(id) {
    const provider = await aiProviderRepository.getProvider(id);
    if (!provider) throw new NotFoundError("AI provider not found.");
    return provider;
  },
  async createProvider(caller, input, meta = {}) {
    const existing = await aiProviderRepository.findProviderByCode(input.code);
    if (existing) throw new ConflictError(`An AI provider with code "${input.code}" already exists.`);
    if (input.isDefault) await aiProviderRepository.clearDefaultProviders();
    const provider = await aiProviderRepository.createProvider(input);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROVIDER_CREATED",
      resourceType: "ai_provider",
      resourceId: provider.id,
      afterData: { code: provider.code, status: provider.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return provider;
  },
  async updateProvider(caller, id, input, meta = {}) {
    await this.getProvider(id);
    if (input.isDefault) await aiProviderRepository.clearDefaultProviders();
    const provider = await aiProviderRepository.updateProvider(id, input);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROVIDER_UPDATED",
      resourceType: "ai_provider",
      resourceId: id,
      afterData: input,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return provider;
  },
  async listModels(providerId) {
    return aiProviderRepository.listModels(providerId);
  },
  async createModel(caller, input, meta = {}) {
    await this.getProvider(input.providerId);
    if (input.isDefault) await aiProviderRepository.clearDefaultModels(input.providerId);
    const model = await aiProviderRepository.createModel(input);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_MODEL_CREATED",
      resourceType: "ai_model",
      resourceId: model.id,
      afterData: { providerId: model.providerId, modelId: model.modelId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return model;
  },
  async updateModel(caller, id, input, meta = {}) {
    const existing = await aiProviderRepository.getModel(id);
    if (!existing) throw new NotFoundError("AI model not found.");
    if (input.isDefault) await aiProviderRepository.clearDefaultModels(existing.providerId);
    const model = await aiProviderRepository.updateModel(id, input);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_MODEL_UPDATED",
      resourceType: "ai_model",
      resourceId: id,
      afterData: input,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return model;
  }
};

// server/schemas/aiSchemas.ts
import { z as z27 } from "zod";
var createAiProviderSchema = z27.object({
  code: z27.string().trim().min(1).max(50),
  name: z27.string().trim().min(1).max(200),
  status: z27.enum(["ACTIVE", "INACTIVE"]).optional(),
  isDefault: z27.boolean().optional()
});
var updateAiProviderSchema = z27.object({
  name: z27.string().trim().min(1).max(200).optional(),
  status: z27.enum(["ACTIVE", "INACTIVE"]).optional(),
  isDefault: z27.boolean().optional()
});
var createAiModelSchema = z27.object({
  providerId: z27.string().uuid(),
  modelId: z27.string().trim().min(1).max(100),
  displayName: z27.string().trim().min(1).max(200),
  contextWindow: z27.number().int().positive().optional(),
  supportsStructuredOutput: z27.boolean().optional(),
  supportsToolCalling: z27.boolean().optional(),
  inputPricePerMillionTokens: z27.number().nonnegative().optional(),
  outputPricePerMillionTokens: z27.number().nonnegative().optional(),
  isActive: z27.boolean().optional(),
  isDefault: z27.boolean().optional()
});
var updateAiModelSchema = createAiModelSchema.partial().omit({ providerId: true, modelId: true });
var updateAiOrgToolSettingSchema = z27.object({
  enabled: z27.boolean().optional(),
  requireApprovalOverride: z27.boolean().nullable().optional()
});
var PROMPT_SORT_FIELDS = ["key", "name", "status", "createdAt", "updatedAt"];
var listAiPromptsQuerySchema = z27.object(paginationQuerySchema(PROMPT_SORT_FIELDS, "createdAt", "desc"));
var createAiPromptTemplateSchema = z27.object({
  key: z27.string().trim().min(1).max(100).regex(/^[a-z0-9._-]+$/, "key must be lowercase, URL-safe (letters, numbers, dots, hyphens, underscores)"),
  name: z27.string().trim().min(1).max(200),
  purpose: z27.string().trim().max(1e3).optional(),
  systemInstructions: z27.string().trim().min(1).max(2e4),
  userTemplate: z27.string().trim().min(1).max(2e4),
  variablesSchema: z27.record(z27.unknown()).optional()
});
var createAiPromptVersionSchema = z27.object({
  systemInstructions: z27.string().trim().min(1).max(2e4),
  userTemplate: z27.string().trim().min(1).max(2e4),
  variablesSchema: z27.record(z27.unknown()).optional()
});
var updateAiPromptTemplateSchema = z27.object({
  name: z27.string().trim().min(1).max(200).optional(),
  purpose: z27.string().trim().max(1e3).nullable().optional(),
  status: z27.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional()
});
var publishAiPromptVersionSchema = z27.object({
  versionId: z27.string().uuid()
});
var WORKFLOW_SORT_FIELDS = ["key", "name", "status", "createdAt", "updatedAt"];
var listAiWorkflowsQuerySchema = z27.object(paginationQuerySchema(WORKFLOW_SORT_FIELDS, "createdAt", "desc"));
var workflowStepSchema = z27.object({
  order: z27.number().int().nonnegative(),
  toolCode: z27.string().trim().min(1).max(100),
  description: z27.string().trim().max(500).optional()
});
var createAiWorkflowSchema = z27.object({
  key: z27.string().trim().min(1).max(100).regex(/^[a-z0-9._-]+$/, "key must be lowercase, URL-safe (letters, numbers, dots, hyphens, underscores)"),
  name: z27.string().trim().min(1).max(200),
  description: z27.string().trim().max(2e3).optional(),
  steps: z27.array(workflowStepSchema).min(1).max(10),
  maxSteps: z27.number().int().positive().max(10).optional(),
  timeoutMs: z27.number().int().positive().max(12e4).optional()
});
var updateAiWorkflowSchema = z27.object({
  name: z27.string().trim().min(1).max(200).optional(),
  description: z27.string().trim().max(2e3).nullable().optional(),
  steps: z27.array(workflowStepSchema).min(1).max(10).optional(),
  maxSteps: z27.number().int().positive().max(10).optional(),
  timeoutMs: z27.number().int().positive().max(12e4).optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema2
});
var executeAiWorkflowSchema = z27.object({
  /** Keyed by step order — each step's tool input, supplied by the caller (Phase 12 has no autonomous planning, see AIWorkflow's schema.prisma doc comment). */
  stepInputs: z27.record(z27.string(), z27.record(z27.unknown())).default({})
});
var executeAiToolSchema = z27.object({
  toolCode: z27.string().trim().min(1).max(100),
  input: z27.record(z27.unknown()).default({})
});
var EXECUTION_SORT_FIELDS = ["createdAt", "startedAt", "status"];
var listAiExecutionsQuerySchema = z27.object({
  ...paginationQuerySchema(EXECUTION_SORT_FIELDS, "createdAt", "desc"),
  kind: z27.enum(["TOOL_CALL", "WORKFLOW"]).optional(),
  status: z27.enum(["PENDING", "RUNNING", "AWAITING_APPROVAL", "COMPLETED", "FAILED", "CANCELLED"]).optional()
});
var usageSummaryQuerySchema = z27.object({
  dateFrom: z27.coerce.date().optional(),
  dateTo: z27.coerce.date().optional()
});
var APPROVAL_SORT_FIELDS = ["createdAt", "expiresAt", "status"];
var listAiApprovalsQuerySchema = z27.object({
  ...paginationQuerySchema(APPROVAL_SORT_FIELDS, "createdAt", "desc"),
  status: z27.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]).optional()
});
var decideAiApprovalSchema = z27.object({
  decision: z27.enum(["APPROVE", "REJECT"]),
  rejectionReason: z27.string().trim().max(2e3).optional()
});

// server/routes/v1/aiProviderRoutes.ts
var router30 = Router30();
router30.use(authenticateToken);
function requestMeta21(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId };
}
router30.get(
  "/",
  requirePermission("ai.providers.read"),
  asyncHandler(async (_req, res) => {
    const providers = await aiProviderService.listProviders();
    sendSuccess(res, { providers });
  })
);
router30.post(
  "/",
  requirePermission("ai.providers.manage"),
  asyncHandler(async (req, res) => {
    const input = createAiProviderSchema.parse(req.body);
    const provider = await aiProviderService.createProvider(req.user, input, requestMeta21(req));
    sendSuccess(res, { provider }, 201);
  })
);
router30.patch(
  "/:id",
  requirePermission("ai.providers.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiProviderSchema.parse(req.body);
    const provider = await aiProviderService.updateProvider(req.user, req.params.id, input, requestMeta21(req));
    sendSuccess(res, { provider });
  })
);
router30.get(
  "/models",
  requirePermission("ai.models.read"),
  asyncHandler(async (req, res) => {
    const providerId = typeof req.query.providerId === "string" ? req.query.providerId : void 0;
    const models = await aiProviderService.listModels(providerId);
    sendSuccess(res, { models });
  })
);
router30.post(
  "/models",
  requirePermission("ai.models.manage"),
  asyncHandler(async (req, res) => {
    const input = createAiModelSchema.parse(req.body);
    const model = await aiProviderService.createModel(req.user, input, requestMeta21(req));
    sendSuccess(res, { model }, 201);
  })
);
router30.patch(
  "/models/:id",
  requirePermission("ai.models.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiModelSchema.parse(req.body);
    const model = await aiProviderService.updateModel(req.user, req.params.id, input, requestMeta21(req));
    sendSuccess(res, { model });
  })
);
var aiProviderRoutes_default = router30;

// server/routes/v1/aiToolRoutes.ts
import { Router as Router31 } from "express";

// server/repositories/aiToolRepository.ts
var aiToolRepository = {
  async listTools() {
    return prisma.aITool.findMany({ orderBy: { code: "asc" } });
  },
  async getToolByCode(code) {
    return prisma.aITool.findUnique({ where: { code } });
  },
  async listOrgSettings(organizationId) {
    return prisma.aIOrgToolSetting.findMany({ where: { organizationId } });
  },
  async getOrgSetting(organizationId, toolCode) {
    return prisma.aIOrgToolSetting.findUnique({ where: { organizationId_toolCode: { organizationId, toolCode } } });
  },
  async upsertOrgSetting(organizationId, toolCode, input) {
    return prisma.aIOrgToolSetting.upsert({
      where: { organizationId_toolCode: { organizationId, toolCode } },
      update: input,
      create: {
        organizationId,
        toolCode,
        enabled: input.enabled ?? true,
        requireApprovalOverride: input.requireApprovalOverride ?? null
      }
    });
  }
};

// server/services/aiToolService.ts
var aiToolService = {
  async listToolsForOrg(organizationId) {
    const [tools, settings] = await Promise.all([aiToolRepository.listTools(), aiToolRepository.listOrgSettings(organizationId)]);
    const settingByCode = new Map(settings.map((s) => [s.toolCode, s]));
    return tools.map((tool2) => ({
      ...tool2,
      orgEnabled: settingByCode.get(tool2.code)?.enabled ?? true,
      requireApprovalOverride: settingByCode.get(tool2.code)?.requireApprovalOverride ?? null
    }));
  },
  async updateOrgSetting(caller, toolCode, input, meta = {}) {
    const tool2 = await aiToolRepository.getToolByCode(toolCode);
    if (!tool2) throw new NotFoundError(`AI tool "${toolCode}" not found.`);
    const setting = await aiToolRepository.upsertOrgSetting(caller.organizationId, toolCode, input);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_ORG_TOOL_SETTING_UPDATED",
      resourceType: "ai_tool",
      resourceId: toolCode,
      afterData: { enabled: setting.enabled, requireApprovalOverride: setting.requireApprovalOverride },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return setting;
  }
};

// server/routes/v1/aiToolRoutes.ts
var router31 = Router31();
router31.use(authenticateToken);
function requestMeta22(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId };
}
router31.get(
  "/",
  requirePermission("ai.tools.read"),
  asyncHandler(async (req, res) => {
    const tools = await aiToolService.listToolsForOrg(req.user.organizationId);
    sendSuccess(res, { tools });
  })
);
router31.patch(
  "/:code/settings",
  requirePermission("ai.tools.manage"),
  asyncHandler(async (req, res) => {
    const input = updateAiOrgToolSettingSchema.parse(req.body);
    const setting = await aiToolService.updateOrgSetting(req.user, req.params.code, input, requestMeta22(req));
    sendSuccess(res, { setting });
  })
);
var aiToolRoutes_default = router31;

// server/routes/v1/aiPromptRoutes.ts
import { Router as Router32 } from "express";

// server/repositories/aiPromptRepository.ts
var aiPromptRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = {
      organizationId,
      ...filters.status ? { status: filters.status } : {},
      ...filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}
    };
    const [rows, total] = await Promise.all([
      prisma.aIPromptTemplate.findMany({
        where,
        include: { currentVersion: true },
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.aIPromptTemplate.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.aIPromptTemplate.findFirst({
      where: { id, organizationId },
      include: { currentVersion: true, versions: { orderBy: { version: "desc" } } }
    });
  },
  async findByKeyInOrg(key, organizationId) {
    return prisma.aIPromptTemplate.findUnique({ where: { organizationId_key: { organizationId, key } } });
  },
  async create(organizationId, createdById, input) {
    return prisma.$transaction(async (tx) => {
      const template = await tx.aIPromptTemplate.create({
        data: {
          organizationId,
          key: input.key,
          name: input.name,
          purpose: input.purpose,
          status: "DRAFT",
          createdById,
          updatedById: createdById
        }
      });
      const version = await tx.aIPromptVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          systemInstructions: input.systemInstructions,
          userTemplate: input.userTemplate,
          variablesSchema: input.variablesSchema,
          createdById
        }
      });
      return tx.aIPromptTemplate.update({
        where: { id: template.id },
        data: { currentVersionId: version.id },
        include: { currentVersion: true }
      });
    });
  },
  async createVersion(templateId, createdById, input) {
    const latest = await prisma.aIPromptVersion.findFirst({ where: { templateId }, orderBy: { version: "desc" } });
    const nextVersion = (latest?.version ?? 0) + 1;
    return prisma.aIPromptVersion.create({
      data: {
        templateId,
        version: nextVersion,
        systemInstructions: input.systemInstructions,
        userTemplate: input.userTemplate,
        variablesSchema: input.variablesSchema,
        createdById
      }
    });
  },
  async update(id, updatedById, input) {
    return prisma.aIPromptTemplate.update({
      where: { id },
      data: { ...input, updatedById },
      include: { currentVersion: true }
    });
  },
  async setCurrentVersion(id, versionId, updatedById) {
    return prisma.aIPromptTemplate.update({
      where: { id },
      data: { currentVersionId: versionId, updatedById },
      include: { currentVersion: true }
    });
  },
  async findVersionInTemplate(templateId, versionId) {
    return prisma.aIPromptVersion.findFirst({ where: { id: versionId, templateId } });
  }
};

// server/services/aiPromptService.ts
async function loadTemplateOrThrow(id, organizationId) {
  const template = await aiPromptRepository.findByIdInOrg(id, organizationId);
  if (!template) throw new NotFoundError("Prompt template not found.");
  return template;
}
var aiPromptService = {
  async listTemplates(organizationId, filters, page, limit, sort, order) {
    return aiPromptRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getTemplate(organizationId, id) {
    return loadTemplateOrThrow(id, organizationId);
  },
  async createTemplate(caller, input, meta = {}) {
    const existing = await aiPromptRepository.findByKeyInOrg(input.key, caller.organizationId);
    if (existing) throw new ConflictError(`A prompt template with key "${input.key}" already exists in this organization.`);
    const template = await aiPromptRepository.create(caller.organizationId, caller.id, input);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROMPT_TEMPLATE_CREATED",
      resourceType: "ai_prompt_template",
      resourceId: template.id,
      afterData: { key: template.key, name: template.name },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return template;
  },
  async createVersion(caller, templateId, input, meta = {}) {
    await loadTemplateOrThrow(templateId, caller.organizationId);
    const version = await aiPromptRepository.createVersion(templateId, caller.id, input);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROMPT_VERSION_CREATED",
      resourceType: "ai_prompt_version",
      resourceId: version.id,
      afterData: { templateId, version: version.version },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return version;
  },
  async updateTemplate(caller, id, input, meta = {}) {
    await loadTemplateOrThrow(id, caller.organizationId);
    const template = await aiPromptRepository.update(id, caller.id, input);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROMPT_TEMPLATE_UPDATED",
      resourceType: "ai_prompt_template",
      resourceId: id,
      afterData: input,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return template;
  },
  async publishVersion(caller, templateId, versionId, meta = {}) {
    await loadTemplateOrThrow(templateId, caller.organizationId);
    const version = await aiPromptRepository.findVersionInTemplate(templateId, versionId);
    if (!version) throw new ValidationError("versionId does not refer to a version of this prompt template.");
    const template = await aiPromptRepository.setCurrentVersion(templateId, versionId, caller.id);
    if (template.status === "DRAFT") {
      await aiPromptRepository.update(templateId, caller.id, { status: "ACTIVE" });
    }
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROMPT_VERSION_PUBLISHED",
      resourceType: "ai_prompt_template",
      resourceId: templateId,
      afterData: { versionId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return aiPromptRepository.findByIdInOrg(templateId, caller.organizationId);
  },
  async deleteTemplate(caller, id, meta = {}) {
    await loadTemplateOrThrow(id, caller.organizationId);
    await aiPromptRepository.update(id, caller.id, { status: "ARCHIVED" });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_PROMPT_TEMPLATE_ARCHIVED",
      resourceType: "ai_prompt_template",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
  }
};

// server/routes/v1/aiPromptRoutes.ts
var router32 = Router32();
router32.use(authenticateToken);
function requestMeta23(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId };
}
router32.get(
  "/",
  requirePermission("ai.prompts.read"),
  asyncHandler(async (req, res) => {
    const query = listAiPromptsQuerySchema.parse(req.query);
    const { rows, total } = await aiPromptService.listTemplates(
      req.user.organizationId,
      { search: query.search },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { promptTemplates: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router32.get(
  "/:id",
  requirePermission("ai.prompts.read"),
  asyncHandler(async (req, res) => {
    const promptTemplate = await aiPromptService.getTemplate(req.user.organizationId, req.params.id);
    sendSuccess(res, { promptTemplate });
  })
);
router32.post(
  "/",
  requirePermission("ai.prompts.create"),
  asyncHandler(async (req, res) => {
    const input = createAiPromptTemplateSchema.parse(req.body);
    const promptTemplate = await aiPromptService.createTemplate(req.user, input, requestMeta23(req));
    sendSuccess(res, { promptTemplate }, 201);
  })
);
router32.patch(
  "/:id",
  requirePermission("ai.prompts.update"),
  asyncHandler(async (req, res) => {
    const input = updateAiPromptTemplateSchema.parse(req.body);
    const promptTemplate = await aiPromptService.updateTemplate(req.user, req.params.id, input, requestMeta23(req));
    sendSuccess(res, { promptTemplate });
  })
);
router32.post(
  "/:id/versions",
  requirePermission("ai.prompts.update"),
  asyncHandler(async (req, res) => {
    const input = createAiPromptVersionSchema.parse(req.body);
    const version = await aiPromptService.createVersion(req.user, req.params.id, input, requestMeta23(req));
    sendSuccess(res, { version }, 201);
  })
);
router32.post(
  "/:id/publish",
  requirePermission("ai.prompts.publish"),
  asyncHandler(async (req, res) => {
    const input = publishAiPromptVersionSchema.parse(req.body);
    const promptTemplate = await aiPromptService.publishVersion(req.user, req.params.id, input.versionId, requestMeta23(req));
    sendSuccess(res, { promptTemplate });
  })
);
router32.delete(
  "/:id",
  requirePermission("ai.prompts.delete"),
  asyncHandler(async (req, res) => {
    await aiPromptService.deleteTemplate(req.user, req.params.id, requestMeta23(req));
    sendSuccess(res, { archived: true });
  })
);
var aiPromptRoutes_default = router32;

// server/routes/v1/aiWorkflowRoutes.ts
import { Router as Router33 } from "express";

// server/repositories/aiWorkflowRepository.ts
var aiWorkflowRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = {
      organizationId,
      ...filters.status ? { status: filters.status } : {},
      ...filters.search ? { name: { contains: filters.search, mode: "insensitive" } } : {}
    };
    const [rows, total] = await Promise.all([
      prisma.aIWorkflow.findMany({ where, orderBy: { [sort]: order }, skip: (page - 1) * limit, take: limit }),
      prisma.aIWorkflow.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.aIWorkflow.findFirst({ where: { id, organizationId } });
  },
  async findByKeyInOrg(key, organizationId) {
    return prisma.aIWorkflow.findUnique({ where: { organizationId_key: { organizationId, key } } });
  },
  async create(organizationId, createdById, input) {
    return prisma.aIWorkflow.create({
      data: {
        organizationId,
        key: input.key,
        name: input.name,
        description: input.description,
        status: "DRAFT",
        version: 1,
        steps: input.steps,
        maxSteps: input.maxSteps ?? 10,
        timeoutMs: input.timeoutMs ?? 3e4,
        createdById,
        updatedById: createdById
      }
    });
  },
  async update(id, updatedById, input) {
    return prisma.aIWorkflow.update({
      where: { id },
      data: { ...input, updatedById, ...input.steps ? { version: { increment: 1 } } : {} }
    });
  },
  async setStatus(id, status, updatedById) {
    return prisma.aIWorkflow.update({ where: { id }, data: { status, updatedById } });
  }
};

// server/repositories/aiExecutionRepository.ts
var aiExecutionRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = { organizationId, ...filters };
    const [rows, total] = await Promise.all([
      prisma.aIExecution.findMany({
        where,
        include: { toolExecutions: true, workflow: { select: { key: true, name: true } } },
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.aIExecution.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.aIExecution.findFirst({
      where: { id, organizationId },
      include: { toolExecutions: true, usageRecords: true, approvals: true, workflow: { select: { key: true, name: true } } }
    });
  },
  async create(data) {
    return prisma.aIExecution.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        kind: data.kind,
        workflowId: data.workflowId,
        toolCode: data.toolCode,
        requestId: data.requestId,
        input: data.input,
        status: "RUNNING"
      }
    });
  },
  async complete(id, status, output, errorMessage) {
    const startedAt = (await prisma.aIExecution.findUnique({ where: { id }, select: { startedAt: true } }))?.startedAt ?? /* @__PURE__ */ new Date();
    const completedAt = /* @__PURE__ */ new Date();
    return prisma.aIExecution.update({
      where: { id },
      data: {
        status,
        output,
        errorMessage,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime()
      }
    });
  }
};

// server/ai/governance.ts
import crypto from "crypto";
import { Prisma as Prisma5 } from "@prisma/client";

// server/ai/toolRegistry.ts
import { z as z28 } from "zod";
function tool(def) {
  return def;
}
var listLeadsInput = z28.object({
  search: z28.string().trim().max(200).optional(),
  status: z28.enum(["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"]).optional(),
  page: z28.number().int().positive().default(1),
  limit: z28.number().int().positive().max(50).default(20)
});
var createLeadInput = z28.object({
  companyName: z28.string().trim().min(1).max(200),
  contactName: z28.string().trim().max(200).optional(),
  email: z28.string().trim().email().max(255).optional(),
  phone: z28.string().trim().max(50).optional(),
  source: z28.string().trim().max(100).optional(),
  notes: z28.string().trim().max(5e3).optional()
});
var convertLeadInput = z28.object({
  leadId: z28.string().uuid(),
  clientCode: z28.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/),
  name: z28.string().trim().max(200).optional(),
  createContact: z28.boolean().default(true)
});
var listClientsInput = z28.object({
  search: z28.string().trim().max(200).optional(),
  status: z28.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  page: z28.number().int().positive().default(1),
  limit: z28.number().int().positive().max(50).default(20)
});
var createClientInput = z28.object({
  clientCode: z28.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._-]+$/),
  name: z28.string().trim().min(1).max(200),
  email: z28.string().trim().email().max(255).optional(),
  phone: z28.string().trim().max(50).optional(),
  notes: z28.string().trim().max(5e3).optional()
});
var listPostsInput = z28.object({
  search: z28.string().trim().max(200).optional(),
  status: z28.enum(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  page: z28.number().int().positive().default(1),
  limit: z28.number().int().positive().max(50).default(20)
});
var createDraftPostInput = z28.object({
  title: z28.string().trim().min(1).max(200),
  body: z28.string().trim().max(5e5).default(""),
  categoryId: z28.string().trim().uuid().optional()
});
var listProductsInput = z28.object({
  search: z28.string().trim().max(200).optional(),
  type: z28.enum(["PRODUCT", "SERVICE"]).optional(),
  status: z28.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
  page: z28.number().int().positive().default(1),
  limit: z28.number().int().positive().max(50).default(20)
});
var issueInvoiceInput = z28.object({
  invoiceId: z28.string().uuid()
});
var activateContractInput = z28.object({
  contractId: z28.string().uuid()
});
var AI_TOOL_REGISTRY = Object.freeze({
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
    }
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
    handler: async (caller, input, meta) => leadService.createLead(caller, input, meta)
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
    }
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
    }
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
    handler: async (caller, input, meta) => clientService.createClient(caller, input, meta)
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
    }
  }),
  "content.create_draft": tool({
    code: "content.create_draft",
    name: "Create draft post",
    description: "Create a new CMS post in DRAFT status (never publishes \u2014 a human must submit/publish it separately).",
    requiredPermission: "content.create",
    riskLevel: "MEDIUM",
    isMutating: true,
    requiresApproval: false,
    inputSchema: createDraftPostInput,
    handler: async (caller, input, meta) => postService.createPost(caller, input, meta)
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
    }
  }),
  "invoices.issue": tool({
    code: "invoices.issue",
    name: "Issue invoice",
    description: "Issue a draft invoice, making it payable. Moves money \u2014 always requires human approval.",
    requiredPermission: "invoices.issue",
    riskLevel: "HIGH",
    isMutating: true,
    requiresApproval: true,
    inputSchema: issueInvoiceInput,
    handler: async (caller, input, meta) => invoiceService.issueInvoice(caller, input.invoiceId, {}, meta)
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
    handler: async (caller, input, meta) => contractService.activateContract(caller, input.contractId, meta)
  })
});
function isRegisteredToolCode(code) {
  return Object.prototype.hasOwnProperty.call(AI_TOOL_REGISTRY, code);
}

// server/ai/governance.ts
var SUPER_ADMIN_ROLE_KEY2 = "SUPER_ADMIN";
function hasPermission(caller, permission) {
  return caller.role.key === SUPER_ADMIN_ROLE_KEY2 || caller.role.permissions.includes(permission);
}
function payloadHash(input) {
  return crypto.createHash("sha256").update(JSON.stringify(input ?? {})).digest("hex");
}
function resolveRequiresApproval(definition, orgOverride) {
  if (definition.riskLevel === "HIGH") return true;
  if (definition.requiresApproval) return true;
  return orgOverride === true;
}
async function assertToolEnabledForOrg(organizationId, toolCode) {
  const setting = await prisma.aIOrgToolSetting.findUnique({
    where: { organizationId_toolCode: { organizationId, toolCode } }
  });
  if (setting && !setting.enabled) {
    throw new AuthorizationError(`AI tool "${toolCode}" has been disabled for this organization.`);
  }
}
async function executeGovernedTool(params) {
  const { caller, toolCode, input, executionId, stepOrder, meta = {} } = params;
  if (!isRegisteredToolCode(toolCode)) {
    throw new NotFoundError(`AI tool "${toolCode}" is not registered.`);
  }
  const definition = AI_TOOL_REGISTRY[toolCode];
  const toolRow = await prisma.aITool.findUnique({ where: { code: toolCode } });
  if (!toolRow || toolRow.status !== "ENABLED") {
    throw new NotFoundError(`AI tool "${toolCode}" is not available.`);
  }
  if (!hasPermission(caller, definition.requiredPermission)) {
    throw new AuthorizationError(`Permission denied for AI tool "${toolCode}". Required privilege: "${definition.requiredPermission}"`);
  }
  await assertToolEnabledForOrg(caller.organizationId, toolCode);
  const parseResult = definition.inputSchema.safeParse(input);
  if (!parseResult.success) {
    throw new ValidationError(`Invalid input for AI tool "${toolCode}": ${parseResult.error.message}`);
  }
  const validatedInput = parseResult.data;
  const orgSetting = await prisma.aIOrgToolSetting.findUnique({
    where: { organizationId_toolCode: { organizationId: caller.organizationId, toolCode } }
  });
  const requiresApproval = resolveRequiresApproval(definition, orgSetting?.requireApprovalOverride);
  const startedAt = /* @__PURE__ */ new Date();
  if (requiresApproval) {
    const toolExecution2 = await prisma.aIToolExecution.create({
      data: {
        executionId,
        toolCode,
        stepOrder,
        status: "AWAITING_APPROVAL",
        input: validatedInput,
        riskLevel: definition.riskLevel,
        requiresApproval: true,
        startedAt
      }
    });
    const approval = await prisma.aIApprovalRequest.create({
      data: {
        organizationId: caller.organizationId,
        executionId,
        toolExecutionId: toolExecution2.id,
        requestedById: caller.id,
        action: toolCode,
        resourceType: definition.riskLevel === "HIGH" ? toolCode.split(".")[0] : void 0,
        payload: validatedInput,
        payloadHash: payloadHash(validatedInput),
        status: "PENDING",
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1e3)
      }
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_TOOL_APPROVAL_REQUESTED",
      resourceType: "ai_tool",
      resourceId: toolCode,
      afterData: { approvalRequestId: approval.id, toolExecutionId: toolExecution2.id },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { status: "AWAITING_APPROVAL", toolExecutionId: toolExecution2.id, approvalRequestId: approval.id };
  }
  const toolExecution = await prisma.aIToolExecution.create({
    data: {
      executionId,
      toolCode,
      stepOrder,
      status: "RUNNING",
      input: validatedInput,
      riskLevel: definition.riskLevel,
      requiresApproval: false,
      startedAt
    }
  });
  return runToolHandler(definition, caller, validatedInput, meta, toolExecution.id);
}
async function runToolHandler(definition, caller, validatedInput, meta, toolExecutionId) {
  const startedAt = /* @__PURE__ */ new Date();
  try {
    const output = await definition.handler(caller, validatedInput, meta);
    const completedAt = /* @__PURE__ */ new Date();
    await prisma.aIToolExecution.update({
      where: { id: toolExecutionId },
      data: {
        status: "COMPLETED",
        output: output === void 0 ? Prisma5.JsonNull : output,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime()
      }
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "AI_COWORKER",
      actorName: `ai-tool:${definition.code}`,
      action: "AI_TOOL_EXECUTED",
      resourceType: "ai_tool",
      resourceId: definition.code,
      afterData: { toolExecutionId },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { status: "COMPLETED", output, toolExecutionId };
  } catch (err) {
    const completedAt = /* @__PURE__ */ new Date();
    const errorMessage = err instanceof Error ? err.message : "AI tool execution failed.";
    await prisma.aIToolExecution.update({
      where: { id: toolExecutionId },
      data: {
        status: "FAILED",
        errorMessage,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime()
      }
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "AI_COWORKER",
      actorName: `ai-tool:${definition.code}`,
      action: "AI_TOOL_EXECUTION_FAILED",
      resourceType: "ai_tool",
      resourceId: definition.code,
      result: "FAILURE",
      afterData: { toolExecutionId, error: errorMessage },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return { status: "FAILED", error: errorMessage, toolExecutionId };
  }
}

// server/services/aiWorkflowService.ts
function assertStepsValid(steps, maxSteps) {
  if (steps.length > maxSteps) {
    throw new ValidationError(`This workflow defines ${steps.length} steps, exceeding its own maxSteps (${maxSteps}).`);
  }
  for (const step of steps) {
    if (!isRegisteredToolCode(step.toolCode)) {
      throw new ValidationError(`Workflow step references unknown AI tool "${step.toolCode}".`);
    }
  }
}
async function loadWorkflowOrThrow(id, organizationId) {
  const workflow = await aiWorkflowRepository.findByIdInOrg(id, organizationId);
  if (!workflow) throw new NotFoundError("AI workflow not found.");
  return workflow;
}
var aiWorkflowService = {
  async listWorkflows(organizationId, filters, page, limit, sort, order) {
    return aiWorkflowRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getWorkflow(organizationId, id) {
    return loadWorkflowOrThrow(id, organizationId);
  },
  async createWorkflow(caller, input, meta = {}) {
    const existing = await aiWorkflowRepository.findByKeyInOrg(input.key, caller.organizationId);
    if (existing) throw new ConflictError(`A workflow with key "${input.key}" already exists in this organization.`);
    assertStepsValid(input.steps, input.maxSteps ?? 10);
    const workflow = await aiWorkflowRepository.create(caller.organizationId, caller.id, input);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_WORKFLOW_CREATED",
      resourceType: "ai_workflow",
      resourceId: workflow.id,
      afterData: { key: workflow.key, name: workflow.name },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return workflow;
  },
  async updateWorkflow(caller, id, input, meta = {}) {
    const existing = await loadWorkflowOrThrow(id, caller.organizationId);
    if (input.expectedUpdatedAt && existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new ConflictError("This workflow was modified by someone else since you loaded it.");
    }
    const { expectedUpdatedAt: _expectedUpdatedAt, ...patch } = input;
    if (patch.steps) {
      assertStepsValid(patch.steps, patch.maxSteps ?? existing.maxSteps);
    }
    const workflow = await aiWorkflowRepository.update(id, caller.id, patch);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_WORKFLOW_UPDATED",
      resourceType: "ai_workflow",
      resourceId: id,
      afterData: patch,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return workflow;
  },
  async publishWorkflow(caller, id, meta = {}) {
    await loadWorkflowOrThrow(id, caller.organizationId);
    const workflow = await aiWorkflowRepository.setStatus(id, "ACTIVE", caller.id);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_WORKFLOW_PUBLISHED",
      resourceType: "ai_workflow",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return workflow;
  },
  async archiveWorkflow(caller, id, meta = {}) {
    await loadWorkflowOrThrow(id, caller.organizationId);
    const workflow = await aiWorkflowRepository.setStatus(id, "ARCHIVED", caller.id);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_WORKFLOW_ARCHIVED",
      resourceType: "ai_workflow",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    return workflow;
  },
  /**
   * Runs a workflow's bounded steps in order through the governance
   * dispatcher. Stops at the first step that fails or requires approval —
   * there is no retry/resume in Phase 12 (that is Phase 13's async job
   * territory); a workflow left AWAITING_APPROVAL is a terminal state here,
   * re-run from scratch once the approval is resolved.
   */
  async executeWorkflow(caller, id, input, meta = {}) {
    const workflow = await loadWorkflowOrThrow(id, caller.organizationId);
    if (workflow.status !== "ACTIVE") {
      throw new ValidationError("Only an ACTIVE workflow can be executed.");
    }
    const steps = workflow.steps.slice().sort((a, b) => a.order - b.order);
    assertStepsValid(steps, workflow.maxSteps);
    const execution = await aiExecutionRepository.create({
      organizationId: caller.organizationId,
      userId: caller.id,
      kind: "WORKFLOW",
      workflowId: workflow.id,
      requestId: meta.requestId,
      input: input.stepInputs
    });
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_WORKFLOW_EXECUTION_STARTED",
      resourceType: "ai_execution",
      resourceId: execution.id,
      afterData: { workflowId: workflow.id, workflowKey: workflow.key },
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    const stepResults = [];
    const deadline = Date.now() + workflow.timeoutMs;
    for (const step of steps) {
      if (Date.now() > deadline) {
        const completed = await aiExecutionRepository.complete(execution.id, "FAILED", stepResults, "Workflow exceeded its timeout.");
        return completed;
      }
      const stepInput = input.stepInputs[String(step.order)] ?? {};
      const result = await executeGovernedTool({
        caller,
        toolCode: step.toolCode,
        input: stepInput,
        executionId: execution.id,
        stepOrder: step.order,
        meta
      });
      stepResults.push({ order: step.order, toolCode: step.toolCode, ...result });
      if (result.status === "AWAITING_APPROVAL") {
        return aiExecutionRepository.complete(execution.id, "AWAITING_APPROVAL", stepResults);
      }
      if (result.status === "FAILED") {
        return aiExecutionRepository.complete(execution.id, "FAILED", stepResults, result.error);
      }
    }
    return aiExecutionRepository.complete(execution.id, "COMPLETED", stepResults);
  }
};

// server/routes/v1/aiWorkflowRoutes.ts
var router33 = Router33();
router33.use(authenticateToken);
function requestMeta24(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId };
}
router33.get(
  "/",
  requirePermission("ai.workflows.read"),
  asyncHandler(async (req, res) => {
    const query = listAiWorkflowsQuerySchema.parse(req.query);
    const { rows, total } = await aiWorkflowService.listWorkflows(
      req.user.organizationId,
      { search: query.search },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { workflows: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router33.get(
  "/:id",
  requirePermission("ai.workflows.read"),
  asyncHandler(async (req, res) => {
    const workflow = await aiWorkflowService.getWorkflow(req.user.organizationId, req.params.id);
    sendSuccess(res, { workflow });
  })
);
router33.post(
  "/",
  requirePermission("ai.workflows.create"),
  asyncHandler(async (req, res) => {
    const input = createAiWorkflowSchema.parse(req.body);
    const workflow = await aiWorkflowService.createWorkflow(req.user, input, requestMeta24(req));
    sendSuccess(res, { workflow }, 201);
  })
);
router33.patch(
  "/:id",
  requirePermission("ai.workflows.update"),
  asyncHandler(async (req, res) => {
    const input = updateAiWorkflowSchema.parse(req.body);
    const workflow = await aiWorkflowService.updateWorkflow(req.user, req.params.id, input, requestMeta24(req));
    sendSuccess(res, { workflow });
  })
);
router33.post(
  "/:id/publish",
  requirePermission("ai.workflows.publish"),
  asyncHandler(async (req, res) => {
    const workflow = await aiWorkflowService.publishWorkflow(req.user, req.params.id, requestMeta24(req));
    sendSuccess(res, { workflow });
  })
);
router33.delete(
  "/:id",
  requirePermission("ai.workflows.delete"),
  asyncHandler(async (req, res) => {
    const workflow = await aiWorkflowService.archiveWorkflow(req.user, req.params.id, requestMeta24(req));
    sendSuccess(res, { workflow });
  })
);
router33.post(
  "/:id/execute",
  requirePermission("ai.workflows.execute"),
  aiExecutionLimiter,
  asyncHandler(async (req, res) => {
    const input = executeAiWorkflowSchema.parse(req.body);
    const execution = await aiWorkflowService.executeWorkflow(req.user, req.params.id, input, requestMeta24(req));
    sendSuccess(res, { execution }, 202);
  })
);
var aiWorkflowRoutes_default = router33;

// server/routes/v1/aiExecutionRoutes.ts
import { Router as Router34 } from "express";

// server/services/aiExecutionService.ts
var aiExecutionService = {
  async listExecutions(organizationId, filters, page, limit, sort, order) {
    return aiExecutionRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getExecution(organizationId, id) {
    const execution = await aiExecutionRepository.findByIdInOrg(id, organizationId);
    if (!execution) throw new NotFoundError("AI execution not found.");
    return execution;
  },
  /** A single governed tool call, outside of any workflow — e.g. a human coworker's assistant panel invoking one action directly. */
  async executeTool(caller, input, meta = {}) {
    const execution = await aiExecutionRepository.create({
      organizationId: caller.organizationId,
      userId: caller.id,
      kind: "TOOL_CALL",
      toolCode: input.toolCode,
      requestId: meta.requestId,
      input: input.input
    });
    const result = await executeGovernedTool({
      caller,
      toolCode: input.toolCode,
      input: input.input,
      executionId: execution.id,
      meta
    });
    if (result.status === "AWAITING_APPROVAL") {
      return aiExecutionRepository.complete(execution.id, "AWAITING_APPROVAL", result);
    }
    if (result.status === "FAILED") {
      return aiExecutionRepository.complete(execution.id, "FAILED", result, result.error);
    }
    return aiExecutionRepository.complete(execution.id, "COMPLETED", result);
  }
};

// server/routes/v1/aiExecutionRoutes.ts
var router34 = Router34();
router34.use(authenticateToken);
function requestMeta25(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId };
}
router34.get(
  "/",
  requirePermission("ai.executions.read"),
  asyncHandler(async (req, res) => {
    const query = listAiExecutionsQuerySchema.parse(req.query);
    const { rows, total } = await aiExecutionService.listExecutions(
      req.user.organizationId,
      { kind: query.kind, status: query.status },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { executions: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router34.get(
  "/:id",
  requirePermission("ai.executions.read"),
  asyncHandler(async (req, res) => {
    const execution = await aiExecutionService.getExecution(req.user.organizationId, req.params.id);
    sendSuccess(res, { execution });
  })
);
router34.post(
  "/tool-call",
  // Reuses ai.workflows.execute — "can invoke governed AI actions" is one
  // capability whether the call is wrapped in a workflow or made directly;
  // server/ai/governance.ts still checks the specific tool's own
  // requiredPermission on top of this route-level gate.
  requirePermission("ai.workflows.execute"),
  aiExecutionLimiter,
  asyncHandler(async (req, res) => {
    const input = executeAiToolSchema.parse(req.body);
    const execution = await aiExecutionService.executeTool(req.user, input, requestMeta25(req));
    sendSuccess(res, { execution }, 202);
  })
);
var aiExecutionRoutes_default = router34;

// server/routes/v1/aiUsageRoutes.ts
import { Router as Router35 } from "express";

// server/repositories/aiUsageRepository.ts
var aiUsageRepository = {
  async record(data) {
    return prisma.aIUsageRecord.create({
      data: {
        organizationId: data.organizationId,
        executionId: data.executionId,
        providerId: data.providerId,
        modelId: data.modelId,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.totalTokens,
        estimatedCost: data.estimatedCost,
        currency: data.currency ?? "USD"
      }
    });
  },
  async listForOrg(organizationId, dateFrom, dateTo) {
    return prisma.aIUsageRecord.findMany({
      where: {
        organizationId,
        ...dateFrom || dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {}
      },
      orderBy: { createdAt: "desc" }
    });
  },
  async summaryForOrg(organizationId, dateFrom, dateTo) {
    const where = {
      organizationId,
      ...dateFrom || dateTo ? { createdAt: { gte: dateFrom, lte: dateTo } } : {}
    };
    const [totals, byModel] = await Promise.all([
      prisma.aIUsageRecord.aggregate({
        where,
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, estimatedCost: true },
        _count: true
      }),
      prisma.aIUsageRecord.groupBy({
        by: ["modelId"],
        where,
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true, estimatedCost: true },
        _count: true
      })
    ]);
    return { totals, byModel };
  }
};

// server/services/aiUsageService.ts
var aiUsageService = {
  async listUsage(organizationId, dateFrom, dateTo) {
    return aiUsageRepository.listForOrg(organizationId, dateFrom, dateTo);
  },
  async summary(organizationId, dateFrom, dateTo) {
    return aiUsageRepository.summaryForOrg(organizationId, dateFrom, dateTo);
  }
};

// server/routes/v1/aiUsageRoutes.ts
var router35 = Router35();
router35.use(authenticateToken);
router35.use(requirePermission("ai.usage.read"));
router35.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = usageSummaryQuerySchema.parse(req.query);
    const records = await aiUsageService.listUsage(req.user.organizationId, query.dateFrom, query.dateTo);
    sendSuccess(res, { usageRecords: records });
  })
);
router35.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const query = usageSummaryQuerySchema.parse(req.query);
    const summary = await aiUsageService.summary(req.user.organizationId, query.dateFrom, query.dateTo);
    sendSuccess(res, { summary });
  })
);
var aiUsageRoutes_default = router35;

// server/routes/v1/aiApprovalRoutes.ts
import { Router as Router36 } from "express";

// server/services/aiApprovalService.ts
import crypto2 from "crypto";

// server/repositories/aiApprovalRepository.ts
var aiApprovalRepository = {
  async list(organizationId, filters, page, limit, sort, order) {
    const where = { organizationId, ...filters };
    const [rows, total] = await Promise.all([
      prisma.aIApprovalRequest.findMany({
        where,
        include: { toolExecution: true, requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit
      }),
      prisma.aIApprovalRequest.count({ where })
    ]);
    return { rows, total };
  },
  async findByIdInOrg(id, organizationId) {
    return prisma.aIApprovalRequest.findFirst({
      where: { id, organizationId },
      include: { toolExecution: true, execution: true }
    });
  },
  async approve(id, approvedById) {
    return prisma.aIApprovalRequest.update({
      where: { id },
      data: { status: "APPROVED", approvedById, approvedAt: /* @__PURE__ */ new Date() }
    });
  },
  async reject(id, approvedById, rejectionReason) {
    return prisma.aIApprovalRequest.update({
      where: { id },
      data: { status: "REJECTED", approvedById, approvedAt: /* @__PURE__ */ new Date(), rejectionReason }
    });
  },
  async expireStale() {
    return prisma.aIApprovalRequest.updateMany({
      where: { status: "PENDING", expiresAt: { lt: /* @__PURE__ */ new Date() } },
      data: { status: "EXPIRED" }
    });
  }
};

// server/services/aiApprovalService.ts
function payloadHash2(input) {
  return crypto2.createHash("sha256").update(JSON.stringify(input ?? {})).digest("hex");
}
var aiApprovalService = {
  async listApprovals(organizationId, filters, page, limit, sort, order) {
    return aiApprovalRepository.list(organizationId, filters, page, limit, sort, order);
  },
  async getApproval(organizationId, id) {
    const approval = await aiApprovalRepository.findByIdInOrg(id, organizationId);
    if (!approval) throw new NotFoundError("AI approval request not found.");
    return approval;
  },
  async decide(caller, id, input, meta = {}) {
    const approval = await this.getApproval(caller.organizationId, id);
    if (approval.status !== "PENDING") {
      throw new ConflictError(`This approval request has already been ${approval.status.toLowerCase()}.`);
    }
    if (approval.expiresAt.getTime() < Date.now()) {
      await aiApprovalRepository.reject(id, caller.id, "Expired before a decision was made.");
      throw new ConflictError("This approval request has expired.");
    }
    if (payloadHash2(approval.payload) !== approval.payloadHash) {
      throw new ConflictError("This approval request's payload no longer matches what was requested; it cannot be approved.");
    }
    if (input.decision === "REJECT") {
      const rejected = await aiApprovalRepository.reject(id, caller.id, input.rejectionReason);
      if (approval.toolExecutionId) {
        await prisma.aIToolExecution.update({ where: { id: approval.toolExecutionId }, data: { status: "CANCELLED" } });
      }
      await auditLogRepository.record({
        organizationId: caller.organizationId,
        actorUserId: caller.id,
        actorType: "USER",
        action: "AI_APPROVAL_REJECTED",
        resourceType: "ai_approval_request",
        resourceId: id,
        afterData: { rejectionReason: input.rejectionReason },
        ipAddress: meta.ip,
        userAgent: meta.userAgent
      });
      return rejected;
    }
    if (!approval.toolExecutionId) {
      throw new ValidationError("This approval request has no associated tool execution to run.");
    }
    if (!isRegisteredToolCode(approval.action)) {
      throw new ValidationError(`AI tool "${approval.action}" is no longer registered.`);
    }
    const definition = AI_TOOL_REGISTRY[approval.action];
    const parsed = definition.inputSchema.safeParse(approval.payload);
    if (!parsed.success) {
      throw new ValidationError(`Approved payload no longer matches "${approval.action}"'s current input schema.`);
    }
    const approved = await aiApprovalRepository.approve(id, caller.id);
    await auditLogRepository.record({
      organizationId: caller.organizationId,
      actorUserId: caller.id,
      actorType: "USER",
      action: "AI_APPROVAL_APPROVED",
      resourceType: "ai_approval_request",
      resourceId: id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent
    });
    const requestingUser = await userRepository.findById(approval.requestedById);
    if (!requestingUser) {
      throw new NotFoundError("The user who originally requested this action no longer exists.");
    }
    const requesterCaller = await resolveSanitizedUserForOrganization(requestingUser, approval.organizationId);
    if (!requesterCaller) {
      throw new ConflictError("The user who originally requested this action no longer has access to this organization.");
    }
    await runToolHandler(definition, requesterCaller, parsed.data, meta, approval.toolExecutionId);
    return approved;
  }
};

// server/routes/v1/aiApprovalRoutes.ts
var router36 = Router36();
router36.use(authenticateToken);
function requestMeta26(req) {
  return { ip: req.ip, userAgent: req.headers["user-agent"], requestId: req.requestId };
}
router36.get(
  "/",
  requirePermission("ai.approvals.read"),
  asyncHandler(async (req, res) => {
    const query = listAiApprovalsQuerySchema.parse(req.query);
    const { rows, total } = await aiApprovalService.listApprovals(
      req.user.organizationId,
      { status: query.status },
      query.page,
      query.limit,
      query.sort,
      query.order
    );
    sendSuccess(res, { approvals: rows }, 200, { page: query.page, limit: query.limit, total });
  })
);
router36.get(
  "/:id",
  requirePermission("ai.approvals.read"),
  asyncHandler(async (req, res) => {
    const approval = await aiApprovalService.getApproval(req.user.organizationId, req.params.id);
    sendSuccess(res, { approval });
  })
);
router36.post(
  "/:id/decide",
  requirePermission("ai.approvals.decide"),
  asyncHandler(async (req, res) => {
    const input = decideAiApprovalSchema.parse(req.body);
    const approval = await aiApprovalService.decide(req.user, req.params.id, input, requestMeta26(req));
    sendSuccess(res, { approval });
  })
);
var aiApprovalRoutes_default = router36;

// server/routes/v1/automationRoutes.ts
import { Router as Router37 } from "express";
import { z as z31 } from "zod";

// server/services/automation/AutomationService.ts
import crypto11 from "node:crypto";

// server/services/automation/ConditionEngine.ts
var ConditionEngine = class {
  /**
   * Safely resolves a nested property path from an object (e.g., 'invoice.amount' or 'payload.client.email').
   */
  static resolvePath(obj, path) {
    if (!obj || typeof obj !== "object" || !path) {
      return void 0;
    }
    const segments = path.split(".").map((s) => s.trim()).filter(Boolean);
    let current = obj;
    for (const segment of segments) {
      if (current === null || current === void 0) {
        return void 0;
      }
      if (typeof current !== "object") {
        return void 0;
      }
      current = current[segment];
    }
    return current;
  }
  /**
   * Evaluates a single condition against the context.
   */
  static evaluateSingle(condition, context) {
    const actual = this.resolvePath(context, condition.field);
    const expected = condition.value;
    return this.compare(actual, condition.operator, expected);
  }
  /**
   * Safely compares actual vs expected using defined operators.
   */
  static compare(actual, operator, expected) {
    switch (operator) {
      case "=":
      case "==":
      case "===": {
        if (typeof actual === "number" && typeof expected === "string") {
          return actual === Number(expected);
        }
        if (typeof actual === "string" && typeof expected === "number") {
          return Number(actual) === expected;
        }
        return actual === expected;
      }
      case "!=":
      case "!==": {
        if (typeof actual === "number" && typeof expected === "string") {
          return actual !== Number(expected);
        }
        if (typeof actual === "string" && typeof expected === "number") {
          return Number(actual) !== expected;
        }
        return actual !== expected;
      }
      case ">": {
        const numActual = Number(actual);
        const numExpected = Number(expected);
        if (isNaN(numActual) || isNaN(numExpected)) return false;
        return numActual > numExpected;
      }
      case ">=": {
        const numActual = Number(actual);
        const numExpected = Number(expected);
        if (isNaN(numActual) || isNaN(numExpected)) return false;
        return numActual >= numExpected;
      }
      case "<": {
        const numActual = Number(actual);
        const numExpected = Number(expected);
        if (isNaN(numActual) || isNaN(numExpected)) return false;
        return numActual < numExpected;
      }
      case "<=": {
        const numActual = Number(actual);
        const numExpected = Number(expected);
        if (isNaN(numActual) || isNaN(numExpected)) return false;
        return numActual <= numExpected;
      }
      case "IN": {
        if (Array.isArray(expected)) {
          return expected.includes(actual);
        }
        if (typeof expected === "string") {
          return expected.split(",").map((s) => s.trim()).includes(String(actual));
        }
        return false;
      }
      case "NOT_IN": {
        if (Array.isArray(expected)) {
          return !expected.includes(actual);
        }
        if (typeof expected === "string") {
          return !expected.split(",").map((s) => s.trim()).includes(String(actual));
        }
        return true;
      }
      case "CONTAINS": {
        if (Array.isArray(actual)) {
          return actual.includes(expected);
        }
        if (typeof actual === "string") {
          return actual.toLowerCase().includes(String(expected).toLowerCase());
        }
        return false;
      }
      case "NOT_CONTAINS": {
        if (Array.isArray(actual)) {
          return !actual.includes(expected);
        }
        if (typeof actual === "string") {
          return !actual.toLowerCase().includes(String(expected).toLowerCase());
        }
        return true;
      }
      case "IS_EMPTY": {
        if (actual === null || actual === void 0) return true;
        if (typeof actual === "string") return actual.trim().length === 0;
        if (Array.isArray(actual)) return actual.length === 0;
        if (typeof actual === "object") return Object.keys(actual).length === 0;
        return false;
      }
      case "IS_NOT_EMPTY": {
        if (actual === null || actual === void 0) return false;
        if (typeof actual === "string") return actual.trim().length > 0;
        if (Array.isArray(actual)) return actual.length > 0;
        if (typeof actual === "object") return Object.keys(actual).length > 0;
        return true;
      }
      case "STARTS_WITH": {
        if (typeof actual === "string" && typeof expected === "string") {
          return actual.startsWith(expected);
        }
        return false;
      }
      case "ENDS_WITH": {
        if (typeof actual === "string" && typeof expected === "string") {
          return actual.endsWith(expected);
        }
        return false;
      }
      default:
        return false;
    }
  }
  /**
   * Recursively evaluates a condition or nested condition group.
   */
  static evaluate(condition, context) {
    if (!condition) return true;
    if (Array.isArray(condition)) {
      if (condition.length === 0) return true;
      return condition.every((cond) => this.evaluate(cond, context));
    }
    if ("logic" in condition && Array.isArray(condition.conditions)) {
      const group = condition;
      if (group.conditions.length === 0) return true;
      if (group.logic === "OR") {
        return group.conditions.some((child) => this.evaluate(child, context));
      }
      return group.conditions.every((child) => this.evaluate(child, context));
    }
    if ("field" in condition && "operator" in condition) {
      return this.evaluateSingle(condition, context);
    }
    return true;
  }
};

// server/services/automation/EventEngine.ts
import crypto3 from "node:crypto";
var EventEngine = class _EventEngine {
  constructor() {
    this.eventRegistry = /* @__PURE__ */ new Map();
    this.listeners = [];
    this.registerStandardEvents();
  }
  static getInstance() {
    if (!_EventEngine.instance) {
      _EventEngine.instance = new _EventEngine();
    }
    return _EventEngine.instance;
  }
  /**
   * Registers default Artify business event types.
   */
  registerStandardEvents() {
    const standardEvents = [
      // CRM & Clients
      { eventType: "client.created", entityType: "client", sourceModule: "CRM", description: "Triggered when a new client record is created" },
      { eventType: "client.updated", entityType: "client", sourceModule: "CRM", description: "Triggered when client details are updated" },
      { eventType: "client.onboarded", entityType: "client", sourceModule: "ONBOARDING", description: "Triggered when client onboarding is completed" },
      // Projects
      { eventType: "project.created", entityType: "project", sourceModule: "PROJECTS", description: "Triggered when a new client project is initiated" },
      { eventType: "project.status_changed", entityType: "project", sourceModule: "PROJECTS", description: "Triggered when project workflow status changes" },
      // Products & Catalog
      { eventType: "product.created", entityType: "product", sourceModule: "CATALOG", description: "Triggered when a new service/product is added" },
      { eventType: "product.updated", entityType: "product", sourceModule: "CATALOG", description: "Triggered when a product/service is updated" },
      // Commercial & Billing
      { eventType: "invoice.created", entityType: "invoice", sourceModule: "BILLING", description: "Triggered when a new invoice is created" },
      { eventType: "invoice.overdue", entityType: "invoice", sourceModule: "BILLING", description: "Triggered when an invoice passes its due date without payment" },
      { eventType: "invoice.paid", entityType: "invoice", sourceModule: "BILLING", description: "Triggered when an invoice is fully marked paid" },
      { eventType: "payment.created", entityType: "payment", sourceModule: "BILLING", description: "Triggered when a payment is recorded" },
      { eventType: "payment.failed", entityType: "payment", sourceModule: "BILLING", description: "Triggered when a payment attempt fails" },
      // CMS & Content
      { eventType: "cms.content_created", entityType: "content", sourceModule: "CMS", description: "Triggered when CMS page or post is drafted" },
      { eventType: "cms.content_updated", entityType: "content", sourceModule: "CMS", description: "Triggered when CMS content revision is updated" },
      { eventType: "cms.content_published", entityType: "content", sourceModule: "CMS", description: "Triggered when CMS content is published" },
      // Identity & RBAC
      { eventType: "user.created", entityType: "user", sourceModule: "AUTH", description: "Triggered when a new team member is registered" },
      { eventType: "user.role_changed", entityType: "user", sourceModule: "RBAC", description: "Triggered when a user's role/permissions change" },
      // Automation Lifecycle
      { eventType: "workflow.created", entityType: "workflow", sourceModule: "AUTOMATION", description: "Triggered when a new workflow is configured" },
      { eventType: "workflow.failed", entityType: "workflow", sourceModule: "AUTOMATION", description: "Triggered when an execution fails" },
      { eventType: "workflow.completed", entityType: "workflow", sourceModule: "AUTOMATION", description: "Triggered when an execution completes" }
    ];
    for (const evt of standardEvents) {
      this.eventRegistry.set(evt.eventType, evt);
    }
  }
  /**
   * Register a custom event dynamically.
   */
  registerEvent(registration) {
    this.eventRegistry.set(registration.eventType, registration);
  }
  /**
   * List all registered event descriptors.
   */
  listRegisteredEvents() {
    return Array.from(this.eventRegistry.values());
  }
  /**
   * Subscribe to business events.
   */
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  /**
   * Emits a business event into the system.
   * Sanitizes payload, persists to automation_events, and dispatches to subscribers.
   */
  async emit(params) {
    const eventId = crypto3.randomUUID();
    const correlationId = params.correlationId || crypto3.randomUUID();
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const registered = this.eventRegistry.get(params.eventType);
    const sourceModule = params.sourceModule || registered?.sourceModule || "SYSTEM";
    const sanitizedPayload = this.sanitizePayload(params.payload);
    const event = {
      eventId,
      eventType: params.eventType,
      entityType: params.entityType,
      entityId: params.entityId,
      organizationId: params.organizationId,
      actorId: params.actorId,
      actorType: params.actorType || "USER",
      timestamp,
      payload: sanitizedPayload,
      correlationId,
      sourceModule
    };
    try {
      await prisma.automationEvent.create({
        data: {
          id: eventId,
          organizationId: params.organizationId,
          eventType: params.eventType,
          entityType: params.entityType,
          entityId: params.entityId,
          actorId: params.actorId || null,
          actorType: event.actorType,
          sourceModule,
          correlationId,
          payload: sanitizedPayload,
          processed: false
        }
      });
    } catch (err) {
      logger.error({ err, eventId }, "[EventEngine] Failed to persist automation event");
    }
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (err) {
        logger.error({ err, eventId, eventType: params.eventType }, "[EventEngine] Listener error");
      }
    }
    return event;
  }
  /**
   * Sanitizes payload by stripping sensitive keys.
   */
  sanitizePayload(data) {
    if (!data || typeof data !== "object") return data;
    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizePayload(item));
    }
    const sanitized = {};
    const sensitiveKeys = /* @__PURE__ */ new Set([
      "password",
      "passwordhash",
      "token",
      "accesstoken",
      "refreshtoken",
      "secret",
      "apikey",
      "sessionsecret"
    ]);
    for (const [key, value] of Object.entries(data)) {
      if (sensitiveKeys.has(key.toLowerCase())) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitizePayload(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
};
var eventEngine = EventEngine.getInstance();

// server/services/automation/ActionRegistry.ts
import { z as z29 } from "zod";
import crypto4 from "node:crypto";
var ActionRegistry = class _ActionRegistry {
  constructor() {
    this.actions = /* @__PURE__ */ new Map();
    this.registerStandardActions();
  }
  static getInstance() {
    if (!_ActionRegistry.instance) {
      _ActionRegistry.instance = new _ActionRegistry();
    }
    return _ActionRegistry.instance;
  }
  registerAction(action) {
    this.actions.set(action.id, action);
  }
  getAction(id) {
    return this.actions.get(id);
  }
  listActions() {
    return Array.from(this.actions.values()).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      requiredPermission: a.requiredPermission,
      riskLevel: a.riskLevel,
      requiresApproval: a.requiresApproval,
      requiresAudit: a.requiresAudit
    }));
  }
  registerStandardActions() {
    this.registerAction({
      id: "create_task",
      name: "Create Task",
      description: "Creates an automated or AI-recommended business task assigned to a team member or role",
      requiredPermission: "automation.execute",
      riskLevel: "LOW",
      requiresApproval: false,
      requiresAudit: true,
      inputSchema: z29.object({
        title: z29.string().min(1),
        description: z29.string().optional(),
        assignedUserId: z29.string().optional(),
        assignedRole: z29.string().optional(),
        priority: z29.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
        dueDate: z29.string().optional(),
        sourceEntityType: z29.string().optional(),
        sourceEntityId: z29.string().optional(),
        isAiGenerated: z29.boolean().default(true),
        metadata: z29.record(z29.unknown()).optional()
      }),
      outputSchema: z29.object({ taskId: z29.string(), title: z29.string(), status: z29.string() }),
      execute: async (input, context) => {
        const taskId = crypto4.randomUUID();
        const dueDate = input.dueDate ? new Date(input.dueDate) : null;
        const task = await prisma.automationTask.create({
          data: {
            id: taskId,
            organizationId: context.organizationId,
            title: input.title,
            description: input.description || null,
            assignedUserId: input.assignedUserId || null,
            assignedRole: input.assignedRole || null,
            priority: input.priority,
            status: "PENDING",
            dueDate,
            sourceWorkflowId: context.workflowId || null,
            sourceExecutionId: context.executionId || null,
            sourceEntityType: input.sourceEntityType || null,
            sourceEntityId: input.sourceEntityId || null,
            isAiGenerated: input.isAiGenerated,
            metadata: input.metadata || {}
          }
        });
        return { taskId: task.id, title: task.title, status: task.status };
      }
    });
    this.registerAction({
      id: "update_client",
      name: "Update Client Details",
      description: "Updates CRM client status or notes based on automation workflow",
      requiredPermission: "clients.update",
      riskLevel: "MEDIUM",
      requiresApproval: false,
      requiresAudit: true,
      inputSchema: z29.object({
        clientId: z29.string().min(1),
        status: z29.enum(["PROSPECT", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
        notes: z29.string().optional()
      }),
      outputSchema: z29.object({ clientId: z29.string(), updated: z29.boolean() }),
      execute: async (input, context) => {
        const client3 = await prisma.client.findFirst({ where: { id: input.clientId, organizationId: context.organizationId } });
        if (!client3) {
          throw new Error(`Client with id ${input.clientId} not found in organization.`);
        }
        const updateData = {};
        if (input.status) updateData.status = input.status;
        if (input.notes) updateData.notes = input.notes;
        if (Object.keys(updateData).length > 0) {
          await prisma.client.update({ where: { id: client3.id }, data: updateData });
        }
        return { clientId: client3.id, updated: true };
      }
    });
    this.registerAction({
      id: "create_notification",
      name: "Create Notification",
      description: "Creates an in-app and system notification for target user or role",
      requiredPermission: "automation.execute",
      riskLevel: "LOW",
      requiresApproval: false,
      requiresAudit: false,
      inputSchema: z29.object({
        userId: z29.string().optional(),
        recipientRole: z29.string().optional(),
        title: z29.string().min(1),
        message: z29.string().min(1),
        level: z29.enum(["INFO", "WARNING", "ERROR", "SUCCESS"]).default("INFO"),
        channel: z29.enum(["IN_APP", "EMAIL", "SMS", "WEBHOOK"]).default("IN_APP"),
        metadata: z29.record(z29.unknown()).optional()
      }),
      outputSchema: z29.object({ notificationId: z29.string(), delivered: z29.boolean() }),
      execute: async (input, context) => {
        const notifId = crypto4.randomUUID();
        const autoNotif = await prisma.automationNotification.create({
          data: {
            id: notifId,
            organizationId: context.organizationId,
            userId: input.userId || null,
            recipientRole: input.recipientRole || null,
            channel: input.channel,
            title: input.title,
            message: input.message,
            level: input.level,
            status: "DELIVERED",
            sourceWorkflowId: context.workflowId || null,
            sourceExecutionId: context.executionId || null,
            metadata: input.metadata || {}
          }
        });
        if (input.userId) {
          try {
            await prisma.notification.create({
              data: {
                id: crypto4.randomUUID(),
                organizationId: context.organizationId,
                userId: input.userId,
                title: input.title,
                message: input.message,
                type: input.level === "ERROR" ? "SYSTEM_ALERT" : "WORKFLOW_UPDATE",
                status: "UNREAD"
              }
            });
          } catch (err) {
            logger.warn({ err }, "[ActionRegistry] Optional core notification write skipped");
          }
        }
        return { notificationId: autoNotif.id, delivered: true };
      }
    });
    this.registerAction({
      id: "assign_user",
      name: "Assign User to Entity",
      description: "Assigns a team member to a lead, client, or task",
      requiredPermission: "automation.execute",
      riskLevel: "MEDIUM",
      requiresApproval: false,
      requiresAudit: true,
      inputSchema: z29.object({
        entityType: z29.enum(["LEAD", "CLIENT", "TASK"]),
        entityId: z29.string().min(1),
        userId: z29.string().min(1)
      }),
      outputSchema: z29.object({ entityId: z29.string(), assignedUserId: z29.string(), success: z29.boolean() }),
      execute: async (input, _context) => {
        if (input.entityType === "LEAD") {
          await prisma.lead.update({ where: { id: input.entityId }, data: { assignedTo: input.userId } });
        } else if (input.entityType === "CLIENT") {
          await prisma.client.update({ where: { id: input.entityId }, data: { accountManager: input.userId } });
        } else if (input.entityType === "TASK") {
          await prisma.automationTask.update({ where: { id: input.entityId }, data: { assignedUserId: input.userId } });
        }
        return { entityId: input.entityId, assignedUserId: input.userId, success: true };
      }
    });
    this.registerAction({
      id: "generate_report",
      name: "Generate Report",
      description: "Generates a structured automation or performance report",
      requiredPermission: "reports.read",
      riskLevel: "LOW",
      requiresApproval: false,
      requiresAudit: true,
      inputSchema: z29.object({ reportType: z29.string(), title: z29.string(), parameters: z29.record(z29.unknown()).optional() }),
      outputSchema: z29.object({ reportId: z29.string(), generatedAt: z29.string(), summary: z29.string() }),
      execute: async (input, context) => {
        const reportId = crypto4.randomUUID();
        const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
        return { reportId, generatedAt, summary: `Report "${input.title}" (${input.reportType}) generated successfully for workflow ${context.workflowId || "manual"}.` };
      }
    });
    this.registerAction({
      id: "create_invoice_draft",
      name: "Create Invoice Draft",
      description: "Drafts a new invoice requiring accounts review or automation dispatch",
      requiredPermission: "invoices.create",
      riskLevel: "HIGH",
      requiresApproval: true,
      requiresAudit: true,
      inputSchema: z29.object({
        clientId: z29.string().min(1),
        amountDue: z29.number().positive(),
        currency: z29.string().default("USD"),
        dueDate: z29.string().optional(),
        memo: z29.string().optional()
      }),
      outputSchema: z29.object({ draftCreated: z29.boolean(), invoiceNumber: z29.string(), amountDue: z29.number() }),
      execute: async (input, _context) => {
        const invoiceNumber = `INV-DRAFT-${Date.now().toString(36).toUpperCase()}`;
        return { draftCreated: true, invoiceNumber, amountDue: input.amountDue };
      }
    });
    this.registerAction({
      id: "update_workflow_status",
      name: "Update Workflow Status",
      description: "Controls the active or paused status of an automated workflow",
      requiredPermission: "automation.manage",
      riskLevel: "HIGH",
      requiresApproval: false,
      requiresAudit: true,
      inputSchema: z29.object({ workflowId: z29.string().min(1), status: z29.enum(["ACTIVE", "PAUSED", "ARCHIVED"]) }),
      outputSchema: z29.object({ workflowId: z29.string(), newStatus: z29.string() }),
      execute: async (input, _context) => {
        const updated = await prisma.automationWorkflow.update({ where: { id: input.workflowId }, data: { status: input.status } });
        return { workflowId: updated.id, newStatus: updated.status };
      }
    });
    this.registerAction({
      id: "publish_approved_content",
      name: "Publish Approved Content",
      description: "Publishes approved CMS page or post content",
      requiredPermission: "content.publish",
      riskLevel: "HIGH",
      requiresApproval: true,
      requiresAudit: true,
      inputSchema: z29.object({ contentType: z29.enum(["PAGE", "POST"]), contentId: z29.string().min(1) }),
      outputSchema: z29.object({ contentId: z29.string(), published: z29.boolean() }),
      execute: async (input, _context) => {
        if (input.contentType === "PAGE") {
          await prisma.page.update({ where: { id: input.contentId }, data: { status: "PUBLISHED", publishedAt: /* @__PURE__ */ new Date() } });
        } else {
          await prisma.post.update({ where: { id: input.contentId }, data: { status: "PUBLISHED", publishedAt: /* @__PURE__ */ new Date() } });
        }
        return { contentId: input.contentId, published: true };
      }
    });
    this.registerAction({
      id: "send_approved_notification",
      name: "Send Approved Notification",
      description: "Dispatches a high-priority approved notification",
      requiredPermission: "automation.execute",
      riskLevel: "MEDIUM",
      requiresApproval: true,
      requiresAudit: true,
      inputSchema: z29.object({ recipientUserId: z29.string().min(1), title: z29.string().min(1), message: z29.string().min(1) }),
      outputSchema: z29.object({ sent: z29.boolean() }),
      execute: async (input, context) => {
        await prisma.automationNotification.create({
          data: {
            id: crypto4.randomUUID(),
            organizationId: context.organizationId,
            userId: input.recipientUserId,
            channel: "IN_APP",
            title: input.title,
            message: input.message,
            level: "INFO",
            status: "DELIVERED",
            sourceWorkflowId: context.workflowId || null,
            sourceExecutionId: context.executionId || null
          }
        });
        return { sent: true };
      }
    });
  }
  /**
   * Executes a registered action with safety checks, idempotency, and audit logging.
   */
  async executeAction(params) {
    const action = this.actions.get(params.actionId);
    if (!action) {
      throw new Error(`Business action "${params.actionId}" is not registered in the system.`);
    }
    if (action.requiredPermission && !params.userPermissions.includes(action.requiredPermission) && !params.userPermissions.includes("*")) {
      throw new Error(`Forbidden: missing required permission "${action.requiredPermission}" for action "${action.id}".`);
    }
    const validatedInput = action.inputSchema.parse(params.input);
    if (params.idempotencyKey) {
      const existing = await prisma.automationActionExecution.findFirst({
        where: { organizationId: params.organizationId, idempotencyKey: params.idempotencyKey, status: "SUCCESS" }
      });
      if (existing) {
        logger.info({ idempotencyKey: params.idempotencyKey, actionId: params.actionId }, "[ActionRegistry] Returning idempotent cached action output");
        return existing.output;
      }
    }
    const startTime = Date.now();
    let actionOutput;
    let actionStatus = "SUCCESS";
    let errorMessage = null;
    try {
      actionOutput = await action.execute(validatedInput, {
        organizationId: params.organizationId,
        userId: params.userId,
        workflowId: params.workflowId,
        executionId: params.executionId,
        stepId: params.stepId,
        correlationId: params.correlationId
      });
      actionOutput = action.outputSchema.parse(actionOutput);
    } catch (err) {
      actionStatus = "FAILED";
      errorMessage = err?.message || String(err);
      throw err;
    } finally {
      const durationMs = Date.now() - startTime;
      if (params.executionId) {
        try {
          await prisma.automationActionExecution.create({
            data: {
              id: crypto4.randomUUID(),
              organizationId: params.organizationId,
              executionId: params.executionId,
              stepId: params.stepId || "action_step",
              actionId: params.actionId,
              status: actionStatus,
              input: validatedInput,
              output: actionOutput || {},
              idempotencyKey: params.idempotencyKey || null,
              durationMs,
              errorMessage
            }
          });
        } catch (recErr) {
          logger.warn({ recErr }, "[ActionRegistry] Failed to record action execution");
        }
      }
      if (action.requiresAudit) {
        await auditLogRepository.record({
          organizationId: params.organizationId,
          actorUserId: params.userId || void 0,
          actorType: params.userId ? "USER" : "SYSTEM",
          action: `AUTOMATION_ACTION_${params.actionId.toUpperCase()}`,
          resourceType: "automation_action",
          resourceId: params.actionId,
          metadata: { workflowId: params.workflowId, executionId: params.executionId, stepId: params.stepId, status: actionStatus, riskLevel: action.riskLevel, correlationId: params.correlationId }
        });
      }
    }
    return actionOutput;
  }
};
var actionRegistry = ActionRegistry.getInstance();

// server/services/automation/ApprovalEngine.ts
import crypto5 from "node:crypto";
var ApprovalEngine = class _ApprovalEngine {
  static getInstance() {
    if (!_ApprovalEngine.instance) {
      _ApprovalEngine.instance = new _ApprovalEngine();
    }
    return _ApprovalEngine.instance;
  }
  /**
   * Request human approval for an automation workflow step.
   */
  async requestApproval(params) {
    const approvalId = crypto5.randomUUID();
    const expiresAt = params.timeoutMinutes ? new Date(Date.now() + params.timeoutMinutes * 60 * 1e3) : null;
    const approval = await prisma.automationApproval.create({
      data: {
        id: approvalId,
        organizationId: params.organizationId,
        executionId: params.executionId,
        stepExecutionId: params.stepExecutionId || null,
        workflowId: params.workflowId,
        stepId: params.stepId,
        action: params.action,
        description: params.description || null,
        entityType: params.entityType || null,
        entityId: params.entityId || null,
        payload: params.payload,
        requiredRole: params.requiredRole || null,
        status: "PENDING",
        requesterId: params.requesterId || null,
        expiresAt
      }
    });
    await auditLogRepository.record({
      organizationId: params.organizationId,
      actorUserId: params.requesterId || void 0,
      actorType: params.requesterId ? "USER" : "SYSTEM",
      action: "AUTOMATION_APPROVAL_REQUESTED",
      resourceType: "automation_approval",
      resourceId: approval.id,
      metadata: { workflowId: params.workflowId, executionId: params.executionId, stepId: params.stepId, action: params.action }
    });
    return { approvalId: approval.id, status: "PENDING" };
  }
  /**
   * Decide on a pending approval (APPROVE / REJECT).
   */
  async decideApproval(params) {
    const approval = await prisma.automationApproval.findFirst({
      where: { id: params.approvalId, organizationId: params.organizationId }
    });
    if (!approval) {
      throw new NotFoundError("Automation approval request not found.");
    }
    if (approval.status !== "PENDING") {
      throw new ValidationError(`Approval request is already resolved with status ${approval.status}.`);
    }
    if (approval.requiredRole && params.userRole !== approval.requiredRole && params.userRole !== "SUPER_ADMIN" && params.userRole !== "ADMIN") {
      throw new ValidationError(`Forbidden: Only users with role ${approval.requiredRole} can decide this approval.`);
    }
    const updated = await prisma.automationApproval.update({
      where: { id: approval.id },
      data: {
        status: params.decision,
        approverId: params.userId,
        decisionReason: params.reason || null,
        decidedAt: /* @__PURE__ */ new Date()
      }
    });
    await auditLogRepository.record({
      organizationId: params.organizationId,
      actorUserId: params.userId,
      actorType: "USER",
      action: params.decision === "APPROVED" ? "AUTOMATION_APPROVAL_GRANTED" : "AUTOMATION_APPROVAL_REJECTED",
      resourceType: "automation_approval",
      resourceId: approval.id,
      metadata: { workflowId: approval.workflowId, executionId: approval.executionId, decision: params.decision, reason: params.reason }
    });
    return { approval: updated, executionResumed: params.decision === "APPROVED" };
  }
  /**
   * List approvals with filters.
   */
  async listApprovals(params) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;
    const where = { organizationId: params.organizationId };
    if (params.status) where.status = params.status;
    if (params.workflowId) where.workflowId = params.workflowId;
    const [rows, total] = await Promise.all([
      prisma.automationApproval.findMany({
        where,
        skip,
        take: limit,
        orderBy: { requestedAt: "desc" },
        include: {
          approver: { select: { id: true, firstName: true, lastName: true, email: true } },
          workflow: { select: { id: true, name: true, category: true } }
        }
      }),
      prisma.automationApproval.count({ where })
    ]);
    return { rows, total, page, limit };
  }
};
var approvalEngine = ApprovalEngine.getInstance();

// server/services/automation/TaskManager.ts
import crypto6 from "node:crypto";
var TaskManager = class _TaskManager {
  static getInstance() {
    if (!_TaskManager.instance) {
      _TaskManager.instance = new _TaskManager();
    }
    return _TaskManager.instance;
  }
  /**
   * Create a new automated task.
   */
  async createTask(params) {
    const taskId = crypto6.randomUUID();
    const dueDate = params.dueDate ? new Date(params.dueDate) : null;
    const task = await prisma.automationTask.create({
      data: {
        id: taskId,
        organizationId: params.organizationId,
        title: params.title,
        description: params.description || null,
        assignedUserId: params.assignedUserId || null,
        assignedRole: params.assignedRole || null,
        priority: params.priority || "MEDIUM",
        status: "PENDING",
        dueDate,
        sourceWorkflowId: params.sourceWorkflowId || null,
        sourceExecutionId: params.sourceExecutionId || null,
        sourceEntityType: params.sourceEntityType || null,
        sourceEntityId: params.sourceEntityId || null,
        isAiGenerated: params.isAiGenerated ?? true,
        metadata: params.metadata || {}
      },
      include: {
        assignedUser: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
    return task;
  }
  /**
   * Update task status or assignment.
   */
  async updateTask(params) {
    const task = await prisma.automationTask.findFirst({
      where: { id: params.taskId, organizationId: params.organizationId }
    });
    if (!task) {
      throw new NotFoundError("Automation task not found.");
    }
    const updateData = {};
    if (params.status) {
      updateData.status = params.status;
      if (params.status === "COMPLETED") {
        updateData.completedAt = /* @__PURE__ */ new Date();
      }
    }
    if (params.assignedUserId !== void 0) {
      updateData.assignedUserId = params.assignedUserId;
    }
    if (params.priority) {
      updateData.priority = params.priority;
    }
    if (params.dueDate !== void 0) {
      updateData.dueDate = params.dueDate ? new Date(params.dueDate) : null;
    }
    const updated = await prisma.automationTask.update({
      where: { id: task.id },
      data: updateData,
      include: {
        assignedUser: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
    if (params.userId) {
      await auditLogRepository.record({
        organizationId: params.organizationId,
        actorUserId: params.userId,
        actorType: "USER",
        action: "AUTOMATION_TASK_UPDATED",
        resourceType: "automation_task",
        resourceId: task.id,
        metadata: { updateData }
      });
    }
    return updated;
  }
  /**
   * List tasks with filters.
   */
  async listTasks(params) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;
    const where = { organizationId: params.organizationId };
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.assignedUserId) where.assignedUserId = params.assignedUserId;
    if (params.sourceWorkflowId) where.sourceWorkflowId = params.sourceWorkflowId;
    const [rows, total] = await Promise.all([
      prisma.automationTask.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          assignedUser: {
            select: { id: true, firstName: true, lastName: true, email: true }
          },
          workflow: {
            select: { id: true, name: true, category: true }
          }
        }
      }),
      prisma.automationTask.count({ where })
    ]);
    return { rows, total, page, limit };
  }
};
var taskManager = TaskManager.getInstance();

// server/services/automation/SchedulerEngine.ts
import crypto7 from "node:crypto";
var SchedulerEngine = class _SchedulerEngine {
  constructor() {
    this.timer = null;
    this.isProcessing = false;
    this.triggerWorkflowCallback = null;
  }
  static getInstance() {
    if (!_SchedulerEngine.instance) {
      _SchedulerEngine.instance = new _SchedulerEngine();
    }
    return _SchedulerEngine.instance;
  }
  /**
   * Set callback to invoke when a scheduled workflow is triggered.
   */
  setWorkflowExecutor(executor) {
    this.triggerWorkflowCallback = executor;
  }
  /**
   * Start the scheduler tick interval.
   */
  start(intervalMs = 3e4) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ err }, "[SchedulerEngine] Error during scheduler tick");
      });
    }, intervalMs);
    this.timer.unref();
    logger.info({ intervalMs }, "[SchedulerEngine] Background scheduler started");
  }
  /**
   * Stop the background scheduler.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info("[SchedulerEngine] Background scheduler stopped");
    }
  }
  /**
   * Calculate next run timestamp from schedule configuration.
   */
  static calculateNextRun(schedule) {
    const now = /* @__PURE__ */ new Date();
    if (schedule.scheduleType === "ONE_TIME") {
      return schedule.lastRunAt ? null : now;
    }
    if (schedule.scheduleType === "RECURRING") {
      const intervalSec = schedule.intervalSeconds || 3600;
      const base = schedule.lastRunAt ? new Date(schedule.lastRunAt) : now;
      const next = new Date(base.getTime() + intervalSec * 1e3);
      if (next.getTime() <= now.getTime()) {
        return new Date(now.getTime() + intervalSec * 1e3);
      }
      return next;
    }
    if (schedule.scheduleType === "CRON") {
      const cron = (schedule.cronExpression || "0 0 * * *").trim();
      const parts = cron.split(/\s+/);
      const next = new Date(now.getTime() + 6e4);
      if (parts.length >= 5) {
        const [min, hour] = parts;
        if (min !== "*" && !isNaN(Number(min))) {
          next.setMinutes(Number(min), 0, 0);
        }
        if (hour !== "*" && !isNaN(Number(hour))) {
          next.setHours(Number(hour));
        }
        if (next.getTime() <= now.getTime()) {
          next.setDate(next.getDate() + 1);
        }
      }
      return next;
    }
    return null;
  }
  /**
   * Evaluates due schedules and executes them safely.
   */
  async tick() {
    if (this.isProcessing) return 0;
    this.isProcessing = true;
    try {
      const now = /* @__PURE__ */ new Date();
      const dueSchedules = await prisma.automationSchedule.findMany({
        where: {
          isActive: true,
          OR: [
            { nextRunAt: { lte: now } },
            { nextRunAt: null, lastRunAt: null }
          ]
        },
        take: 20
      });
      let triggeredCount = 0;
      for (const schedule of dueSchedules) {
        try {
          const correlationId = crypto7.randomUUID();
          const nextRun = _SchedulerEngine.calculateNextRun({
            scheduleType: schedule.scheduleType,
            intervalSeconds: schedule.intervalSeconds,
            cronExpression: schedule.cronExpression,
            lastRunAt: now
          });
          await prisma.automationSchedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt: nextRun,
              runCount: { increment: 1 },
              isActive: schedule.scheduleType === "ONE_TIME" ? false : schedule.isActive
            }
          });
          if (this.triggerWorkflowCallback) {
            await this.triggerWorkflowCallback({
              workflowId: schedule.workflowId,
              organizationId: schedule.organizationId,
              triggerType: "SCHEDULE",
              input: {
                scheduleId: schedule.id,
                scheduleName: schedule.name,
                timestamp: now.toISOString(),
                ...schedule.config || {}
              },
              correlationId
            });
            triggeredCount++;
          }
        } catch (execErr) {
          logger.error({ execErr, scheduleId: schedule.id }, "[SchedulerEngine] Error executing schedule");
        }
      }
      return triggeredCount;
    } finally {
      this.isProcessing = false;
    }
  }
  /**
   * Create a new schedule.
   */
  async createSchedule(params) {
    const workflow = await prisma.automationWorkflow.findFirst({
      where: { id: params.workflowId, organizationId: params.organizationId }
    });
    if (!workflow) {
      throw new NotFoundError("Workflow not found.");
    }
    const nextRunAt = _SchedulerEngine.calculateNextRun({
      scheduleType: params.scheduleType,
      intervalSeconds: params.intervalSeconds,
      cronExpression: params.cronExpression,
      lastRunAt: null
    });
    const schedule = await prisma.automationSchedule.create({
      data: {
        id: crypto7.randomUUID(),
        organizationId: params.organizationId,
        workflowId: params.workflowId,
        name: params.name,
        description: params.description || null,
        scheduleType: params.scheduleType,
        cronExpression: params.cronExpression || null,
        timezone: params.timezone || "UTC",
        intervalSeconds: params.intervalSeconds || null,
        isActive: true,
        nextRunAt,
        config: params.config || {}
      },
      include: {
        workflow: {
          select: { id: true, name: true, status: true }
        }
      }
    });
    return schedule;
  }
  /**
   * Toggle schedule active state.
   */
  async toggleSchedule(id, organizationId, isActive) {
    const schedule = await prisma.automationSchedule.findFirst({
      where: { id, organizationId }
    });
    if (!schedule) {
      throw new NotFoundError("Schedule not found.");
    }
    const newActive = isActive !== void 0 ? isActive : !schedule.isActive;
    const nextRunAt = newActive ? _SchedulerEngine.calculateNextRun({
      scheduleType: schedule.scheduleType,
      intervalSeconds: schedule.intervalSeconds,
      cronExpression: schedule.cronExpression,
      lastRunAt: schedule.lastRunAt
    }) : null;
    return prisma.automationSchedule.update({
      where: { id: schedule.id },
      data: { isActive: newActive, nextRunAt },
      include: {
        workflow: {
          select: { id: true, name: true, status: true }
        }
      }
    });
  }
  /**
   * Delete schedule.
   */
  async deleteSchedule(id, organizationId) {
    const schedule = await prisma.automationSchedule.findFirst({
      where: { id, organizationId }
    });
    if (!schedule) {
      throw new NotFoundError("Schedule not found.");
    }
    await prisma.automationSchedule.delete({ where: { id } });
    return { deleted: true, id };
  }
  /**
   * List schedules with pagination.
   */
  async listSchedules(params) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;
    const where = { organizationId: params.organizationId };
    if (params.workflowId) where.workflowId = params.workflowId;
    if (params.isActive !== void 0) where.isActive = params.isActive;
    const [rows, total] = await Promise.all([
      prisma.automationSchedule.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          workflow: {
            select: { id: true, name: true, status: true, category: true }
          }
        }
      }),
      prisma.automationSchedule.count({ where })
    ]);
    return { rows, total, page, limit };
  }
};
var schedulerEngine = SchedulerEngine.getInstance();

// server/services/automation/WorkflowEngine.ts
import crypto10 from "node:crypto";

// server/services/automation/NotificationEngine.ts
import crypto8 from "node:crypto";
var NotificationEngine = class _NotificationEngine {
  static getInstance() {
    if (!_NotificationEngine.instance) {
      _NotificationEngine.instance = new _NotificationEngine();
    }
    return _NotificationEngine.instance;
  }
  /**
   * Dispatch a notification to a specific user or role.
   */
  async dispatchNotification(params) {
    const channel = params.channel || "IN_APP";
    const level = params.level || "INFO";
    const notifId = crypto8.randomUUID();
    if (params.userId && (channel === "EMAIL" || channel === "SMS")) {
      try {
        const pref = await prisma.notificationPreference.findUnique({
          where: {
            userId_channel_notificationType: {
              userId: params.userId,
              channel,
              notificationType: "automation"
            }
          }
        });
        if (pref && !pref.enabled) {
          logger.info({ userId: params.userId, channel }, "[NotificationEngine] Delivery suppressed by user preference");
          return { id: notifId, delivered: false };
        }
      } catch {
      }
    }
    const record = await prisma.automationNotification.create({
      data: {
        id: notifId,
        organizationId: params.organizationId,
        userId: params.userId || null,
        recipientRole: params.recipientRole || null,
        channel,
        title: params.title,
        message: params.message,
        level,
        status: "DELIVERED",
        sourceWorkflowId: params.sourceWorkflowId || null,
        sourceExecutionId: params.sourceExecutionId || null,
        metadata: params.metadata || {}
      }
    });
    if (params.userId && channel === "IN_APP") {
      try {
        await prisma.notification.create({
          data: {
            id: crypto8.randomUUID(),
            organizationId: params.organizationId,
            userId: params.userId,
            title: params.title,
            message: params.message,
            type: level === "ERROR" ? "SYSTEM_ALERT" : "WORKFLOW_UPDATE",
            status: "UNREAD"
          }
        });
      } catch (err) {
        logger.warn({ err }, "[NotificationEngine] Core notification sync skipped");
      }
    }
    return { id: record.id, delivered: true };
  }
  /**
   * List notifications for an organization or user.
   */
  async listNotifications(params) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;
    const where = { organizationId: params.organizationId };
    if (params.userId) where.userId = params.userId;
    const [rows, total] = await Promise.all([
      prisma.automationNotification.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.automationNotification.count({ where })
    ]);
    return { rows, total, page, limit };
  }
  /**
   * Mark notification as read.
   */
  async markAsRead(id, organizationId) {
    await prisma.automationNotification.updateMany({
      where: { id, organizationId },
      data: { status: "READ", readAt: /* @__PURE__ */ new Date() }
    });
    return true;
  }
};
var notificationEngine = NotificationEngine.getInstance();

// server/ai/provider.ts
import { GoogleGenAI } from "@google/genai";
var GEMINI_MODEL = "gemini-3.7-flash";
var GeminiProvider = class {
  constructor() {
    this.code = "gemini";
    this.name = `Google Gemini (${GEMINI_MODEL})`;
    this.defaultModel = GEMINI_MODEL;
    this.client = null;
  }
  get available() {
    return config.aiProvider === "gemini" && config.geminiApiKey.length > 0;
  }
  getClient() {
    if (this.client) return this.client;
    if (!this.available) {
      throw new InfrastructureError("AI provider is not configured (GEMINI_API_KEY missing).");
    }
    this.client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    return this.client;
  }
  async generateText(prompt, options) {
    const client3 = this.getClient();
    const model = options?.model ?? this.defaultModel;
    try {
      const response = await client3.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: options?.systemInstruction,
          temperature: options?.temperature ?? 0.3,
          maxOutputTokens: options?.maxOutputTokens ?? 2048,
          responseMimeType: options?.responseMimeType
        }
      });
      const text = response.text;
      if (!text) {
        throw new InfrastructureError("Empty response received from the AI provider.");
      }
      const usageMetadata = response.usageMetadata;
      const usage = usageMetadata ? {
        inputTokens: usageMetadata.promptTokenCount,
        outputTokens: usageMetadata.candidatesTokenCount,
        totalTokens: usageMetadata.totalTokenCount
      } : void 0;
      return { text, model, usage };
    } catch (err) {
      logger.error({ err, event: "ai_provider_error" }, "AI provider call failed");
      throw err instanceof InfrastructureError ? err : new InfrastructureError("AI provider call failed.");
    }
  }
};
var UnavailableProvider = class {
  constructor() {
    this.code = "none";
    this.name = "none";
    this.available = false;
    this.defaultModel = "none";
  }
  async generateText() {
    throw new InfrastructureError("AI provider is not configured.");
  }
};
var defaultAiProvider = config.aiProvider === "gemini" ? new GeminiProvider() : new UnavailableProvider();

// server/services/knowledge/KnowledgeService.ts
import crypto9 from "crypto";

// server/services/knowledge/ExtractionPipeline.ts
var PlainTextExtractor = class {
  canHandle(mimeType, filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    return mimeType.startsWith("text/plain") || mimeType === "text/markdown" || mimeType === "application/json" || mimeType === "text/yaml" || ext === "txt" || ext === "md" || ext === "markdown" || ext === "json";
  }
  async extract(buffer, filename) {
    const text = buffer.toString("utf8");
    const words = text.trim().split(/\s+/).filter(Boolean);
    return {
      text,
      mimeType: "text/plain",
      metadata: {
        title: filename || "Text Document",
        characterCount: text.length,
        wordCount: words.length,
        extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
        format: "text"
      }
    };
  }
};
var HtmlExtractor = class {
  canHandle(mimeType, filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    return mimeType === "text/html" || mimeType === "application/xhtml+xml" || ext === "html" || ext === "htm";
  }
  async extract(buffer, filename) {
    const raw = buffer.toString("utf8");
    const cleaned = raw.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ").replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/h[1-6]>/gi, "\n\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n\s+\n/g, "\n\n").trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    return {
      text: cleaned,
      mimeType: "text/html",
      metadata: {
        title: filename || "HTML Document",
        characterCount: cleaned.length,
        wordCount: words.length,
        extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
        format: "html"
      }
    };
  }
};
var CsvSpreadsheetExtractor = class {
  canHandle(mimeType, filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    return mimeType === "text/csv" || mimeType === "application/vnd.ms-excel" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || ext === "csv" || ext === "tsv" || ext === "xlsx" || ext === "xls";
  }
  async extract(buffer, filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    if (ext === "csv" || ext === "tsv" || buffer.subarray(0, 100).toString("utf8").includes(",")) {
      const text = buffer.toString("utf8");
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      const rows = lines.map((l) => l.split(/,|\t/).map((c) => c.trim().replace(/^["']|["']$/g, "")));
      const formatted = rows.map((row, idx) => idx === 0 ? `[COLUMNS]: ${row.join(" | ")}` : `Row ${idx}: ${row.join(" | ")}`).join("\n");
      return {
        text: formatted,
        mimeType: "text/csv",
        metadata: {
          title: filename || "Spreadsheet Document",
          characterCount: formatted.length,
          wordCount: formatted.split(/\s+/).filter(Boolean).length,
          pageCount: Math.ceil(lines.length / 50),
          extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
          format: "tabular"
        }
      };
    }
    const binaryStr = buffer.toString("latin1");
    const extractedCells = [];
    const cellRegex = /<t[^>]*>(.*?)<\/t>/g;
    let match;
    while ((match = cellRegex.exec(binaryStr)) !== null) {
      if (match[1] && match[1].trim()) {
        extractedCells.push(match[1].trim());
      }
    }
    const content = extractedCells.length > 0 ? extractedCells.join("\n") : buffer.toString("utf8").replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, " ").trim();
    return {
      text: content,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      metadata: {
        title: filename || "Excel Spreadsheet",
        characterCount: content.length,
        wordCount: content.split(/\s+/).filter(Boolean).length,
        extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
        format: "xlsx"
      }
    };
  }
};
var PdfExtractor = class {
  canHandle(mimeType, filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    return mimeType === "application/pdf" || ext === "pdf";
  }
  async extract(buffer, filename) {
    const pdfData = buffer.toString("latin1");
    const textChunks = [];
    const blockRegex = /BT[\s\S]*?ET/g;
    const matches = pdfData.match(blockRegex) || [];
    for (const block of matches) {
      const strMatches = block.match(/\((.*?)\)\s*(?:Tj|'|")/g) || [];
      for (const sm of strMatches) {
        const textMatch = sm.match(/\((.*?)\)/);
        if (textMatch && textMatch[1]) {
          textChunks.push(textMatch[1]);
        }
      }
    }
    let extracted = textChunks.join(" ").replace(/\\([()\\])/g, "$1").trim();
    if (!extracted || extracted.length < 10) {
      const asciiStrings = pdfData.match(/[\x20-\x7E]{4,}/g) || [];
      const cleanAscii = asciiStrings.filter((s) => !s.startsWith("/") && !s.includes("obj") && !s.includes("endobj"));
      extracted = cleanAscii.join(" ").slice(0, 5e4);
    }
    if (!extracted || extracted.length === 0) {
      extracted = `[Scanned or Image-based PDF Document: ${filename || "unnamed.pdf"}]`;
    }
    const pageTokens = (pdfData.match(/\/Type\s*\/Page\b/g) || []).length;
    const pageCount = Math.max(1, pageTokens);
    return {
      text: extracted,
      mimeType: "application/pdf",
      metadata: {
        title: filename || "PDF Document",
        pageCount,
        characterCount: extracted.length,
        wordCount: extracted.split(/\s+/).filter(Boolean).length,
        extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
        format: "pdf"
      }
    };
  }
};
var DocxExtractor = class {
  canHandle(mimeType, filename) {
    const ext = filename?.split(".").pop()?.toLowerCase();
    return mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType === "application/msword" || ext === "docx" || ext === "doc";
  }
  async extract(buffer, filename) {
    const raw = buffer.toString("utf8");
    const textPieces = [];
    const textTagRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let m;
    while ((m = textTagRegex.exec(raw)) !== null) {
      if (m[1]) textPieces.push(m[1]);
    }
    let text = textPieces.join(" ").trim();
    if (!text || text.length < 5) {
      text = raw.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, " ").trim().slice(0, 1e5);
    }
    return {
      text,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      metadata: {
        title: filename || "Word Document",
        characterCount: text.length,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        extractedAt: (/* @__PURE__ */ new Date()).toISOString(),
        format: "docx"
      }
    };
  }
};
var ExtractionPipeline = class {
  static {
    this.extractors = [
      new PlainTextExtractor(),
      new HtmlExtractor(),
      new CsvSpreadsheetExtractor(),
      new PdfExtractor(),
      new DocxExtractor()
    ];
  }
  static registerExtractor(extractor) {
    this.extractors.unshift(extractor);
  }
  static async extract(buffer, mimeType, filename) {
    for (const extractor of this.extractors) {
      if (extractor.canHandle(mimeType, filename)) {
        try {
          return await extractor.extract(buffer, filename);
        } catch (err) {
          logger.warn({ err, mimeType, filename }, "[ExtractionPipeline] Extractor failed, trying next");
        }
      }
    }
    try {
      const sample = buffer.subarray(0, 512).toString("utf8");
      const isAscii = /^[\x09\x0A\x0D\x20-\x7E]*$/.test(sample);
      if (isAscii) {
        return new PlainTextExtractor().extract(buffer, filename);
      }
    } catch {
    }
    throw new ValidationError(`Unsupported document format or mime type: "${mimeType}".`);
  }
};

// server/services/knowledge/ChunkingEngine.ts
var ChunkingEngine = class {
  /**
   * Chunks a normalized document string into structured chunks with metadata.
   */
  static chunk(text, options = {}) {
    const maxChunkSize = options.maxChunkSize || 1e3;
    const overlapSize = options.overlapSize || 150;
    if (!text || text.trim().length === 0) {
      return [];
    }
    const cleanText = text.replace(/\r\n/g, "\n");
    const rawSections = cleanText.split(/\n{2,}/);
    const chunks = [];
    let currentBuffer = "";
    let currentHeading = void 0;
    let currentPage = 1;
    let chunkIndex = 0;
    for (const section of rawSections) {
      const trimmed = section.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("#") || /^[A-Z0-9\s-]{3,30}:?$/.test(trimmed.split("\n")[0] || "")) {
        currentHeading = trimmed.split("\n")[0]?.replace(/^#+\s*/, "").slice(0, 100);
      }
      const pageMatch = trimmed.match(/\[PAGE\s*(\d+)\]|--- Page (\d+) ---/i);
      if (pageMatch) {
        currentPage = parseInt(pageMatch[1] || pageMatch[2] || "1", 10);
      }
      if (currentBuffer.length + trimmed.length + 1 > maxChunkSize && currentBuffer.length > 0) {
        const tokenEstimate = Math.max(1, Math.ceil(currentBuffer.length / 4));
        chunks.push({
          chunkIndex,
          content: currentBuffer.trim(),
          tokenEstimate,
          charCount: currentBuffer.length,
          pageNumber: currentPage,
          sectionHeading: currentHeading,
          metadata: {
            estimatedTokens: tokenEstimate,
            chunkSeq: chunkIndex
          }
        });
        chunkIndex++;
        const overlap = currentBuffer.slice(-overlapSize).trim();
        currentBuffer = overlap ? `${overlap}

${trimmed}` : trimmed;
      } else {
        currentBuffer = currentBuffer ? `${currentBuffer}

${trimmed}` : trimmed;
      }
      while (currentBuffer.length > maxChunkSize * 1.5) {
        const splitPoint = currentBuffer.lastIndexOf(". ", maxChunkSize);
        const cut = splitPoint > 200 ? splitPoint + 1 : maxChunkSize;
        const part = currentBuffer.slice(0, cut).trim();
        const remainder = currentBuffer.slice(cut).trim();
        const tokenEstimate = Math.max(1, Math.ceil(part.length / 4));
        chunks.push({
          chunkIndex,
          content: part,
          tokenEstimate,
          charCount: part.length,
          pageNumber: currentPage,
          sectionHeading: currentHeading
        });
        chunkIndex++;
        currentBuffer = remainder;
      }
    }
    if (currentBuffer.trim().length > 0) {
      const tokenEstimate = Math.max(1, Math.ceil(currentBuffer.length / 4));
      chunks.push({
        chunkIndex,
        content: currentBuffer.trim(),
        tokenEstimate,
        charCount: currentBuffer.length,
        pageNumber: currentPage,
        sectionHeading: currentHeading
      });
    }
    return chunks;
  }
};

// server/ai/adapters/geminiAdapter.ts
import { GoogleGenAI as GoogleGenAI2 } from "@google/genai";
var GeminiAdapter = class {
  constructor(apiKey) {
    this.providerType = "GEMINI";
    this.client = null;
    this.apiKey = apiKey && apiKey.length > 0 ? apiKey : config.geminiApiKey;
  }
  getClient() {
    if (this.client) return this.client;
    if (!this.apiKey || this.apiKey.length === 0) {
      throw new InfrastructureError("Gemini API key is not configured in server environment.");
    }
    this.client = new GoogleGenAI2({ apiKey: this.apiKey });
    return this.client;
  }
  async generateText(params) {
    const start = Date.now();
    const client3 = this.getClient();
    const model = params.modelName || "gemini-2.5-flash";
    try {
      const response = await client3.models.generateContent({
        model,
        contents: params.prompt,
        config: {
          systemInstruction: params.systemInstruction,
          temperature: params.temperature ?? 0.3,
          maxOutputTokens: params.maxTokens ?? 2048,
          responseMimeType: params.responseMimeType,
          stopSequences: params.stopSequences
        }
      });
      const durationMs = Date.now() - start;
      const text = response.text || "";
      const usage = response.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? Math.max(1, Math.ceil(params.prompt.length / 4));
      const outputTokens = usage?.candidatesTokenCount ?? Math.max(1, Math.ceil(text.length / 4));
      const totalTokens = usage?.totalTokenCount ?? inputTokens + outputTokens;
      return {
        text,
        inputTokens,
        outputTokens,
        totalTokens,
        durationMs,
        finishReason: "STOP"
      };
    } catch (err) {
      const durationMs = Date.now() - start;
      logger.error({ err, model, durationMs, event: "gemini_adapter_error" }, "Gemini invocation failed");
      const message = err instanceof Error ? err.message : "Gemini provider call failed.";
      throw new InfrastructureError(`Gemini error: ${message}`);
    }
  }
  async generateStructured(params) {
    const res = await this.generateText({
      ...params,
      responseMimeType: "application/json"
    });
    try {
      const clean = res.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      return JSON.parse(clean);
    } catch {
      throw new InfrastructureError(`Failed to parse structured JSON output: ${res.text.slice(0, 100)}...`);
    }
  }
  async generateEmbedding(params) {
    const client3 = this.getClient();
    const model = params.modelName || "text-embedding-004";
    try {
      const response = await client3.models.embedContent({
        model,
        contents: params.text
      });
      const values = response.embeddings?.[0]?.values;
      if (Array.isArray(values) && values.length > 0) {
        return values;
      }
      throw new Error("No embedding values returned from Gemini model.");
    } catch (err) {
      logger.error({ err, model }, "Gemini embedding invocation failed");
      const message = err instanceof Error ? err.message : "Gemini embedContent failed.";
      throw new InfrastructureError(`Gemini embedding error: ${message}`);
    }
  }
};

// server/ai/adapters/mockAdapter.ts
var MockAdapter = class {
  constructor() {
    this.providerType = "MOCK";
  }
  async generateText(params) {
    const start = Date.now();
    const prompt = params.prompt.trim();
    let responseText = "";
    if (params.responseMimeType === "application/json" || prompt.toLowerCase().includes("json")) {
      responseText = JSON.stringify({
        status: "success",
        synthesis: "Simulated structured intelligence output generated by Artify Mock Adapter.",
        entities: [{ name: "Target Entity", type: "ENTERPRISE", score: 0.94 }],
        recommendation: "Proceed with executive relationship advancement.",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }, null, 2);
    } else if (prompt.toLowerCase().includes("summariz") || prompt.toLowerCase().includes("brief")) {
      responseText = `**Executive Brief**

- **Overview:** Synthesized analysis for prompt: "${prompt.slice(0, 80)}..."
- **Key Finding:** Strong commercial alignment observed across account parameters.
- **Risk Factor:** Low risk with operational governance active.
- **Recommended Next Step:** Schedule milestone audit and confirm contract schedule.`;
    } else if (prompt.toLowerCase().includes("classif") || prompt.toLowerCase().includes("categor")) {
      responseText = `**Classification Result**
- Primary Category: HIGH_PRIORITY
- Confidence Score: 0.92
- Strategic Alignment: Enterprise Tier Growth`;
    } else {
      responseText = `Artify Intelligence Response:

Analysis completed successfully for model ${params.modelName}.

Parameters evaluated: temperature=${params.temperature ?? 0.3}, maxTokens=${params.maxTokens ?? 2048}.
System instructions observed: ${params.systemInstruction ? "Active" : "None"}.

Evaluated input: ${prompt}

Output: High quality deterministic synthesis conforming to Artify enterprise governance policies.`;
    }
    const durationMs = Math.max(15, Date.now() - start);
    const inputTokens = Math.max(1, Math.ceil(prompt.length / 4));
    const outputTokens = Math.max(1, Math.ceil(responseText.length / 4));
    return {
      text: responseText,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      durationMs,
      finishReason: "STOP"
    };
  }
  async generateStructured(params) {
    const res = await this.generateText({
      ...params,
      responseMimeType: "application/json"
    });
    return JSON.parse(res.text);
  }
  async generateEmbedding(params) {
    const dim = params.dimension || 768;
    const text = params.text.toLowerCase();
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const idx = (code * 31 + i * 17) % dim;
      vec[idx] = (vec[idx] + code / 255) % 1;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map((v) => Number((v / norm).toFixed(6)));
  }
};

// server/ai/adapters/adapterFactory.ts
var AdapterFactory = class {
  static {
    this.mockInstance = new MockAdapter();
  }
  static {
    this.geminiInstance = null;
  }
  static getAdapter(providerType, apiKey) {
    const normalized = (providerType || "GEMINI").toUpperCase();
    if (normalized === "MOCK") {
      return this.mockInstance;
    }
    if (normalized === "GEMINI") {
      const key = apiKey || config.geminiApiKey;
      if (!key || key.length === 0) {
        return this.mockInstance;
      }
      if (!this.geminiInstance || apiKey) {
        const adapter = new GeminiAdapter(key);
        if (!apiKey) this.geminiInstance = adapter;
        return adapter;
      }
      return this.geminiInstance;
    }
    return this.mockInstance;
  }
};

// server/ai/adapters/index.ts
function getAdapter(providerType = "GEMINI", apiKey) {
  return AdapterFactory.getAdapter(providerType, apiKey);
}

// server/services/knowledge/EmbeddingService.ts
var EmbeddingService = class {
  /**
   * Generates embedding vector for a piece of text using the active AI adapter.
   */
  static async generateEmbedding(text, modelName = "text-embedding-004") {
    const adapter = getAdapter();
    if (adapter.generateEmbedding) {
      try {
        return await adapter.generateEmbedding({ text, modelName, dimension: 768 });
      } catch (err) {
        logger.warn({ err }, "[EmbeddingService] Adapter embedding failed, calculating deterministic vector");
      }
    }
    const dim = 768;
    const lower = text.toLowerCase();
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < lower.length; i++) {
      const code = lower.charCodeAt(i);
      const idx = (code * 31 + i * 17) % dim;
      vec[idx] = (vec[idx] + code / 255) % 1;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vec.map((v) => Number((v / norm).toFixed(6)));
  }
  /**
   * Computes cosine similarity between two unit vectors.
   */
  static cosineSimilarity(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0) return 0;
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : Math.max(0, Math.min(1, dot / denom));
  }
  /**
   * Stores embedding for a chunk in the database.
   */
  static async storeEmbedding(chunkId, vector, modelName = "text-embedding-004") {
    const adapter = getAdapter();
    await prisma.knowledgeEmbedding.create({
      data: {
        chunkId,
        providerType: adapter.providerType,
        modelName,
        dimension: vector.length,
        vector
      }
    });
  }
};

// server/services/knowledge/HybridSearchEngine.ts
var HybridSearchEngine = class {
  /**
   * Performs permission-filtered semantic, keyword, or hybrid search.
   */
  static async search(request, context) {
    const startTime = Date.now();
    const mode = request.mode || "HYBRID";
    const limit = Math.min(request.limit || 10, 50);
    const minScore = request.minScore ?? 0.15;
    const documents = await prisma.knowledgeDocument.findMany({
      where: {
        organizationId: context.organizationId,
        status: "INDEXED",
        ...request.filter?.collectionIds?.length ? { collectionId: { in: request.filter.collectionIds } } : {},
        ...request.filter?.sourceIds?.length ? { sourceId: { in: request.filter.sourceIds } } : {},
        ...request.filter?.documentIds?.length ? { id: { in: request.filter.documentIds } } : {}
      },
      include: {
        collection: true,
        source: true
      }
    });
    if (documents.length === 0) {
      return [];
    }
    const authorizedDocs = documents.filter((doc) => {
      if (doc.requiredRole && context.roleName && context.roleName !== "ADMIN") {
        if (doc.requiredRole !== context.roleName) {
          return false;
        }
      }
      if (doc.collection) {
        const col = doc.collection;
        if (col.accessPolicy === "RESTRICTED" || col.accessPolicy === "ROLE_BASED") {
          const allowedRoles = Array.isArray(col.allowedRoles) ? col.allowedRoles : [];
          if (allowedRoles.length > 0 && context.roleName && context.roleName !== "ADMIN") {
            if (!allowedRoles.includes(context.roleName)) {
              return false;
            }
          }
        } else if (col.accessPolicy === "OWNER_ONLY") {
          if (context.userId && col.createdById !== context.userId && context.roleName !== "ADMIN") {
            return false;
          }
        }
      }
      return true;
    });
    if (authorizedDocs.length === 0) {
      return [];
    }
    const docMap = new Map(authorizedDocs.map((d) => [d.id, d]));
    const authorizedDocIds = Array.from(docMap.keys());
    const chunks = await prisma.knowledgeChunk.findMany({
      where: {
        organizationId: context.organizationId,
        documentId: { in: authorizedDocIds }
      },
      include: {
        embeddings: true
      },
      take: 200
      // Search over candidate pool
    });
    if (chunks.length === 0) {
      return [];
    }
    let queryVector = [];
    if (mode === "SEMANTIC" || mode === "HYBRID") {
      queryVector = await EmbeddingService.generateEmbedding(request.query);
    }
    const queryTerms = request.query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    const scoredItems = [];
    for (const chunk of chunks) {
      const doc = docMap.get(chunk.documentId);
      if (!doc) continue;
      let keywordScore = 0;
      const lowerContent = chunk.content.toLowerCase();
      let matchedTerms = 0;
      for (const term of queryTerms) {
        if (lowerContent.includes(term)) {
          matchedTerms++;
          const occurrences = lowerContent.split(term).length - 1;
          keywordScore += Math.min(occurrences * 0.2, 0.6);
        }
      }
      if (queryTerms.length > 0) {
        keywordScore += matchedTerms / queryTerms.length * 0.4;
      }
      keywordScore = Math.min(1, keywordScore);
      let similarityScore = 0;
      if ((mode === "SEMANTIC" || mode === "HYBRID") && chunk.embeddings.length > 0) {
        const storedVector = chunk.embeddings[0]?.vector;
        if (Array.isArray(storedVector) && storedVector.length > 0) {
          similarityScore = EmbeddingService.cosineSimilarity(queryVector, storedVector);
        }
      }
      let finalScore = 0;
      if (mode === "SEMANTIC") {
        finalScore = similarityScore;
      } else if (mode === "KEYWORD") {
        finalScore = keywordScore;
      } else {
        finalScore = similarityScore * 0.7 + keywordScore * 0.3;
      }
      if (finalScore >= minScore) {
        scoredItems.push({
          chunkId: chunk.id,
          documentId: doc.id,
          documentTitle: doc.title,
          collectionId: doc.collectionId || void 0,
          collectionName: doc.collection?.name,
          sourceId: doc.sourceId || void 0,
          sourceName: doc.source?.name,
          versionNumber: chunk.versionNumber,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          pageNumber: chunk.pageNumber || void 0,
          sectionHeading: chunk.sectionHeading || void 0,
          similarityScore: Number(similarityScore.toFixed(4)),
          keywordScore: Number(keywordScore.toFixed(4)),
          score: Number(finalScore.toFixed(4)),
          securityScope: doc.securityScope,
          requiredRole: doc.requiredRole || void 0,
          metadata: chunk.metadata || {}
        });
      }
    }
    scoredItems.sort((a, b) => b.score - a.score);
    const results = scoredItems.slice(0, limit);
    try {
      await prisma.knowledgeSearchLog.create({
        data: {
          organizationId: context.organizationId,
          userId: context.userId,
          query: request.query,
          searchType: mode,
          filterMetadata: request.filter || {},
          resultsCount: results.length,
          durationMs: Date.now() - startTime
        }
      });
    } catch {
    }
    return results;
  }
};

// server/services/knowledge/ContextBuilder.ts
var ContextBuilder = class {
  /**
   * Transforms search results into a safe, cited context block for AI prompt augmentation.
   */
  static buildContext(chunks, options = {}) {
    const maxTokens = options.maxTokens || 2500;
    const threshold = options.minScoreThreshold ?? 0.2;
    const filtered = chunks.filter((c) => c.score >= threshold);
    const citations = [];
    const contextBlocks = [];
    let currentTokenEstimate = 0;
    const sourcesSeen = /* @__PURE__ */ new Map();
    let conflictsDetected = false;
    const conflictNotes = [];
    for (let i = 0; i < filtered.length; i++) {
      const chunk = filtered[i];
      if (!chunk) continue;
      const chunkTokens = Math.max(1, Math.ceil(chunk.content.length / 4));
      if (currentTokenEstimate + chunkTokens > maxTokens) {
        break;
      }
      if (options.detectConflicts !== false) {
        for (const [title, prevContent] of sourcesSeen.entries()) {
          if (title !== chunk.documentTitle) {
            if (chunk.content.toLowerCase().includes("not allowed") && prevContent.toLowerCase().includes("allowed") || chunk.content.toLowerCase().includes("deprecated") && prevContent.toLowerCase().includes("supported")) {
              conflictsDetected = true;
              conflictNotes.push(`Potential conflict between "${title}" and "${chunk.documentTitle}"`);
            }
          }
        }
        sourcesSeen.set(chunk.documentTitle, chunk.content);
      }
      citations.push({
        sourceName: chunk.sourceName || "Knowledge Base",
        documentTitle: chunk.documentTitle,
        documentId: chunk.documentId,
        version: chunk.versionNumber,
        pageNumber: chunk.pageNumber,
        sectionHeading: chunk.sectionHeading,
        chunkIndex: chunk.chunkIndex,
        similarityScore: chunk.score
      });
      const refTag = `[REF-${i + 1}]`;
      const location = chunk.pageNumber ? `(Page ${chunk.pageNumber})` : chunk.sectionHeading ? `(${chunk.sectionHeading})` : "";
      contextBlocks.push(
        `${refTag} [Source: ${chunk.documentTitle} ${location} | Score: ${(chunk.score * 100).toFixed(0)}%]
${chunk.content}`
      );
      currentTokenEstimate += chunkTokens;
    }
    const formattedContext = contextBlocks.length > 0 ? `--- ENTERPRISE KNOWLEDGE CONTEXT ---
The following verified organizational documents were retrieved with high relevance:

${contextBlocks.join("\n\n")}
--- END ENTERPRISE KNOWLEDGE CONTEXT ---` : "";
    return {
      formattedContext,
      citations,
      totalChunksUsed: contextBlocks.length,
      totalTokensEstimate: currentTokenEstimate,
      conflictingSourcesDetected: conflictsDetected,
      conflictsSummary: conflictNotes.length > 0 ? conflictNotes.join("; ") : void 0,
      retrievedChunks: filtered.slice(0, contextBlocks.length)
    };
  }
};

// server/services/knowledge/KnowledgeService.ts
var KnowledgeService = class {
  // ---------------------------------------------------------------------------
  // Collection Management
  // ---------------------------------------------------------------------------
  static async createCollection(params) {
    if (!params.name || params.name.trim().length === 0) {
      throw new ValidationError("Collection name is required.");
    }
    return await prisma.knowledgeCollection.create({
      data: {
        organizationId: params.organizationId,
        createdById: params.userId,
        name: params.name.trim(),
        description: params.description,
        accessPolicy: params.accessPolicy || "RESTRICTED",
        allowedRoles: params.allowedRoles || [],
        metadata: params.metadata || {},
        status: "ACTIVE"
      }
    });
  }
  static async listCollections(organizationId) {
    return await prisma.knowledgeCollection.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: {
        _count: {
          select: { documents: true, sources: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });
  }
  static async getCollection(id, organizationId) {
    const col = await prisma.knowledgeCollection.findFirst({
      where: { id, organizationId },
      include: {
        sources: true,
        documents: true
      }
    });
    if (!col) {
      throw new NotFoundError(`Knowledge Collection "${id}" not found.`);
    }
    return col;
  }
  // ---------------------------------------------------------------------------
  // Source Connectors & Registration
  // ---------------------------------------------------------------------------
  static async registerSource(params) {
    return await prisma.knowledgeSource.create({
      data: {
        organizationId: params.organizationId,
        collectionId: params.collectionId,
        name: params.name,
        sourceType: params.sourceType,
        entityType: params.entityType,
        entityId: params.entityId,
        config: params.config || {},
        status: "ACTIVE"
      }
    });
  }
  // ---------------------------------------------------------------------------
  // Document Ingestion Pipeline
  // ---------------------------------------------------------------------------
  static async ingestDocument(params) {
    if (!params.title || params.title.trim().length === 0) {
      throw new ValidationError("Document title is required.");
    }
    if (!params.buffer || params.buffer.length === 0) {
      throw new ValidationError("Document buffer cannot be empty.");
    }
    const checksum = crypto9.createHash("sha256").update(params.buffer).digest("hex");
    const existing = await prisma.knowledgeDocument.findFirst({
      where: {
        organizationId: params.organizationId,
        title: params.title,
        collectionId: params.collectionId
      },
      include: {
        versions: true
      }
    });
    let documentId;
    let versionNumber = 1;
    if (existing) {
      documentId = existing.id;
      versionNumber = existing.activeVersion + 1;
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          activeVersion: versionNumber,
          status: "PROCESSING",
          indexingStatus: "PROCESSING",
          sizeBytes: params.buffer.length,
          checksum,
          updatedAt: /* @__PURE__ */ new Date()
        }
      });
    } else {
      const doc = await prisma.knowledgeDocument.create({
        data: {
          organizationId: params.organizationId,
          createdById: params.userId,
          collectionId: params.collectionId,
          sourceId: params.sourceId,
          title: params.title,
          description: params.description,
          mimeType: params.mimeType,
          sizeBytes: params.buffer.length,
          checksum,
          activeVersion: 1,
          status: "PROCESSING",
          indexingStatus: "PROCESSING",
          securityScope: params.securityScope || "DEFAULT",
          requiredRole: params.requiredRole,
          metadata: params.metadata || {}
        }
      });
      documentId = doc.id;
      versionNumber = 1;
    }
    const job = await prisma.knowledgeIngestionJob.create({
      data: {
        organizationId: params.organizationId,
        documentId,
        versionNumber,
        stage: "EXTRACTING",
        status: "PROCESSING",
        startedAt: /* @__PURE__ */ new Date()
      }
    });
    try {
      const extracted = await ExtractionPipeline.extract(params.buffer, params.mimeType, params.filename);
      const chunks = ChunkingEngine.chunk(extracted.text);
      const versionRecord = await prisma.knowledgeDocumentVersion.create({
        data: {
          documentId,
          version: versionNumber,
          mimeType: params.mimeType,
          sizeBytes: params.buffer.length,
          checksum,
          extractedText: extracted.text,
          totalChunks: chunks.length,
          createdById: params.userId,
          metadata: extracted.metadata || {}
        }
      });
      await prisma.knowledgeIngestionJob.update({
        where: { id: job.id },
        data: {
          stage: "CHUNKING",
          totalChunks: chunks.length,
          progress: 50
        }
      });
      for (const ch of chunks) {
        const createdChunk = await prisma.knowledgeChunk.create({
          data: {
            organizationId: params.organizationId,
            documentId,
            versionId: versionRecord.id,
            versionNumber,
            chunkIndex: ch.chunkIndex,
            content: ch.content,
            tokenEstimate: ch.tokenEstimate,
            charCount: ch.charCount,
            pageNumber: ch.pageNumber,
            sectionHeading: ch.sectionHeading,
            metadata: ch.metadata || {}
          }
        });
        const vector = await EmbeddingService.generateEmbedding(ch.content);
        await EmbeddingService.storeEmbedding(createdChunk.id, vector);
      }
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          status: "INDEXED",
          indexingStatus: "INDEXED"
        }
      });
      await prisma.knowledgeIngestionJob.update({
        where: { id: job.id },
        data: {
          stage: "COMPLETED",
          status: "INDEXED",
          progress: 100,
          completedAt: /* @__PURE__ */ new Date()
        }
      });
      logger.info({ documentId, versionNumber, chunks: chunks.length }, "[KnowledgeService] Ingestion completed");
      return {
        documentId,
        versionNumber,
        jobId: job.id,
        totalChunks: chunks.length,
        status: "INDEXED"
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Document ingestion failed";
      logger.error({ err, documentId }, "[KnowledgeService] Ingestion failed");
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: "FAILED", indexingStatus: "FAILED" }
      });
      await prisma.knowledgeIngestionJob.update({
        where: { id: job.id },
        data: {
          stage: "FAILED",
          status: "FAILED",
          errorMessage: errorMsg,
          completedAt: /* @__PURE__ */ new Date()
        }
      });
      throw err;
    }
  }
  // ---------------------------------------------------------------------------
  // Reindexing & Lifecycle
  // ---------------------------------------------------------------------------
  static async reindexDocument(documentId, organizationId) {
    const doc = await prisma.knowledgeDocument.findFirst({
      where: { id: documentId, organizationId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } }
    });
    if (!doc || doc.versions.length === 0) {
      throw new NotFoundError(`Document "${documentId}" or its active version not found.`);
    }
    const latestVersion = doc.versions[0];
    if (!latestVersion || !latestVersion.extractedText) {
      throw new ValidationError("Cannot reindex document without extracted text.");
    }
    await prisma.knowledgeChunk.deleteMany({
      where: { documentId, versionNumber: latestVersion.version }
    });
    const chunks = ChunkingEngine.chunk(latestVersion.extractedText);
    for (const ch of chunks) {
      const createdChunk = await prisma.knowledgeChunk.create({
        data: {
          organizationId,
          documentId,
          versionId: latestVersion.id,
          versionNumber: latestVersion.version,
          chunkIndex: ch.chunkIndex,
          content: ch.content,
          tokenEstimate: ch.tokenEstimate,
          charCount: ch.charCount,
          pageNumber: ch.pageNumber,
          sectionHeading: ch.sectionHeading,
          metadata: ch.metadata || {}
        }
      });
      const vector = await EmbeddingService.generateEmbedding(ch.content);
      await EmbeddingService.storeEmbedding(createdChunk.id, vector);
    }
    await prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: "INDEXED", indexingStatus: "INDEXED", updatedAt: /* @__PURE__ */ new Date() }
    });
    return { documentId, chunksReindexed: chunks.length };
  }
  // ---------------------------------------------------------------------------
  // Retrieval & Grounding
  // ---------------------------------------------------------------------------
  static async search(request, context) {
    return await HybridSearchEngine.search(request, context);
  }
  static async getGroundedContext(query, context, options) {
    const results = await HybridSearchEngine.search(
      {
        query,
        mode: "HYBRID",
        minScore: options?.minScore ?? 0.15,
        limit: 10,
        filter: options?.filter
      },
      context
    );
    return ContextBuilder.buildContext(results, {
      maxTokens: options?.maxTokens ?? 2500,
      minScoreThreshold: options?.minScore ?? 0.15,
      detectConflicts: true
    });
  }
};

// server/services/automation/types.ts
import { z as z30 } from "zod";
var StructuredAiDecisionSchema = z30.object({
  decision: z30.string(),
  reason: z30.string(),
  confidence: z30.number().min(0).max(1),
  recommended_action: z30.string().optional(),
  metadata: z30.record(z30.unknown()).optional()
});
var DEFAULT_WORKFLOW_LIMITS = {
  maxSteps: 50,
  maxDurationMs: 3e5,
  // 5 minutes
  maxAiCalls: 10,
  maxToolCalls: 15,
  maxLoopIterations: 10
};
var DEFAULT_RETRY_POLICY = {
  maxRetries: 2,
  backoffMs: 1e3,
  exponential: true
};

// server/services/automation/WorkflowEngine.ts
var WorkflowEngine = class _WorkflowEngine {
  constructor() {
    this.queueInterval = null;
    this.isProcessingQueue = false;
  }
  static getInstance() {
    if (!_WorkflowEngine.instance) {
      _WorkflowEngine.instance = new _WorkflowEngine();
    }
    return _WorkflowEngine.instance;
  }
  /** Starts background worker that processes QUEUED executions. */
  startWorker(intervalMs = 2e3) {
    if (this.queueInterval) return;
    this.queueInterval = setInterval(() => {
      this.processQueue().catch((err) => {
        logger.error({ err }, "[WorkflowEngine] Queue worker processing error");
      });
    }, intervalMs);
    this.queueInterval.unref();
  }
  stopWorker() {
    if (this.queueInterval) {
      clearInterval(this.queueInterval);
      this.queueInterval = null;
    }
  }
  /** Enqueues an execution for background worker processing. */
  async enqueueExecution(params) {
    const workflow = await prisma.automationWorkflow.findFirst({ where: { id: params.workflowId, organizationId: params.organizationId } });
    if (!workflow) {
      throw new Error(`Workflow ${params.workflowId} not found.`);
    }
    if (workflow.status !== "ACTIVE") {
      throw new Error(`Workflow "${workflow.name}" is not active (status: ${workflow.status}).`);
    }
    const correlationId = params.correlationId || crypto10.randomUUID();
    const versionToRun = workflow.publishedVersion || workflow.currentVersion;
    const executionId = crypto10.randomUUID();
    if (params.idempotencyKey) {
      const existing = await prisma.automationExecution.findFirst({
        where: { organizationId: params.organizationId, idempotencyKey: params.idempotencyKey, status: { in: ["COMPLETED", "RUNNING", "WAITING_APPROVAL"] } }
      });
      if (existing) {
        logger.info({ idempotencyKey: params.idempotencyKey, existingId: existing.id }, "[WorkflowEngine] Idempotent execution already exists, returning existing");
        return { executionId: existing.id, status: existing.status };
      }
    }
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    await prisma.automationExecution.create({
      data: {
        id: executionId,
        organizationId: params.organizationId,
        workflowId: workflow.id,
        workflowVersion: versionToRun,
        status: "QUEUED",
        triggerType: params.triggerType,
        triggerEventId: params.triggerEventId || null,
        entityType: params.entityType || null,
        entityId: params.entityId || null,
        correlationId,
        idempotencyKey: params.idempotencyKey || null,
        input: params.input || {},
        output: {},
        context: params.input || {},
        currentStepIndex: 0,
        totalSteps: steps.length,
        initiatedById: params.initiatedById || null
      }
    });
    setImmediate(() => {
      this.execute(executionId).catch((err) => {
        logger.error({ err, executionId }, "[WorkflowEngine] Background run error");
      });
    });
    return { executionId, status: "QUEUED" };
  }
  /** Process pending queued jobs in batch. */
  async processQueue() {
    if (this.isProcessingQueue) return 0;
    this.isProcessingQueue = true;
    try {
      const queuedJobs = await prisma.automationExecution.findMany({ where: { status: "QUEUED" }, take: 5, orderBy: { createdAt: "asc" } });
      for (const job of queuedJobs) {
        await this.execute(job.id);
      }
      return queuedJobs.length;
    } finally {
      this.isProcessingQueue = false;
    }
  }
  /** Core workflow execution loop. */
  async execute(executionId) {
    const execution = await prisma.automationExecution.findUnique({ where: { id: executionId }, include: { workflow: true } });
    if (!execution) return null;
    if (execution.status === "COMPLETED" || execution.status === "CANCELLED") {
      return execution;
    }
    const workflow = execution.workflow;
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    const limits = { ...DEFAULT_WORKFLOW_LIMITS, ...workflow.limits || {} };
    const retryPolicy = { ...DEFAULT_RETRY_POLICY, ...workflow.retryPolicy || {} };
    const startTime = execution.startedAt ? new Date(execution.startedAt).getTime() : Date.now();
    await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "RUNNING", startedAt: new Date(startTime) } });
    const context = {
      ...execution.context || {},
      input: execution.input,
      trigger: { type: execution.triggerType, eventId: execution.triggerEventId, entityType: execution.entityType, entityId: execution.entityId, correlationId: execution.correlationId }
    };
    let aiCallCount = 0;
    let toolCallCount = 0;
    let stepCount = 0;
    let currentStepIdx = execution.currentStepIndex || 0;
    while (currentStepIdx < steps.length) {
      const step = steps[currentStepIdx];
      if (!step) {
        return this.failExecution(executionId, execution.organizationId, `Step at index ${currentStepIdx} is missing from workflow definition.`);
      }
      stepCount++;
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > limits.maxDurationMs) {
        return this.failExecution(executionId, execution.organizationId, `Execution timed out after ${elapsedMs}ms.`);
      }
      if (stepCount > limits.maxSteps) {
        return this.failExecution(executionId, execution.organizationId, `Exceeded maximum allowed workflow steps (${limits.maxSteps}).`);
      }
      const stepExecutionId = crypto10.randomUUID();
      const stepStartTime = Date.now();
      await prisma.automationStepExecution.create({
        data: { id: stepExecutionId, executionId, stepIndex: currentStepIdx, stepId: step.id, stepName: step.name, stepType: step.type, status: "RUNNING", input: context, startedAt: new Date(stepStartTime) }
      });
      try {
        let stepOutput = {};
        let nextStepIdx = currentStepIdx + 1;
        switch (step.type) {
          case "CONDITION": {
            const matches = ConditionEngine.evaluate(step.condition, context);
            stepOutput = { conditionMet: matches };
            if (matches && step.thenStepId) {
              const targetIdx = steps.findIndex((s) => s.id === step.thenStepId);
              if (targetIdx !== -1) nextStepIdx = targetIdx;
            } else if (!matches && step.elseStepId) {
              const targetIdx = steps.findIndex((s) => s.id === step.elseStepId);
              if (targetIdx !== -1) nextStepIdx = targetIdx;
            }
            break;
          }
          case "AI_DECISION": {
            aiCallCount++;
            if (aiCallCount > limits.maxAiCalls) {
              throw new Error(`Exceeded maximum allowed AI calls (${limits.maxAiCalls}).`);
            }
            const interpolatedPrompt = this.interpolate(step.prompt, context);
            const decisionInstruction = `${interpolatedPrompt}

You MUST respond strictly in valid JSON matching this schema:
{
  "decision": "APPROVED" | "REJECTED" | "REVIEW_REQUIRED" | "FLAGGED",
  "reason": "explanation string",
  "confidence": number between 0 and 1,
  "recommended_action": "action_string"
}`;
            const result = await defaultAiProvider.generateText(decisionInstruction, { temperature: 0.1, responseMimeType: "application/json" });
            const rawContent = (result.text || "").trim();
            let parsedJson;
            try {
              const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
              parsedJson = JSON.parse(jsonMatch ? jsonMatch[0] : rawContent);
            } catch {
              parsedJson = { decision: "REVIEW_REQUIRED", reason: `AI output was not strictly valid JSON: ${rawContent.slice(0, 100)}`, confidence: 0.5, recommended_action: "MANUAL_REVIEW" };
            }
            const validated = StructuredAiDecisionSchema.safeParse(parsedJson);
            stepOutput = validated.success ? validated.data : { decision: "REVIEW_REQUIRED", reason: "AI output failed schema validation", confidence: 0.5, raw: rawContent };
            context[step.id] = stepOutput;
            break;
          }
          case "AI_GENERATION": {
            aiCallCount++;
            if (aiCallCount > limits.maxAiCalls) {
              throw new Error(`Exceeded maximum allowed AI calls (${limits.maxAiCalls}).`);
            }
            const interpolatedPrompt = this.interpolate(step.prompt, context);
            let citations = [];
            let promptWithContext = interpolatedPrompt;
            if (step.useKnowledgeBase) {
              try {
                const grounded = await KnowledgeService.getGroundedContext(
                  interpolatedPrompt,
                  { organizationId: execution.organizationId, userId: execution.initiatedById || void 0, userPermissions: ["*"] },
                  { filter: step.knowledgeFilter }
                );
                if (grounded.formattedContext) {
                  promptWithContext = `${grounded.formattedContext}

${interpolatedPrompt}`;
                  citations = grounded.citations;
                }
              } catch (kErr) {
                logger.warn({ kErr, executionId }, "[WorkflowEngine] Knowledge grounding non-fatal error");
              }
            }
            const genResult = await defaultAiProvider.generateText(promptWithContext);
            stepOutput = { generatedText: genResult.text, citations };
            context[step.outputKey || step.id] = genResult.text;
            break;
          }
          case "TOOL_CALL": {
            toolCallCount++;
            if (toolCallCount > limits.maxToolCalls) {
              throw new Error(`Exceeded maximum allowed tool calls (${limits.maxToolCalls}).`);
            }
            if (!execution.initiatedById) {
              throw new Error(`Tool call step "${step.name}" requires a workflow initiated by a real user (initiatedById is empty).`);
            }
            if (!isRegisteredToolCode(step.toolName)) {
              throw new Error(`Tool "${step.toolName}" is not registered.`);
            }
            const initiatingUser = await userRepository.findById(execution.initiatedById);
            const caller = initiatingUser && await resolveSanitizedUserForOrganization(initiatingUser, execution.organizationId);
            if (!caller) {
              throw new Error(`Initiating user no longer has access to this organization.`);
            }
            const definition = AI_TOOL_REGISTRY[step.toolName];
            if (!caller.role.permissions.includes(definition.requiredPermission) && caller.role.key !== "SUPER_ADMIN") {
              throw new Error(`Caller lacks required permission "${definition.requiredPermission}" for tool "${step.toolName}".`);
            }
            const toolArgs = this.interpolateObject(step.argumentsTemplate, context);
            const parsed = definition.inputSchema.safeParse(toolArgs);
            if (!parsed.success) {
              throw new Error(`Invalid input for tool "${step.toolName}": ${parsed.error.message}`);
            }
            stepOutput = await definition.handler(caller, parsed.data, {}) || {};
            context[step.outputKey || step.id] = stepOutput;
            break;
          }
          case "BUSINESS_ACTION": {
            if (step.requireApproval) {
              await approvalEngine.requestApproval({
                organizationId: execution.organizationId,
                executionId,
                stepExecutionId,
                workflowId: workflow.id,
                stepId: step.id,
                action: step.actionId,
                description: `Human approval required for action "${step.actionId}"`,
                payload: { parameters: step.parameters, context: context[step.id] || {} }
              });
              await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "WAITING_APPROVAL", currentStepIndex: currentStepIdx, context } });
              await prisma.automationStepExecution.update({ where: { id: stepExecutionId }, data: { status: "WAITING_APPROVAL" } });
              logger.info({ executionId, stepId: step.id }, "[WorkflowEngine] Paused for human approval");
              return { executionId, status: "WAITING_APPROVAL" };
            }
            const actionParams = this.interpolateObject(step.parameters, context);
            const idempotencyKey = `${workflow.id}:${execution.workflowVersion}:${execution.correlationId}:${step.id}`;
            const actionOutput = await actionRegistry.executeAction({
              actionId: step.actionId,
              input: actionParams,
              organizationId: execution.organizationId,
              userId: execution.initiatedById || void 0,
              userPermissions: ["*"],
              workflowId: workflow.id,
              executionId,
              stepId: step.id,
              correlationId: execution.correlationId,
              idempotencyKey
            });
            stepOutput = actionOutput;
            context[step.outputKey || step.id] = stepOutput;
            break;
          }
          case "APPROVAL": {
            const pendingApproval = await prisma.automationApproval.findFirst({ where: { executionId, stepId: step.id, status: "APPROVED" } });
            if (!pendingApproval) {
              await approvalEngine.requestApproval({
                organizationId: execution.organizationId,
                executionId,
                stepExecutionId,
                workflowId: workflow.id,
                stepId: step.id,
                action: "APPROVAL_GATE",
                description: this.interpolate(step.actionDescription, context),
                requiredRole: step.requiredRole,
                payload: { contextSummary: context },
                timeoutMinutes: step.timeoutMinutes
              });
              await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "WAITING_APPROVAL", currentStepIndex: currentStepIdx, context } });
              await prisma.automationStepExecution.update({ where: { id: stepExecutionId }, data: { status: "WAITING_APPROVAL" } });
              return { executionId, status: "WAITING_APPROVAL" };
            }
            stepOutput = { approved: true, approverId: pendingApproval.approverId };
            break;
          }
          case "NOTIFICATION": {
            const title = this.interpolate(step.titleTemplate, context);
            const message = this.interpolate(step.messageTemplate, context);
            const targetUserId = step.recipientUserId ? this.interpolate(step.recipientUserId, context) : void 0;
            stepOutput = await notificationEngine.dispatchNotification({
              organizationId: execution.organizationId,
              userId: targetUserId,
              recipientRole: step.recipientRole,
              channel: step.channel,
              title,
              message,
              level: step.level || "INFO",
              sourceWorkflowId: workflow.id,
              sourceExecutionId: executionId
            });
            break;
          }
          case "DELAY": {
            const delaySec = Math.min(step.durationSeconds, 10);
            await new Promise((resolve) => setTimeout(resolve, delaySec * 1e3));
            stepOutput = { delayedSeconds: delaySec };
            break;
          }
          case "TRANSFORM": {
            const transformed = {};
            for (const [outKey, pathExpr] of Object.entries(step.mappings)) {
              transformed[outKey] = ConditionEngine.resolvePath(context, pathExpr);
            }
            stepOutput = transformed;
            context[step.outputKey || step.id] = transformed;
            break;
          }
          case "LOOP": {
            const items = ConditionEngine.resolvePath(context, step.itemsPath);
            const loopArray = Array.isArray(items) ? items : [];
            const maxIter = Math.min(loopArray.length, step.maxIterations || limits.maxLoopIterations);
            const loopOutputs = [];
            for (let i = 0; i < maxIter; i++) {
              loopOutputs.push({ index: i, item: loopArray[i] });
            }
            stepOutput = { iterations: maxIter, itemsProcessed: loopOutputs };
            context[step.id] = stepOutput;
            break;
          }
          case "KNOWLEDGE_RETRIEVAL": {
            const query = this.interpolate(step.queryTemplate, context);
            const results = await KnowledgeService.search(
              { query, limit: step.maxResults || 5, filter: step.collectionIds?.length ? { collectionIds: step.collectionIds } : void 0 },
              { organizationId: execution.organizationId, userId: execution.initiatedById || void 0, userPermissions: ["*"] }
            );
            stepOutput = {
              query,
              count: results.length,
              results: results.map((r) => ({ documentTitle: r.documentTitle, collection: r.collectionName, score: r.score, snippet: r.content.slice(0, 300), content: r.content }))
            };
            context[step.outputKey || step.id] = stepOutput;
            break;
          }
          default:
            break;
        }
        const stepDuration = Date.now() - stepStartTime;
        await prisma.automationStepExecution.update({ where: { id: stepExecutionId }, data: { status: "COMPLETED", output: stepOutput, durationMs: stepDuration, completedAt: /* @__PURE__ */ new Date() } });
        currentStepIdx = nextStepIdx;
        await prisma.automationExecution.update({ where: { id: executionId }, data: { currentStepIndex: currentStepIdx, context } });
      } catch (stepErr) {
        const stepDuration = Date.now() - stepStartTime;
        await prisma.automationStepExecution.update({ where: { id: stepExecutionId }, data: { status: "FAILED", errorMessage: stepErr?.message || String(stepErr), durationMs: stepDuration, completedAt: /* @__PURE__ */ new Date() } });
        if (execution.retryCount < retryPolicy.maxRetries && step.retryOnFailure !== false) {
          const backoff = retryPolicy.exponential ? retryPolicy.backoffMs * Math.pow(2, execution.retryCount) : retryPolicy.backoffMs;
          await prisma.automationExecution.update({ where: { id: executionId }, data: { retryCount: { increment: 1 }, status: "QUEUED", errorMessage: `Retrying after step failure: ${stepErr?.message}` } });
          logger.warn({ executionId, stepId: step.id, retry: execution.retryCount + 1, backoff }, "[WorkflowEngine] Scheduling retry after failure");
          return { executionId, status: "RETRYING" };
        }
        return this.failExecution(executionId, execution.organizationId, stepErr?.message || String(stepErr));
      }
    }
    const totalDuration = Date.now() - startTime;
    const completed = await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "COMPLETED", completedAt: /* @__PURE__ */ new Date(), durationMs: totalDuration, output: context } });
    await auditLogRepository.record({
      organizationId: execution.organizationId,
      actorUserId: execution.initiatedById || void 0,
      actorType: execution.initiatedById ? "USER" : "SYSTEM",
      action: "AUTOMATION_WORKFLOW_COMPLETED",
      resourceType: "automation_workflow",
      resourceId: workflow.id,
      metadata: { executionId, workflowName: workflow.name, durationMs: totalDuration, stepsExecuted: stepCount }
    });
    return completed;
  }
  /** Resume an execution after approval grant. */
  async resumeExecution(executionId, organizationId) {
    const execution = await prisma.automationExecution.findFirst({ where: { id: executionId, organizationId } });
    if (!execution) {
      throw new Error(`Execution ${executionId} not found.`);
    }
    if (execution.status !== "WAITING_APPROVAL") {
      throw new Error(`Execution ${executionId} is not in WAITING_APPROVAL status (current: ${execution.status}).`);
    }
    await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "QUEUED", currentStepIndex: execution.currentStepIndex + 1 } });
    return this.execute(executionId);
  }
  /** Cancel a running or waiting execution. */
  async cancelExecution(executionId, organizationId, reason) {
    const execution = await prisma.automationExecution.findFirst({ where: { id: executionId, organizationId } });
    if (!execution) {
      throw new Error(`Execution ${executionId} not found.`);
    }
    if (execution.status === "COMPLETED" || execution.status === "FAILED") {
      throw new Error(`Cannot cancel an execution with status ${execution.status}.`);
    }
    return prisma.automationExecution.update({ where: { id: executionId }, data: { status: "CANCELLED", completedAt: /* @__PURE__ */ new Date(), errorMessage: reason || "Cancelled by user" } });
  }
  async failExecution(executionId, organizationId, error) {
    const failed = await prisma.automationExecution.update({ where: { id: executionId }, data: { status: "FAILED", completedAt: /* @__PURE__ */ new Date(), errorMessage: error } });
    await auditLogRepository.record({ organizationId, actorType: "SYSTEM", action: "AUTOMATION_WORKFLOW_FAILED", resourceType: "automation_execution", resourceId: executionId, metadata: { error } });
    return failed;
  }
  /** Interpolate variable strings like {{payload.client.name}} or {{invoice.amount}} */
  interpolate(template, context) {
    if (!template) return "";
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
      const val = ConditionEngine.resolvePath(context, path.trim());
      if (val === void 0 || val === null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val);
    });
  }
  interpolateObject(obj, context) {
    if (typeof obj === "string") {
      return this.interpolate(obj, context);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.interpolateObject(item, context));
    }
    if (obj !== null && typeof obj === "object") {
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = this.interpolateObject(v, context);
      }
      return result;
    }
    return obj;
  }
};
var workflowEngine = WorkflowEngine.getInstance();

// server/services/automation/WorkflowValidator.ts
var WorkflowValidator = class {
  /**
   * Validates a workflow definition before publishing.
   */
  static async validate(params) {
    const issues = [];
    if (!params.name || params.name.trim().length < 3) {
      issues.push({ field: "name", message: "Workflow name must be at least 3 characters long.", severity: "ERROR" });
    }
    if (!params.triggerType) {
      issues.push({ field: "triggerType", message: "Workflow trigger type is required.", severity: "ERROR" });
    }
    if (params.triggerType === "EVENT") {
      const eventCfg = params.triggerConfig;
      if (!eventCfg?.eventType) {
        issues.push({ field: "triggerConfig.eventType", message: "Event trigger requires a valid 'eventType'.", severity: "ERROR" });
      }
    }
    if (params.triggerType === "SCHEDULE") {
      const schedCfg = params.triggerConfig;
      if (!schedCfg?.scheduleType) {
        issues.push({ field: "triggerConfig.scheduleType", message: "Schedule trigger requires 'scheduleType'.", severity: "ERROR" });
      }
    }
    if (!Array.isArray(params.steps) || params.steps.length === 0) {
      issues.push({ field: "steps", message: "Workflow must contain at least one step.", severity: "ERROR" });
    } else {
      const stepIds = /* @__PURE__ */ new Set();
      for (let i = 0; i < params.steps.length; i++) {
        const step = params.steps[i];
        const stepPrefix = `steps[${i}]`;
        if (!step) {
          issues.push({ field: stepPrefix, message: `Step at index ${i} is missing.`, severity: "ERROR" });
          continue;
        }
        if (!step.id) {
          issues.push({ field: `${stepPrefix}.id`, message: `Step at index ${i} is missing a unique ID.`, severity: "ERROR" });
        } else {
          if (stepIds.has(step.id)) {
            issues.push({ field: `${stepPrefix}.id`, message: `Duplicate step ID: "${step.id}".`, severity: "ERROR" });
          }
          stepIds.add(step.id);
        }
        if (!step.name) {
          issues.push({ field: `${stepPrefix}.name`, message: `Step at index ${i} is missing a name.`, severity: "ERROR" });
        }
        switch (step.type) {
          case "CONDITION": {
            if (!step.condition) {
              issues.push({ field: `${stepPrefix}.condition`, message: `Condition step "${step.name}" is missing condition logic.`, severity: "ERROR" });
            }
            break;
          }
          case "TOOL_CALL": {
            if (!step.toolName) {
              issues.push({ field: `${stepPrefix}.toolName`, message: `Tool call step "${step.name}" is missing toolName.`, severity: "ERROR" });
            } else if (!isRegisteredToolCode(step.toolName)) {
              issues.push({ field: `${stepPrefix}.toolName`, message: `Referenced tool "${step.toolName}" is not registered in the system.`, severity: "ERROR" });
            }
            break;
          }
          case "BUSINESS_ACTION": {
            if (!step.actionId) {
              issues.push({ field: `${stepPrefix}.actionId`, message: `Business action step "${step.name}" is missing actionId.`, severity: "ERROR" });
            } else {
              const action = actionRegistry.getAction(step.actionId);
              if (!action) {
                issues.push({ field: `${stepPrefix}.actionId`, message: `Referenced business action "${step.actionId}" does not exist in registry.`, severity: "ERROR" });
              }
            }
            break;
          }
          case "AI_DECISION":
          case "AI_GENERATION": {
            if (!step.prompt) {
              issues.push({ field: `${stepPrefix}.prompt`, message: `AI step "${step.name}" is missing prompt instruction.`, severity: "ERROR" });
            }
            break;
          }
          case "APPROVAL": {
            if (!step.actionDescription) {
              issues.push({ field: `${stepPrefix}.actionDescription`, message: `Approval step "${step.name}" requires an actionDescription.`, severity: "ERROR" });
            }
            break;
          }
          case "NOTIFICATION": {
            if (!step.titleTemplate || !step.messageTemplate) {
              issues.push({ field: `${stepPrefix}.templates`, message: `Notification step "${step.name}" requires titleTemplate and messageTemplate.`, severity: "ERROR" });
            }
            break;
          }
          case "LOOP": {
            if (!step.itemsPath) {
              issues.push({ field: `${stepPrefix}.itemsPath`, message: `Loop step "${step.name}" requires itemsPath.`, severity: "ERROR" });
            }
            if (step.maxIterations && step.maxIterations > 50) {
              issues.push({ field: `${stepPrefix}.maxIterations`, message: "Loop step maximum iterations cannot exceed 50 for safety.", severity: "ERROR" });
            }
            break;
          }
          case "KNOWLEDGE_RETRIEVAL": {
            if (!step.queryTemplate || step.queryTemplate.trim().length === 0) {
              issues.push({ field: `${stepPrefix}.queryTemplate`, message: `Knowledge retrieval step "${step.name}" requires a queryTemplate.`, severity: "ERROR" });
            }
            break;
          }
          default:
            break;
        }
      }
      for (const step of params.steps) {
        if (step.type === "CONDITION") {
          if (step.thenStepId && !stepIds.has(step.thenStepId)) {
            issues.push({ field: `steps.${step.id}.thenStepId`, message: `Condition target thenStepId "${step.thenStepId}" does not exist.`, severity: "ERROR" });
          }
          if (step.elseStepId && !stepIds.has(step.elseStepId)) {
            issues.push({ field: `steps.${step.id}.elseStepId`, message: `Condition target elseStepId "${step.elseStepId}" does not exist.`, severity: "ERROR" });
          }
        }
      }
    }
    if (params.limits) {
      if (params.limits.maxSteps < 1 || params.limits.maxSteps > 100) {
        issues.push({ field: "limits.maxSteps", message: "maxSteps must be between 1 and 100.", severity: "ERROR" });
      }
      if (params.limits.maxDurationMs < 5e3 || params.limits.maxDurationMs > 6e5) {
        issues.push({ field: "limits.maxDurationMs", message: "maxDurationMs must be between 5000ms and 600000ms (10 minutes).", severity: "ERROR" });
      }
    }
    if (params.retryPolicy) {
      if (params.retryPolicy.maxRetries < 0 || params.retryPolicy.maxRetries > 5) {
        issues.push({ field: "retryPolicy.maxRetries", message: "maxRetries cannot exceed 5.", severity: "ERROR" });
      }
    }
    const errors = issues.filter((i) => i.severity === "ERROR").map((i) => i.message);
    const warnings = issues.filter((i) => i.severity === "WARNING").map((i) => i.message);
    return { isValid: errors.length === 0, errors, warnings, details: issues };
  }
};

// server/services/automation/AutomationService.ts
var AutomationService = class _AutomationService {
  constructor() {
    this.initEventListeners();
    this.initSchedulerIntegration();
  }
  static getInstance() {
    if (!_AutomationService.instance) {
      _AutomationService.instance = new _AutomationService();
    }
    return _AutomationService.instance;
  }
  /**
   * Automatically dispatches business events to matching active workflows.
   */
  initEventListeners() {
    eventEngine.subscribe(async (event) => {
      try {
        const workflows = await prisma.automationWorkflow.findMany({
          where: {
            organizationId: event.organizationId,
            status: "ACTIVE",
            triggerType: "EVENT"
          }
        });
        for (const wf of workflows) {
          const cfg = wf.triggerConfig || {};
          if (cfg.eventType === event.eventType || cfg.eventType === "*") {
            if (cfg.filterCondition) {
              const matches = ConditionEngine.evaluate(cfg.filterCondition, {
                event: event.eventType,
                entityType: event.entityType,
                entityId: event.entityId,
                payload: event.payload
              });
              if (!matches) continue;
            }
            logger.info(
              { workflowId: wf.id, eventType: event.eventType, correlationId: event.correlationId },
              "[AutomationService] Event triggered matching workflow execution"
            );
            await workflowEngine.enqueueExecution({
              workflowId: wf.id,
              organizationId: event.organizationId,
              triggerType: "EVENT",
              triggerEventId: event.eventId,
              entityType: event.entityType,
              entityId: event.entityId,
              input: event.payload,
              correlationId: event.correlationId,
              idempotencyKey: `event:${event.eventId}:${wf.id}`
            });
          }
        }
      } catch (err) {
        logger.error({ err, eventId: event.eventId }, "[AutomationService] Error routing event to workflows");
      }
    });
  }
  /**
   * Connect scheduler ticks to workflow execution.
   */
  initSchedulerIntegration() {
    schedulerEngine.setWorkflowExecutor(async (params) => {
      return workflowEngine.enqueueExecution({
        workflowId: params.workflowId,
        organizationId: params.organizationId,
        triggerType: "SCHEDULE",
        input: params.input,
        correlationId: params.correlationId
      });
    });
    schedulerEngine.start();
    workflowEngine.startWorker();
  }
  // ---------------------------------------------------------------------------
  // Workflows Lifecycle & Management
  // ---------------------------------------------------------------------------
  async createWorkflow(params) {
    const id = crypto11.randomUUID();
    const workflow = await prisma.automationWorkflow.create({
      data: {
        id,
        organizationId: params.organizationId,
        name: params.name,
        description: params.description || null,
        category: params.category || "GENERAL",
        status: "DRAFT",
        currentVersion: 1,
        triggerType: params.triggerType,
        triggerConfig: params.triggerConfig || {},
        conditions: params.conditions || [],
        steps: params.steps || [],
        retryPolicy: params.retryPolicy || DEFAULT_RETRY_POLICY,
        limits: params.limits || DEFAULT_WORKFLOW_LIMITS,
        createdById: params.userId || null,
        updatedById: params.userId || null
      }
    });
    if (params.userId) {
      await auditLogRepository.record({
        organizationId: params.organizationId,
        actorUserId: params.userId,
        actorType: "USER",
        action: "AUTOMATION_WORKFLOW_CREATED",
        resourceType: "automation_workflow",
        resourceId: workflow.id,
        metadata: { name: workflow.name, triggerType: workflow.triggerType }
      });
    }
    return workflow;
  }
  async updateWorkflow(params) {
    const existing = await prisma.automationWorkflow.findFirst({
      where: { id: params.id, organizationId: params.organizationId }
    });
    if (!existing) {
      throw new NotFoundError("Workflow not found.");
    }
    const updateData = {
      updatedById: params.userId || null
    };
    if (params.name !== void 0) updateData.name = params.name;
    if (params.description !== void 0) updateData.description = params.description;
    if (params.category !== void 0) updateData.category = params.category;
    if (params.triggerType !== void 0) updateData.triggerType = params.triggerType;
    if (params.triggerConfig !== void 0) updateData.triggerConfig = params.triggerConfig;
    if (params.conditions !== void 0) updateData.conditions = params.conditions;
    if (params.steps !== void 0) updateData.steps = params.steps;
    if (params.retryPolicy !== void 0) updateData.retryPolicy = params.retryPolicy;
    if (params.limits !== void 0) updateData.limits = params.limits;
    if (params.status !== void 0) updateData.status = params.status;
    if (existing.publishedVersion && params.steps !== void 0) {
      updateData.currentVersion = (existing.currentVersion || 1) + 1;
    }
    const updated = await prisma.automationWorkflow.update({
      where: { id: existing.id },
      data: updateData
    });
    if (params.userId) {
      await auditLogRepository.record({
        organizationId: params.organizationId,
        actorUserId: params.userId,
        actorType: "USER",
        action: "AUTOMATION_WORKFLOW_UPDATED",
        resourceType: "automation_workflow",
        resourceId: updated.id
      });
    }
    return updated;
  }
  /**
   * Publishes a workflow:
   * 1. Validates definition against strict rules
   * 2. Saves snapshot to automation_workflow_versions
   * 3. Sets publishedVersion and activates workflow
   */
  async publishWorkflow(params) {
    const workflow = await prisma.automationWorkflow.findFirst({
      where: { id: params.id, organizationId: params.organizationId }
    });
    if (!workflow) {
      throw new NotFoundError("Workflow not found.");
    }
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    const validation = await WorkflowValidator.validate({
      organizationId: params.organizationId,
      name: workflow.name,
      triggerType: workflow.triggerType,
      triggerConfig: workflow.triggerConfig,
      conditions: workflow.conditions,
      steps,
      limits: workflow.limits,
      retryPolicy: workflow.retryPolicy
    });
    if (!validation.isValid) {
      throw new ValidationError(`Cannot publish invalid workflow:
${validation.errors.join("\n")}`);
    }
    const newVersionNumber = (workflow.publishedVersion || 0) + 1;
    await prisma.automationWorkflowVersion.create({
      data: {
        id: crypto11.randomUUID(),
        workflowId: workflow.id,
        version: newVersionNumber,
        name: workflow.name,
        description: workflow.description || null,
        category: workflow.category,
        triggerType: workflow.triggerType,
        triggerConfig: workflow.triggerConfig,
        conditions: workflow.conditions,
        steps: workflow.steps,
        retryPolicy: workflow.retryPolicy,
        limits: workflow.limits,
        publishedById: params.userId || null,
        changeSummary: params.changeSummary || `Published version ${newVersionNumber}`
      }
    });
    const published = await prisma.automationWorkflow.update({
      where: { id: workflow.id },
      data: {
        publishedVersion: newVersionNumber,
        currentVersion: newVersionNumber,
        status: "ACTIVE",
        updatedById: params.userId || null
      }
    });
    await auditLogRepository.record({
      organizationId: params.organizationId,
      actorUserId: params.userId || void 0,
      actorType: params.userId ? "USER" : "SYSTEM",
      action: "AUTOMATION_WORKFLOW_PUBLISHED",
      resourceType: "automation_workflow",
      resourceId: workflow.id,
      metadata: { version: newVersionNumber }
    });
    return published;
  }
  async getWorkflow(id, organizationId) {
    const workflow = await prisma.automationWorkflow.findFirst({
      where: { id, organizationId },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 10
        },
        createdBy: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
    if (!workflow) {
      throw new NotFoundError("Workflow not found.");
    }
    return workflow;
  }
  async listWorkflows(params) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;
    const where = { organizationId: params.organizationId };
    if (params.status) where.status = params.status;
    if (params.category) where.category = params.category;
    if (params.triggerType) where.triggerType = params.triggerType;
    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { description: { contains: params.search, mode: "insensitive" } }
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.automationWorkflow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
        include: {
          createdBy: {
            select: { id: true, firstName: true, lastName: true }
          },
          _count: {
            select: { executions: true, schedules: true }
          }
        }
      }),
      prisma.automationWorkflow.count({ where })
    ]);
    return { rows, total, page, limit };
  }
  async listWorkflowVersions(workflowId, organizationId) {
    const workflow = await prisma.automationWorkflow.findFirst({
      where: { id: workflowId, organizationId }
    });
    if (!workflow) throw new NotFoundError("Workflow not found.");
    return prisma.automationWorkflowVersion.findMany({
      where: { workflowId },
      orderBy: { version: "desc" },
      include: {
        publishedBy: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    });
  }
  // ---------------------------------------------------------------------------
  // Executions
  // ---------------------------------------------------------------------------
  async triggerWorkflow(params) {
    return workflowEngine.enqueueExecution({
      workflowId: params.workflowId,
      organizationId: params.organizationId,
      triggerType: params.triggerType || "MANUAL",
      input: params.input || {},
      initiatedById: params.userId,
      correlationId: params.correlationId
    });
  }
  async getExecution(id, organizationId) {
    const execution = await prisma.automationExecution.findFirst({
      where: { id, organizationId },
      include: {
        workflow: {
          select: { id: true, name: true, category: true, steps: true }
        },
        stepExecutions: {
          orderBy: { stepIndex: "asc" }
        },
        approvals: true,
        actionExecutions: true,
        notifications: true,
        tasks: true
      }
    });
    if (!execution) {
      throw new NotFoundError("Execution not found.");
    }
    return execution;
  }
  async listExecutions(params) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;
    const where = { organizationId: params.organizationId };
    if (params.workflowId) where.workflowId = params.workflowId;
    if (params.status) where.status = params.status;
    if (params.triggerType) where.triggerType = params.triggerType;
    const [rows, total] = await Promise.all([
      prisma.automationExecution.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          workflow: {
            select: { id: true, name: true, category: true }
          },
          _count: {
            select: { stepExecutions: true, approvals: true, tasks: true }
          }
        }
      }),
      prisma.automationExecution.count({ where })
    ]);
    return { rows, total, page, limit };
  }
  async retryExecution(id, organizationId) {
    const execution = await prisma.automationExecution.findFirst({
      where: { id, organizationId }
    });
    if (!execution) throw new NotFoundError("Execution not found.");
    if (execution.status !== "FAILED") {
      throw new ValidationError(`Only failed executions can be retried (current status: ${execution.status}).`);
    }
    await prisma.automationExecution.update({
      where: { id },
      data: {
        status: "QUEUED",
        errorMessage: null
      }
    });
    return workflowEngine.execute(id);
  }
  async cancelExecution(id, organizationId, reason) {
    return workflowEngine.cancelExecution(id, organizationId, reason);
  }
  // ---------------------------------------------------------------------------
  // Approvals
  // ---------------------------------------------------------------------------
  async listApprovals(params) {
    return approvalEngine.listApprovals(params);
  }
  async decideApproval(params) {
    const result = await approvalEngine.decideApproval(params);
    if (result.executionResumed && result.approval.executionId) {
      setImmediate(() => {
        workflowEngine.resumeExecution(result.approval.executionId, params.organizationId).catch((err) => {
          logger.error({ err, executionId: result.approval.executionId }, "[AutomationService] Resume after approval failed");
        });
      });
    }
    return result;
  }
  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------
  async listTasks(params) {
    return taskManager.listTasks(params);
  }
  async createTask(params) {
    return taskManager.createTask(params);
  }
  async updateTask(params) {
    return taskManager.updateTask(params);
  }
  // ---------------------------------------------------------------------------
  // Schedules
  // ---------------------------------------------------------------------------
  async listSchedules(params) {
    return schedulerEngine.listSchedules(params);
  }
  async createSchedule(params) {
    return schedulerEngine.createSchedule(params);
  }
  async toggleSchedule(id, organizationId, isActive) {
    return schedulerEngine.toggleSchedule(id, organizationId, isActive);
  }
  async deleteSchedule(id, organizationId) {
    return schedulerEngine.deleteSchedule(id, organizationId);
  }
  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  async emitEvent(params) {
    return eventEngine.emit(params);
  }
  listRegisteredEventTypes() {
    return eventEngine.listRegisteredEvents();
  }
  async listEvents(params) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;
    const where = { organizationId: params.organizationId };
    if (params.eventType) where.eventType = params.eventType;
    if (params.correlationId) where.correlationId = params.correlationId;
    const [rows, total] = await Promise.all([
      prisma.automationEvent.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" }
      }),
      prisma.automationEvent.count({ where })
    ]);
    return { rows, total, page, limit };
  }
  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  listRegisteredActions() {
    return actionRegistry.listActions();
  }
  async executeActionDirectly(params) {
    return actionRegistry.executeAction({
      actionId: params.actionId,
      input: params.input,
      organizationId: params.organizationId,
      userId: params.userId,
      userPermissions: params.userPermissions,
      correlationId: crypto11.randomUUID()
    });
  }
  // ---------------------------------------------------------------------------
  // Dashboard & Analytics
  // ---------------------------------------------------------------------------
  async getDashboardMetrics(organizationId) {
    const [
      totalWorkflows,
      activeWorkflows,
      totalExecutions,
      completedExecutions,
      failedExecutions,
      runningExecutions,
      pendingApprovals,
      activeTasks,
      recentExecutions
    ] = await Promise.all([
      prisma.automationWorkflow.count({ where: { organizationId } }),
      prisma.automationWorkflow.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.automationExecution.count({ where: { organizationId } }),
      prisma.automationExecution.count({ where: { organizationId, status: "COMPLETED" } }),
      prisma.automationExecution.count({ where: { organizationId, status: "FAILED" } }),
      prisma.automationExecution.count({ where: { organizationId, status: { in: ["RUNNING", "QUEUED", "WAITING_APPROVAL"] } } }),
      prisma.automationApproval.count({ where: { organizationId, status: "PENDING" } }),
      prisma.automationTask.count({ where: { organizationId, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
      prisma.automationExecution.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          workflow: { select: { id: true, name: true, category: true } }
        }
      })
    ]);
    const successRate = totalExecutions > 0 ? Math.round(completedExecutions / totalExecutions * 100) : 100;
    return {
      metrics: {
        totalWorkflows,
        activeWorkflows,
        totalExecutions,
        completedExecutions,
        failedExecutions,
        runningExecutions,
        pendingApprovals,
        activeTasks,
        successRate
      },
      recentExecutions
    };
  }
  /**
   * Drains one batch of due schedules and queued executions on demand.
   * `initSchedulerIntegration`'s setInterval-based timers cover a
   * traditional long-running process, but on a serverless deployment
   * (Vercel) the process is torn down between requests and those timers
   * never reliably fire — this method is what POST
   * /automation/internal/tick calls when triggered by an external Vercel
   * Cron job instead. Safe to call concurrently/repeatedly: both
   * `tick()` and `processQueue()` are already idempotent single-flight
   * guarded (`isProcessing`/`isProcessingQueue`).
   */
  async runCronTick() {
    const schedulesTriggered = await schedulerEngine.tick();
    const queuedExecutionsProcessed = await workflowEngine.processQueue();
    return { schedulesTriggered, queuedExecutionsProcessed };
  }
};
var automationService = AutomationService.getInstance();

// server/routes/v1/automationRoutes.ts
var router37 = Router37();
router37.get(
  "/internal/tick",
  asyncHandler(async (req, res) => {
    if (!config.cronSecret) {
      throw new NotFoundError("Not found.");
    }
    if (req.headers.authorization !== `Bearer ${config.cronSecret}`) {
      throw new AuthenticationError("Invalid cron credentials.");
    }
    const result = await automationService.runCronTick();
    sendSuccess(res, result);
  })
);
router37.use(authenticateToken);
var CreateWorkflowSchema = z31.object({
  name: z31.string().min(1).max(200),
  description: z31.string().optional(),
  category: z31.string().default("GENERAL"),
  triggerType: z31.enum(["EVENT", "SCHEDULE", "MANUAL", "API", "CONDITIONAL"]).default("EVENT"),
  triggerConfig: z31.record(z31.unknown()).default({}),
  conditions: z31.unknown().default([]),
  steps: z31.array(z31.record(z31.unknown())).default([]),
  retryPolicy: z31.object({
    maxRetries: z31.number().int().min(0).max(5).default(2),
    backoffMs: z31.number().int().min(100).max(6e4).default(1e3),
    exponential: z31.boolean().default(true)
  }).optional(),
  limits: z31.object({
    maxSteps: z31.number().int().min(1).max(100).default(50),
    maxDurationMs: z31.number().int().min(5e3).max(6e5).default(3e5),
    maxAiCalls: z31.number().int().min(0).max(50).default(10),
    maxToolCalls: z31.number().int().min(0).max(50).default(15),
    maxLoopIterations: z31.number().int().min(1).max(50).default(10)
  }).optional()
});
var UpdateWorkflowSchema = CreateWorkflowSchema.partial().extend({
  status: z31.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).optional()
});
var TriggerWorkflowSchema = z31.object({
  input: z31.record(z31.unknown()).default({}),
  correlationId: z31.string().optional()
});
var DecideApprovalSchema = z31.object({
  decision: z31.enum(["APPROVED", "REJECTED"]),
  reason: z31.string().optional()
});
var CreateTaskSchema = z31.object({
  title: z31.string().min(1),
  description: z31.string().optional(),
  assignedUserId: z31.string().optional(),
  assignedRole: z31.string().optional(),
  priority: z31.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueDate: z31.string().optional(),
  sourceWorkflowId: z31.string().optional(),
  sourceExecutionId: z31.string().optional(),
  sourceEntityType: z31.string().optional(),
  sourceEntityId: z31.string().optional(),
  isAiGenerated: z31.boolean().default(false),
  metadata: z31.record(z31.unknown()).optional()
});
var UpdateTaskSchema = z31.object({
  status: z31.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  assignedUserId: z31.string().optional(),
  priority: z31.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z31.string().optional()
});
var CreateScheduleSchema = z31.object({
  workflowId: z31.string().uuid(),
  name: z31.string().min(1),
  description: z31.string().optional(),
  scheduleType: z31.enum(["ONE_TIME", "RECURRING", "CRON"]).default("RECURRING"),
  cronExpression: z31.string().optional(),
  timezone: z31.string().default("UTC"),
  intervalSeconds: z31.number().int().positive().optional(),
  config: z31.record(z31.unknown()).optional()
});
var EmitEventSchema = z31.object({
  eventType: z31.string().min(1),
  entityType: z31.string().min(1),
  entityId: z31.string().min(1),
  sourceModule: z31.string().optional(),
  payload: z31.record(z31.unknown()).default({}),
  correlationId: z31.string().optional()
});
var ExecuteActionSchema = z31.object({
  actionId: z31.string().min(1),
  input: z31.record(z31.unknown()).default({})
});
router37.get(
  "/dashboard",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const data = await automationService.getDashboardMetrics(req.user.organizationId);
    sendSuccess(res, data);
  })
);
router37.get(
  "/workflows",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const result = await automationService.listWorkflows({
      organizationId: req.user.organizationId,
      status: req.query.status,
      category: req.query.category,
      triggerType: req.query.triggerType,
      search: req.query.search,
      page: req.query.page ? Number(req.query.page) : void 0,
      limit: req.query.limit ? Number(req.query.limit) : void 0
    });
    sendSuccess(res, result);
  })
);
router37.post(
  "/workflows",
  requirePermission("automation.create"),
  asyncHandler(async (req, res) => {
    const body = CreateWorkflowSchema.parse(req.body);
    const workflow = await automationService.createWorkflow({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      name: body.name,
      description: body.description,
      category: body.category,
      triggerType: body.triggerType,
      triggerConfig: body.triggerConfig,
      conditions: body.conditions,
      steps: body.steps,
      retryPolicy: body.retryPolicy,
      limits: body.limits
    });
    sendSuccess(res, { workflow }, 201);
  })
);
router37.get(
  "/workflows/:id",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const workflow = await automationService.getWorkflow(req.params.id, req.user.organizationId);
    sendSuccess(res, { workflow });
  })
);
router37.put(
  "/workflows/:id",
  requirePermission("automation.edit"),
  asyncHandler(async (req, res) => {
    const body = UpdateWorkflowSchema.parse(req.body);
    const updated = await automationService.updateWorkflow({
      id: req.params.id,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      name: body.name,
      description: body.description,
      category: body.category,
      triggerType: body.triggerType,
      triggerConfig: body.triggerConfig,
      conditions: body.conditions,
      steps: body.steps,
      retryPolicy: body.retryPolicy,
      limits: body.limits,
      status: body.status
    });
    sendSuccess(res, { workflow: updated });
  })
);
router37.post(
  "/workflows/:id/publish",
  requirePermission("automation.publish"),
  asyncHandler(async (req, res) => {
    const body = z31.object({ changeSummary: z31.string().optional() }).parse(req.body || {});
    const published = await automationService.publishWorkflow({
      id: req.params.id,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      changeSummary: body.changeSummary
    });
    sendSuccess(res, { workflow: published });
  })
);
router37.get(
  "/workflows/:id/versions",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const versions = await automationService.listWorkflowVersions(req.params.id, req.user.organizationId);
    sendSuccess(res, { versions });
  })
);
router37.post(
  "/workflows/:id/trigger",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const body = TriggerWorkflowSchema.parse(req.body || {});
    const result = await automationService.triggerWorkflow({
      workflowId: req.params.id,
      organizationId: req.user.organizationId,
      triggerType: "MANUAL",
      input: body.input,
      userId: req.user.id,
      correlationId: body.correlationId
    });
    sendSuccess(res, result, 202);
  })
);
router37.get(
  "/executions",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const result = await automationService.listExecutions({
      organizationId: req.user.organizationId,
      workflowId: req.query.workflowId,
      status: req.query.status,
      triggerType: req.query.triggerType,
      page: req.query.page ? Number(req.query.page) : void 0,
      limit: req.query.limit ? Number(req.query.limit) : void 0
    });
    sendSuccess(res, result);
  })
);
router37.get(
  "/executions/:id",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const execution = await automationService.getExecution(req.params.id, req.user.organizationId);
    sendSuccess(res, { execution });
  })
);
router37.post(
  "/executions/:id/retry",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const result = await automationService.retryExecution(req.params.id, req.user.organizationId);
    sendSuccess(res, { execution: result });
  })
);
router37.post(
  "/executions/:id/cancel",
  requirePermission("automation.manage"),
  asyncHandler(async (req, res) => {
    const body = z31.object({ reason: z31.string().optional() }).parse(req.body || {});
    const result = await automationService.cancelExecution(req.params.id, req.user.organizationId, body.reason);
    sendSuccess(res, { execution: result });
  })
);
router37.get(
  "/approvals",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const result = await automationService.listApprovals({
      organizationId: req.user.organizationId,
      workflowId: req.query.workflowId,
      status: req.query.status,
      page: req.query.page ? Number(req.query.page) : void 0,
      limit: req.query.limit ? Number(req.query.limit) : void 0
    });
    sendSuccess(res, result);
  })
);
router37.post(
  "/approvals/:id/decide",
  requirePermission("automation.approve"),
  asyncHandler(async (req, res) => {
    const body = DecideApprovalSchema.parse(req.body);
    const result = await automationService.decideApproval({
      approvalId: req.params.id,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      userRole: req.user.role.key,
      decision: body.decision,
      reason: body.reason
    });
    sendSuccess(res, result);
  })
);
router37.get(
  "/tasks",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const result = await automationService.listTasks({
      organizationId: req.user.organizationId,
      status: req.query.status,
      priority: req.query.priority,
      assignedUserId: req.query.assignedUserId,
      sourceWorkflowId: req.query.sourceWorkflowId,
      page: req.query.page ? Number(req.query.page) : void 0,
      limit: req.query.limit ? Number(req.query.limit) : void 0
    });
    sendSuccess(res, result);
  })
);
router37.post(
  "/tasks",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const body = CreateTaskSchema.parse(req.body);
    const task = await automationService.createTask({
      organizationId: req.user.organizationId,
      ...body
    });
    sendSuccess(res, { task }, 201);
  })
);
router37.patch(
  "/tasks/:id",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const body = UpdateTaskSchema.parse(req.body);
    const updated = await automationService.updateTask({
      taskId: req.params.id,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      ...body
    });
    sendSuccess(res, { task: updated });
  })
);
router37.get(
  "/schedules",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const isActive = req.query.isActive !== void 0 ? req.query.isActive === "true" : void 0;
    const result = await automationService.listSchedules({
      organizationId: req.user.organizationId,
      workflowId: req.query.workflowId,
      isActive,
      page: req.query.page ? Number(req.query.page) : void 0,
      limit: req.query.limit ? Number(req.query.limit) : void 0
    });
    sendSuccess(res, result);
  })
);
router37.post(
  "/schedules",
  requirePermission("automation.manage"),
  asyncHandler(async (req, res) => {
    const body = CreateScheduleSchema.parse(req.body);
    const schedule = await automationService.createSchedule({
      organizationId: req.user.organizationId,
      ...body
    });
    sendSuccess(res, { schedule }, 201);
  })
);
router37.patch(
  "/schedules/:id/toggle",
  requirePermission("automation.manage"),
  asyncHandler(async (req, res) => {
    const body = z31.object({ isActive: z31.boolean().optional() }).parse(req.body || {});
    const schedule = await automationService.toggleSchedule(req.params.id, req.user.organizationId, body.isActive);
    sendSuccess(res, { schedule });
  })
);
router37.delete(
  "/schedules/:id",
  requirePermission("automation.manage"),
  asyncHandler(async (req, res) => {
    const result = await automationService.deleteSchedule(req.params.id, req.user.organizationId);
    sendSuccess(res, result);
  })
);
router37.get(
  "/events/types",
  requirePermission("automation.read"),
  asyncHandler(async (_req, res) => {
    const types = automationService.listRegisteredEventTypes();
    sendSuccess(res, { types });
  })
);
router37.get(
  "/events",
  requirePermission("automation.read"),
  asyncHandler(async (req, res) => {
    const result = await automationService.listEvents({
      organizationId: req.user.organizationId,
      eventType: req.query.eventType,
      correlationId: req.query.correlationId,
      page: req.query.page ? Number(req.query.page) : void 0,
      limit: req.query.limit ? Number(req.query.limit) : void 0
    });
    sendSuccess(res, result);
  })
);
router37.post(
  "/events",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const body = EmitEventSchema.parse(req.body);
    const event = await automationService.emitEvent({
      organizationId: req.user.organizationId,
      actorId: req.user.id,
      actorType: "USER",
      ...body
    });
    sendSuccess(res, { event }, 202);
  })
);
router37.get(
  "/actions",
  requirePermission("automation.read"),
  asyncHandler(async (_req, res) => {
    const actions = automationService.listRegisteredActions();
    sendSuccess(res, { actions });
  })
);
router37.post(
  "/actions/execute",
  requirePermission("automation.execute"),
  asyncHandler(async (req, res) => {
    const body = ExecuteActionSchema.parse(req.body);
    const result = await automationService.executeActionDirectly({
      actionId: body.actionId,
      input: body.input,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      userPermissions: req.user.role.permissions || []
    });
    sendSuccess(res, { result });
  })
);
var automationRoutes_default = router37;

// server/routes/v1/knowledgeRoutes.ts
import { Router as Router38 } from "express";
import express3 from "express";

// server/schemas/knowledgeSchemas.ts
import { z as z32 } from "zod";
var knowledgeAccessPolicySchema = z32.enum(["PUBLIC", "RESTRICTED", "ROLE_BASED", "OWNER_ONLY"]);
var knowledgeSourceTypeSchema = z32.enum([
  "UPLOADED_DOCUMENT",
  "MEDIA_ASSET",
  "CMS_CONTENT",
  "CRM_CLIENT",
  "CRM_LEAD",
  "PROJECT",
  "PRODUCT_CATALOG",
  "BILLING_RECORD",
  "MANUAL_ENTRY",
  "EXTERNAL_CONNECTOR"
]);
var createCollectionSchema = z32.object({
  name: z32.string().trim().min(1).max(200),
  description: z32.string().trim().max(2e3).optional(),
  accessPolicy: knowledgeAccessPolicySchema.optional(),
  allowedRoles: z32.array(z32.string().trim().min(1)).max(50).optional(),
  metadata: z32.record(z32.unknown()).optional()
});
var registerSourceSchema = z32.object({
  collectionId: z32.string().trim().uuid().optional(),
  name: z32.string().trim().min(1).max(200),
  sourceType: knowledgeSourceTypeSchema,
  entityType: z32.string().trim().max(100).optional(),
  entityId: z32.string().trim().max(200).optional(),
  config: z32.record(z32.unknown()).optional()
});
var listDocumentsQuerySchema = z32.object({
  collectionId: z32.string().trim().uuid().optional(),
  sourceId: z32.string().trim().uuid().optional(),
  status: z32.enum(["UPLOADED", "PROCESSING", "EXTRACTED", "CHUNKED", "INDEXING", "INDEXED", "FAILED", "ARCHIVED"]).optional()
});
var uploadDocumentSchema = z32.object({
  text: z32.string().max(2e6).optional(),
  contentBase64: z32.string().max(4e7).optional(),
  mimeType: z32.string().trim().max(100).optional(),
  filename: z32.string().trim().max(300).optional(),
  title: z32.string().trim().max(300).optional(),
  description: z32.string().trim().max(2e3).optional(),
  collectionId: z32.string().trim().uuid().optional(),
  sourceId: z32.string().trim().uuid().optional(),
  securityScope: z32.string().trim().max(100).optional(),
  requiredRole: z32.string().trim().max(100).optional(),
  metadata: z32.record(z32.unknown()).optional()
}).refine((v) => v.contentBase64 !== void 0 || v.text !== void 0, {
  message: "Either text or contentBase64 is required."
});
var searchKnowledgeSchema = z32.object({
  query: z32.string().trim().min(1).max(2e3),
  mode: z32.enum(["KEYWORD", "SEMANTIC", "HYBRID"]).optional(),
  limit: z32.coerce.number().int().positive().max(50).optional(),
  minScore: z32.coerce.number().min(0).max(1).optional(),
  filter: z32.record(z32.unknown()).optional()
});

// server/routes/v1/knowledgeRoutes.ts
var router38 = Router38();
router38.use(authenticateToken);
router38.get(
  "/collections",
  requirePermission("knowledge.read"),
  asyncHandler(async (req, res) => {
    const collections = await KnowledgeService.listCollections(req.user.organizationId);
    sendSuccess(res, { collections });
  })
);
router38.post(
  "/collections",
  requirePermission("knowledge.create"),
  asyncHandler(async (req, res) => {
    const input = createCollectionSchema.parse(req.body);
    const collection = await KnowledgeService.createCollection({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      ...input
    });
    sendSuccess(res, { collection }, 201);
  })
);
router38.get(
  "/collections/:id",
  requirePermission("knowledge.read"),
  asyncHandler(async (req, res) => {
    const collection = await KnowledgeService.getCollection(req.params.id, req.user.organizationId);
    sendSuccess(res, { collection });
  })
);
router38.post(
  "/sources",
  requirePermission("knowledge.create"),
  asyncHandler(async (req, res) => {
    const input = registerSourceSchema.parse(req.body);
    const source = await KnowledgeService.registerSource({
      organizationId: req.user.organizationId,
      ...input
    });
    sendSuccess(res, { source }, 201);
  })
);
router38.get(
  "/sources",
  requirePermission("knowledge.read"),
  asyncHandler(async (req, res) => {
    const sources = await prisma.knowledgeSource.findMany({
      where: { organizationId: req.user.organizationId, status: "ACTIVE" },
      include: {
        collection: true,
        _count: { select: { documents: true } }
      }
    });
    sendSuccess(res, { sources });
  })
);
router38.get(
  "/documents",
  requirePermission("knowledge.read"),
  asyncHandler(async (req, res) => {
    const { collectionId, sourceId, status } = listDocumentsQuerySchema.parse(req.query);
    const documents = await prisma.knowledgeDocument.findMany({
      where: {
        organizationId: req.user.organizationId,
        ...collectionId ? { collectionId } : {},
        ...sourceId ? { sourceId } : {},
        ...status ? { status } : {}
      },
      include: {
        collection: true,
        source: true,
        _count: { select: { chunks: true, versions: true } }
      },
      orderBy: { createdAt: "desc" }
    });
    sendSuccess(res, { documents });
  })
);
router38.get(
  "/documents/:id",
  requirePermission("knowledge.read"),
  asyncHandler(async (req, res) => {
    const document = await prisma.knowledgeDocument.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: {
        collection: true,
        source: true,
        versions: { orderBy: { version: "desc" } },
        ingestionJobs: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
    if (!document) {
      throw new NotFoundError(`Document "${req.params.id}" not found.`);
    }
    sendSuccess(res, { document });
  })
);
router38.post(
  "/documents/upload",
  requirePermission("knowledge.upload"),
  express3.json({ limit: "25mb" }),
  asyncHandler(async (req, res) => {
    const { text, contentBase64, mimeType, filename, title, description, collectionId, sourceId, securityScope, requiredRole, metadata } = uploadDocumentSchema.parse(req.body);
    let buffer;
    const finalMime = mimeType || "text/plain";
    if (contentBase64) {
      buffer = Buffer.from(contentBase64, "base64");
    } else if (text !== void 0 && text !== null) {
      buffer = Buffer.from(String(text), "utf8");
    } else {
      throw new ValidationError("Either text or contentBase64 is required.");
    }
    const result = await KnowledgeService.ingestDocument({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      collectionId,
      sourceId,
      title: title || filename || "Untitled Document",
      description,
      buffer,
      mimeType: finalMime,
      filename,
      securityScope,
      requiredRole,
      metadata: metadata || {}
    });
    sendSuccess(res, result, 201);
  })
);
router38.post(
  "/documents/:id/reindex",
  requirePermission("knowledge.reindex"),
  asyncHandler(async (req, res) => {
    const result = await KnowledgeService.reindexDocument(req.params.id, req.user.organizationId);
    sendSuccess(res, result);
  })
);
router38.post(
  "/search",
  requirePermission("knowledge.search"),
  asyncHandler(async (req, res) => {
    const { query, mode, limit, minScore, filter } = searchKnowledgeSchema.parse(req.body);
    const results = await KnowledgeService.search(
      {
        query,
        mode: mode || "HYBRID",
        limit: limit ?? 10,
        minScore: minScore ?? 0.15,
        filter
      },
      {
        organizationId: req.user.organizationId,
        userId: req.user.id,
        userPermissions: req.user.role.permissions || [],
        roleName: req.user.role.key
      }
    );
    sendSuccess(res, { results, count: results.length });
  })
);
var knowledgeRoutes_default = router38;

// server/routes/v1/copilotRoutes.ts
import { Router as Router39 } from "express";

// server/services/copilot/CopilotService.ts
import crypto12 from "crypto";
var SYSTEM_WORKSPACES = [
  {
    slug: "general-assistant",
    name: "General Enterprise Assistant",
    description: "Versatile corporate coworker for company policies, organizational knowledge, tasks, and high-level reports.",
    icon: "Bot",
    allowedTools: ["searchKnowledgeBase", "generateNaturalLanguageReport"],
    allowedModules: ["GENERAL", "KNOWLEDGE", "REPORTS"],
    requiredPermissions: ["copilot.use"],
    defaultMode: "ANSWER",
    temperature: 0.6,
    maxTokens: 2048,
    requireCitations: true,
    isDefault: true,
    systemInstruction: "You are the Artify Solutions General Enterprise Copilot. Provide accurate, professional, and well-grounded answers based on organizational knowledge. When knowledge is consulted, cite sources faithfully. Never invent business records."
  },
  {
    slug: "crm-assistant",
    name: "CRM & Client Intelligence Assistant",
    description: "Client management assistant for researching accounts, reviewing contacts, and managing leads.",
    icon: "Users",
    allowedTools: ["searchClients", "modifyClientStatus", "generateNaturalLanguageReport", "searchKnowledgeBase"],
    allowedModules: ["CRM", "CLIENTS", "LEADS"],
    requiredPermissions: ["copilot.use", "clients.read"],
    defaultMode: "ANSWER",
    temperature: 0.5,
    maxTokens: 2048,
    requireCitations: true,
    isDefault: false,
    systemInstruction: "You are the Artify CRM Assistant. Assist account executives and managers with client records, lead pipelines, and customer follow-ups. Consequential client status changes require explicit confirmation preview."
  },
  {
    slug: "billing-assistant",
    name: "Commercial & Billing Assistant",
    description: "Financial assistant for reviewing invoices, checking payment balances, and generating summaries.",
    icon: "Receipt",
    allowedTools: ["generateNaturalLanguageReport", "searchKnowledgeBase"],
    allowedModules: ["COMMERCIAL", "BILLING", "INVOICES"],
    requiredPermissions: ["copilot.use", "invoices.read"],
    defaultMode: "ANSWER",
    temperature: 0.3,
    maxTokens: 2048,
    requireCitations: true,
    isDefault: false,
    systemInstruction: "You are the Artify Billing & Commercial Assistant. Help users analyze invoice histories and locate overdue records. Never alter financial records or fabricate currency numbers."
  },
  {
    slug: "operations-assistant",
    name: "Operations & Workflows Assistant",
    description: "Autonomous operations assistant to inspect workflow pipelines, trigger verified automations, and track executions.",
    icon: "Workflow",
    allowedTools: ["executeWorkflow", "generateNaturalLanguageReport", "searchKnowledgeBase"],
    allowedModules: ["OPERATIONS", "AUTOMATION"],
    requiredPermissions: ["copilot.use", "automation.read"],
    defaultMode: "EXECUTE",
    temperature: 0.4,
    maxTokens: 2048,
    requireCitations: false,
    isDefault: false,
    systemInstruction: "You are the Artify Operations & Automation Assistant. Guide users through workflow execution, step telemetry, and approval status. Triggering workflows must provide complete parameters and preview."
  },
  {
    slug: "knowledge-assistant",
    name: "Document Intelligence & Knowledge Assistant",
    description: "Deep research and policy query specialist using semantic retrieval across corporate documents, manuals, and specifications.",
    icon: "Search",
    allowedTools: ["searchKnowledgeBase"],
    allowedModules: ["KNOWLEDGE"],
    requiredPermissions: ["copilot.use", "knowledge.read"],
    defaultMode: "EXPLAIN",
    temperature: 0.3,
    maxTokens: 2500,
    requireCitations: true,
    isDefault: false,
    systemInstruction: "You are the Artify Document Intelligence Specialist. Provide meticulous, evidence-grounded answers strictly based on retrieved enterprise documents. Always cite document name, section, and page."
  }
];
var userMessageRateMap = /* @__PURE__ */ new Map();
function checkRateLimit(userId) {
  const now = Date.now();
  const entry = userMessageRateMap.get(userId);
  if (!entry || now > entry.resetAt) {
    userMessageRateMap.set(userId, { count: 1, resetAt: now + 6e4 });
    return;
  }
  if (entry.count >= 35) {
    throw new ValidationError("Rate limit exceeded: You have sent too many messages in a short time. Please wait a minute.");
  }
  entry.count += 1;
}
async function generateReportSnapshot(organizationId, userQuery) {
  if (userQuery.includes("invoice") || userQuery.includes("bill") || userQuery.includes("overdue")) {
    const [total, overdue] = await Promise.all([
      prisma.invoice.count({ where: { organizationId } }),
      prisma.invoice.count({ where: { organizationId, status: "ISSUED", dueDate: { lt: /* @__PURE__ */ new Date() } } })
    ]);
    return { entity: "INVOICES", summary: `${total} invoice(s) total, ${overdue} currently overdue.` };
  }
  if (userQuery.includes("lead") || userQuery.includes("prospect")) {
    const total = await prisma.lead.count({ where: { organizationId } });
    return { entity: "LEADS", summary: `${total} lead(s) on file.` };
  }
  if (userQuery.includes("client") || userQuery.includes("account") || userQuery.includes("customer")) {
    const [total, active] = await Promise.all([
      prisma.client.count({ where: { organizationId } }),
      prisma.client.count({ where: { organizationId, status: "ACTIVE" } })
    ]);
    return { entity: "CLIENTS", summary: `${total} client(s) total, ${active} active.` };
  }
  return null;
}
var CopilotService = class {
  /**
   * Seed default system workspaces for an organization if not already seeded.
   */
  static async ensureDefaultWorkspaces(organizationId) {
    for (const ws of SYSTEM_WORKSPACES) {
      const existing = await prisma.copilotWorkspace.findFirst({
        where: { organizationId, slug: ws.slug }
      });
      if (!existing) {
        await prisma.copilotWorkspace.create({
          data: {
            organizationId,
            name: ws.name,
            slug: ws.slug,
            description: ws.description,
            icon: ws.icon,
            isSystem: true,
            isDefault: ws.isDefault,
            allowedTools: ws.allowedTools,
            allowedModules: ws.allowedModules,
            requiredPermissions: ws.requiredPermissions,
            systemInstruction: ws.systemInstruction,
            defaultMode: ws.defaultMode,
            temperature: ws.temperature,
            maxTokens: ws.maxTokens,
            requireCitations: ws.requireCitations
          }
        });
      }
    }
  }
  /** List workspaces accessible to the user based on RBAC permissions. */
  static async listWorkspaces(organizationId, userPermissions) {
    await this.ensureDefaultWorkspaces(organizationId);
    const workspaces = await prisma.copilotWorkspace.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }]
    });
    const isSuperAdmin = userPermissions.includes("*");
    return workspaces.filter((ws) => {
      if (isSuperAdmin) return true;
      const reqPerms = ws.requiredPermissions || [];
      if (reqPerms.length === 0) return true;
      return reqPerms.every((p) => userPermissions.includes(p));
    });
  }
  /** Get workspace by ID with permission check. */
  static async getWorkspace(id, organizationId, userPermissions) {
    const ws = await prisma.copilotWorkspace.findFirst({ where: { id, organizationId } });
    if (!ws) {
      throw new NotFoundError(`Workspace "${id}" not found.`);
    }
    const isSuperAdmin = userPermissions.includes("*");
    const reqPerms = ws.requiredPermissions || [];
    if (!isSuperAdmin && reqPerms.some((p) => !userPermissions.includes(p))) {
      throw new AuthorizationError(`You do not have the required permissions to access the "${ws.name}" workspace.`);
    }
    return ws;
  }
  /** Create custom workspace (requires copilot.manage). */
  static async createWorkspace(organizationId, userId, data) {
    const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const existing = await prisma.copilotWorkspace.findFirst({ where: { organizationId, slug } });
    if (existing) {
      throw new ValidationError(`Workspace with slug "${slug}" already exists in this organization.`);
    }
    return prisma.copilotWorkspace.create({
      data: {
        organizationId,
        createdById: userId,
        name: data.name,
        slug,
        description: data.description,
        icon: data.icon || "Bot",
        isSystem: false,
        isDefault: false,
        allowedTools: data.allowedTools || ["searchKnowledgeBase"],
        allowedModules: data.allowedModules || ["GENERAL"],
        requiredPermissions: data.requiredPermissions || ["copilot.use"],
        systemInstruction: data.systemInstruction,
        defaultMode: data.defaultMode || "ANSWER",
        temperature: data.temperature ?? 0.7,
        maxTokens: data.maxTokens ?? 2048,
        requireCitations: data.requireCitations ?? true
      }
    });
  }
  /** List conversations for a specific user and organization. */
  static async listConversations(organizationId, userId, filter) {
    const limit = filter.limit ? Math.min(filter.limit, 50) : 20;
    const offset = filter.offset || 0;
    const where = { organizationId, userId, status: filter.status || "ACTIVE" };
    if (filter.workspaceId) where.workspaceId = filter.workspaceId;
    if (filter.search) where.title = { contains: filter.search, mode: "insensitive" };
    const [conversations, total] = await Promise.all([
      prisma.copilotConversation.findMany({
        where,
        include: { workspace: { select: { id: true, name: true, slug: true, icon: true } } },
        orderBy: { lastMessageAt: "desc" },
        take: limit,
        skip: offset
      }),
      prisma.copilotConversation.count({ where })
    ]);
    return { conversations, total, limit, offset };
  }
  /** Get single conversation with message history and verification of ownership. */
  static async getConversation(conversationId, organizationId, userId) {
    const conv = await prisma.copilotConversation.findFirst({
      where: { id: conversationId, organizationId, userId },
      include: {
        workspace: true,
        messages: { orderBy: { createdAt: "asc" }, take: 50 },
        actionPreviews: { where: { status: "PENDING" }, orderBy: { createdAt: "desc" } }
      }
    });
    if (!conv) {
      throw new NotFoundError(`Conversation "${conversationId}" not found or unauthorized.`);
    }
    return conv;
  }
  /** Create new conversation. */
  static async createConversation(organizationId, userId, data) {
    let workspaceId = data.workspaceId;
    if (!workspaceId) {
      await this.ensureDefaultWorkspaces(organizationId);
      const defaultWs = await prisma.copilotWorkspace.findFirst({ where: { organizationId, isDefault: true } });
      workspaceId = defaultWs?.id;
    }
    if (!workspaceId) {
      throw new ValidationError("Workspace is required to start a conversation.");
    }
    const conversation = await prisma.copilotConversation.create({
      data: {
        organizationId,
        userId,
        workspaceId,
        title: data.title?.trim() || "New AI Conversation",
        contextMetadata: data.contextMetadata || {},
        lastMessageAt: /* @__PURE__ */ new Date()
      },
      include: { workspace: true }
    });
    await auditLogRepository.record({
      organizationId,
      actorUserId: userId,
      actorType: "USER",
      action: "COPILOT_CONVERSATION_CREATED",
      resourceType: "copilot_conversation",
      resourceId: conversation.id,
      metadata: { workspaceId, title: conversation.title }
    });
    return conversation;
  }
  /** Archive a conversation. */
  static async archiveConversation(conversationId, organizationId, userId) {
    const conv = await prisma.copilotConversation.findFirst({ where: { id: conversationId, organizationId, userId } });
    if (!conv) {
      throw new NotFoundError(`Conversation "${conversationId}" not found.`);
    }
    return prisma.copilotConversation.update({
      where: { id: conversationId },
      data: { status: "ARCHIVED", archivedAt: /* @__PURE__ */ new Date() }
    });
  }
  /** Delete a conversation. */
  static async deleteConversation(conversationId, organizationId, userId) {
    const conv = await prisma.copilotConversation.findFirst({ where: { id: conversationId, organizationId, userId } });
    if (!conv) {
      throw new NotFoundError(`Conversation "${conversationId}" not found.`);
    }
    await prisma.copilotConversation.delete({ where: { id: conversationId } });
    return { success: true, id: conversationId };
  }
  /**
   * Validate server-side user context (client ID, invoice ID, document ID).
   * Prevents browser entity spoofing.
   */
  static async validateEntityContext(organizationId, contextMetadata) {
    if (!contextMetadata || Object.keys(contextMetadata).length === 0) {
      return { validatedContext: {}, contextSummary: "" };
    }
    const validated = {};
    const summaryParts = [];
    if (contextMetadata.currentModule) {
      validated.currentModule = String(contextMetadata.currentModule);
      summaryParts.push(`Current Module: ${validated.currentModule}`);
    }
    if (contextMetadata.selectedClientId) {
      const client3 = await prisma.client.findFirst({ where: { id: String(contextMetadata.selectedClientId), organizationId, deletedAt: null } });
      if (client3) {
        validated.selectedClient = { id: client3.id, name: client3.name, code: client3.clientCode, status: client3.status };
        summaryParts.push(`Selected Client: ${client3.name} (${client3.clientCode}) [Status: ${client3.status}]`);
      }
    }
    if (contextMetadata.selectedInvoiceId) {
      const invoice = await prisma.invoice.findFirst({ where: { id: String(contextMetadata.selectedInvoiceId), organizationId } });
      if (invoice) {
        validated.selectedInvoice = { id: invoice.id, invoiceNumber: invoice.invoiceNumber, total: invoice.total.toString(), status: invoice.status };
        summaryParts.push(`Selected Invoice: #${invoice.invoiceNumber} [Total: ${invoice.total} ${invoice.currency}, Status: ${invoice.status}]`);
      }
    }
    if (contextMetadata.selectedDocumentId) {
      const doc = await prisma.knowledgeDocument.findFirst({ where: { id: String(contextMetadata.selectedDocumentId), organizationId } });
      if (doc) {
        validated.selectedDocument = { id: doc.id, title: doc.title, mimeType: doc.mimeType, activeVersion: doc.activeVersion };
        summaryParts.push(`Selected Document: "${doc.title}" (Version ${doc.activeVersion})`);
      }
    }
    if (contextMetadata.selectedWorkflowId) {
      const wf = await prisma.automationWorkflow.findFirst({ where: { id: String(contextMetadata.selectedWorkflowId), organizationId } });
      if (wf) {
        validated.selectedWorkflow = { id: wf.id, name: wf.name, status: wf.status };
        summaryParts.push(`Selected Workflow: "${wf.name}" [Status: ${wf.status}]`);
      }
    }
    return { validatedContext: validated, contextSummary: summaryParts.join("\n") };
  }
  /** Generates compact conversation memory summary for long chats (>= 10 messages). */
  static async compactConversationSummary(conversationId, existingSummary, earlierMessages) {
    if (earlierMessages.length === 0) return existingSummary || "";
    const transcript = earlierMessages.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 150)}`).join("\n");
    const summary = `Compact memory (updated ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}):
Previous discussion highlighted:
${transcript.slice(0, 600)}`;
    await prisma.copilotConversation.update({ where: { id: conversationId }, data: { summary } });
    return summary;
  }
  /**
   * Main conversational turn: processes user message, performs grounding,
   * evaluates tool requests, checks approvals, generates model response, and records audit.
   */
  static async sendMessage(userContext, options) {
    checkRateLimit(userContext.userId);
    const startTime = Date.now();
    const correlationId = `copilot-${crypto12.randomUUID()}`;
    let conversation;
    if (options.conversationId) {
      conversation = await prisma.copilotConversation.findFirst({
        where: { id: options.conversationId, organizationId: userContext.organizationId, userId: userContext.userId },
        include: { workspace: true }
      });
      if (!conversation) {
        throw new NotFoundError(`Conversation "${options.conversationId}" not found or unauthorized.`);
      }
    } else {
      conversation = await this.createConversation(userContext.organizationId, userContext.userId, {
        workspaceId: options.workspaceId,
        title: options.content.slice(0, 40) + "...",
        contextMetadata: options.contextMetadata
      });
    }
    const workspace = conversation.workspace;
    const isSuperAdmin = userContext.userPermissions.includes("*");
    const reqPerms = workspace.requiredPermissions || [];
    if (!isSuperAdmin && reqPerms.some((p) => !userContext.userPermissions.includes(p))) {
      throw new AuthorizationError(`You lack permission to use the "${workspace.name}" workspace.`);
    }
    const mergedContextMetadata = { ...conversation.contextMetadata, ...options.contextMetadata || {} };
    const { validatedContext, contextSummary } = await this.validateEntityContext(userContext.organizationId, mergedContextMetadata);
    const userMessage = await prisma.copilotMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: options.content.trim(),
        status: "COMPLETED",
        correlationId,
        metadata: { clientTimestamp: (/* @__PURE__ */ new Date()).toISOString(), context: validatedContext }
      }
    });
    if (conversation.title === "New AI Conversation" || conversation.title.endsWith("...")) {
      const newTitle = options.content.trim().slice(0, 45);
      await prisma.copilotConversation.update({ where: { id: conversation.id }, data: { title: newTitle } });
    }
    const allMessages = await prisma.copilotMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" }
    });
    let compactSummary = conversation.summary;
    if (allMessages.length > 12 && !compactSummary) {
      const earlier = allMessages.slice(0, allMessages.length - 8);
      compactSummary = await this.compactConversationSummary(conversation.id, compactSummary, earlier);
    }
    const recentHistory = allMessages.slice(-8);
    let citations = [];
    let groundedKnowledgeText = "";
    const userQuery = options.content.toLowerCase();
    const shouldSearchKnowledge = workspace.requireCitations || workspace.slug === "knowledge-assistant" || userQuery.includes("policy") || userQuery.includes("document") || userQuery.includes("guide") || userQuery.includes("agreement") || userQuery.includes("contract") || userQuery.includes("standard") || userQuery.includes("rule");
    if (shouldSearchKnowledge) {
      try {
        const groundedResult = await KnowledgeService.getGroundedContext(
          options.content,
          {
            organizationId: userContext.organizationId,
            userId: userContext.userId,
            userPermissions: userContext.userPermissions,
            roleName: userContext.roleName
          },
          { maxTokens: 1500 }
        );
        if (groundedResult.formattedContext) {
          groundedKnowledgeText = groundedResult.formattedContext;
          citations = groundedResult.citations;
        }
      } catch (kErr) {
        logger.warn({ kErr, correlationId }, "[CopilotService] Knowledge grounding retrieval non-fatal error");
      }
    }
    const allowedToolsList = workspace.allowedTools || [];
    let actionPreviewData = null;
    const toolExecutionResults = [];
    if (allowedToolsList.includes("modifyClientStatus") && (userQuery.includes("change status") || userQuery.includes("update status") || userQuery.includes("suspend client") || userQuery.includes("activate client"))) {
      const match = options.content.match(/[a-f0-9-]{36}/i);
      const targetClientId = match ? match[0] : validatedContext.selectedClient?.id;
      let newStatus = "ACTIVE";
      if (userQuery.includes("suspend")) newStatus = "SUSPENDED";
      if (userQuery.includes("archive")) newStatus = "ARCHIVED";
      if (targetClientId) {
        const client3 = await prisma.client.findFirst({ where: { id: targetClientId, organizationId: userContext.organizationId } });
        if (client3) {
          const preview = await prisma.copilotActionPreview.create({
            data: {
              organizationId: userContext.organizationId,
              conversationId: conversation.id,
              toolName: "modifyClientStatus",
              actionType: "MODIFY_CLIENT_STATUS",
              targetEntity: `${client3.name} (${client3.clientCode})`,
              changesSummary: `Change client status from "${client3.status}" to "${newStatus}".`,
              parameters: { clientId: client3.id, newStatus },
              riskLevel: "HIGH",
              reason: "User requested status modification in conversation.",
              requiresApproval: true,
              status: "PENDING"
            }
          });
          actionPreviewData = {
            id: preview.id,
            toolName: preview.toolName,
            actionType: preview.actionType,
            targetEntity: preview.targetEntity,
            changesSummary: preview.changesSummary,
            riskLevel: preview.riskLevel,
            status: preview.status,
            requiresApproval: preview.requiresApproval
          };
        }
      }
    }
    if (!actionPreviewData && allowedToolsList.includes("executeWorkflow") && (userQuery.includes("run workflow") || userQuery.includes("trigger workflow") || userQuery.includes("start workflow"))) {
      const wfIdMatch = options.content.match(/[a-f0-9-]{36}/i)?.[0] || validatedContext.selectedWorkflow?.id;
      if (wfIdMatch) {
        const wf = await prisma.automationWorkflow.findFirst({ where: { id: String(wfIdMatch), organizationId: userContext.organizationId } });
        if (wf) {
          const preview = await prisma.copilotActionPreview.create({
            data: {
              organizationId: userContext.organizationId,
              conversationId: conversation.id,
              toolName: "executeWorkflow",
              actionType: "EXECUTE_WORKFLOW",
              targetEntity: `Workflow: ${wf.name} (v${wf.currentVersion})`,
              changesSummary: `Trigger execution of workflow "${wf.name}" with manual trigger payload.`,
              parameters: { workflowId: wf.id },
              riskLevel: "HIGH",
              reason: "User requested workflow execution in conversation.",
              requiresApproval: true,
              status: "PENDING"
            }
          });
          actionPreviewData = {
            id: preview.id,
            toolName: preview.toolName,
            actionType: preview.actionType,
            targetEntity: preview.targetEntity,
            changesSummary: preview.changesSummary,
            riskLevel: preview.riskLevel,
            status: preview.status,
            requiresApproval: preview.requiresApproval
          };
        }
      }
    }
    if (!actionPreviewData) {
      if (allowedToolsList.includes("generateNaturalLanguageReport") && (userQuery.includes("report") || userQuery.includes("how many") || userQuery.includes("unpaid") || userQuery.includes("overdue") || userQuery.includes("breakdown") || userQuery.includes("statistics"))) {
        const report = await generateReportSnapshot(userContext.organizationId, userQuery);
        if (report) {
          toolExecutionResults.push({ tool: "generateNaturalLanguageReport", result: report });
        }
      }
      if (allowedToolsList.includes("searchClients") && (userQuery.includes("find client") || userQuery.includes("search client") || userQuery.includes("show client"))) {
        const queryTerm = options.content.replace(/find client|search client|show client/gi, "").trim();
        const { rows } = await clientService.listClients(userContext.organizationId, { search: queryTerm || void 0 }, 1, 5, "name", "asc");
        toolExecutionResults.push({ tool: "searchClients", result: { count: rows.length, clients: rows.map((c) => ({ id: c.id, name: c.name, code: c.clientCode, status: c.status })) } });
      }
    }
    const systemPrompt = `${workspace.systemInstruction || "You are an enterprise AI assistant."}
Response Mode: ${options.mode || workspace.defaultMode}
Active Workspace: ${workspace.name}
User Name: ${userContext.displayName || "Authorized Team Member"}

SECURITY AND INTEGRITY RULES:
1. Ground answers strictly in available verified context and tool results.
2. If sufficient data is not available, state clearly what cannot be determined. Do not speculate or invent numbers.
3. If an Action Preview was prepared, explain the exact proposed changes and instruct the user to Confirm or Cancel using the interactive preview below.
4. When citing documents, mention the document title and section clearly.`;
    let contextSection = "";
    if (contextSummary) contextSection += `
[VERIFIED APPLICATION CONTEXT]:
${contextSummary}
`;
    if (compactSummary) contextSection += `
[CONVERSATION MEMORY SUMMARY]:
${compactSummary}
`;
    if (groundedKnowledgeText) contextSection += `
${groundedKnowledgeText}
`;
    if (toolExecutionResults.length > 0) contextSection += `
[TOOL EXECUTION RESULTS]:
${JSON.stringify(toolExecutionResults, null, 2)}
`;
    if (actionPreviewData) {
      contextSection += `
[ACTION PREVIEW GENERATED (PENDING USER CONFIRMATION)]:
Action: ${actionPreviewData.actionType}
Target: ${actionPreviewData.targetEntity}
Summary: ${actionPreviewData.changesSummary}
Risk: ${actionPreviewData.riskLevel}
`;
    }
    const conversationHistoryText = recentHistory.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
    const fullPrompt = `${systemPrompt}

${contextSection}

${conversationHistoryText}

Assistant:`;
    let assistantResponseText = "";
    let tokenUsage = { inputTokens: Math.round(fullPrompt.length / 4), outputTokens: 120, totalTokens: Math.round(fullPrompt.length / 4) + 120 };
    let modelUsed = defaultAiProvider.defaultModel;
    try {
      const result = await defaultAiProvider.generateText(fullPrompt, {
        systemInstruction: systemPrompt,
        temperature: workspace.temperature,
        maxOutputTokens: workspace.maxTokens
      });
      assistantResponseText = result.text;
      modelUsed = result.model;
      if (result.usage) {
        tokenUsage = {
          inputTokens: result.usage.inputTokens ?? tokenUsage.inputTokens,
          outputTokens: result.usage.outputTokens ?? tokenUsage.outputTokens,
          totalTokens: result.usage.totalTokens ?? tokenUsage.totalTokens
        };
      }
    } catch (modelErr) {
      logger.warn({ modelErr, correlationId }, "[CopilotService] Provider generation fallback used");
      if (actionPreviewData) {
        assistantResponseText = `I have prepared the action preview for **${actionPreviewData.actionType}** on ${actionPreviewData.targetEntity}.

**Proposed Changes:** ${actionPreviewData.changesSummary}

Please review the details in the action card below and select **Confirm** or **Cancel** to proceed.`;
      } else if (toolExecutionResults.length > 0 && toolExecutionResults[0]) {
        const firstTool = toolExecutionResults[0];
        assistantResponseText = `I processed your request using **${firstTool.tool}**.

${JSON.stringify(firstTool.result, null, 2)}`;
      } else if (citations.length > 0 && citations[0]) {
        assistantResponseText = `Based on your enterprise knowledge base, I found relevant material in *${citations[0].documentTitle}*. See the context below for details.`;
      } else {
        assistantResponseText = `I have received your request regarding "${options.content}". How would you like me to assist with this in the ${workspace.name}?`;
      }
    }
    const durationMs = Date.now() - startTime;
    const estimatedCost = tokenUsage.inputTokens * 1e-6 + tokenUsage.outputTokens * 3e-6;
    const assistantMessage = await prisma.copilotMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: assistantResponseText,
        status: "COMPLETED",
        providerType: defaultAiProvider.code,
        modelName: modelUsed,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        durationMs,
        estimatedCost,
        correlationId,
        citations,
        toolCalls: toolExecutionResults,
        actionPreview: actionPreviewData,
        metadata: { workspaceId: workspace.id, workspaceSlug: workspace.slug, mode: options.mode || workspace.defaultMode }
      }
    });
    await prisma.copilotConversation.update({
      where: { id: conversation.id },
      data: { messageCount: { increment: 2 }, lastMessageAt: /* @__PURE__ */ new Date() }
    });
    await Promise.all([
      prisma.copilotUsage.create({
        data: {
          organizationId: userContext.organizationId,
          userId: userContext.userId,
          workspaceId: workspace.id,
          conversationId: conversation.id,
          messageId: assistantMessage.id,
          providerType: defaultAiProvider.code,
          modelName: modelUsed,
          inputTokens: tokenUsage.inputTokens,
          outputTokens: tokenUsage.outputTokens,
          totalTokens: tokenUsage.totalTokens,
          durationMs,
          estimatedCost,
          status: "SUCCESS"
        }
      }),
      auditLogRepository.record({
        organizationId: userContext.organizationId,
        actorUserId: userContext.userId,
        actorType: "USER",
        action: "COPILOT_MESSAGE_PROCESSED",
        resourceType: "copilot_conversation",
        resourceId: conversation.id,
        metadata: { workspace: workspace.slug, tokens: tokenUsage.totalTokens, citationsCount: citations.length, hasActionPreview: !!actionPreviewData, correlationId },
        requestId: correlationId
      })
    ]);
    return {
      conversationId: conversation.id,
      userMessage,
      assistantMessage,
      actionPreview: actionPreviewData,
      citations,
      toolResults: toolExecutionResults,
      correlationId
    };
  }
  /**
   * Confirm and execute a pending CopilotActionPreview. Dispatches locally
   * to the two action types this service itself ever creates a preview for
   * (modifyClientStatus, executeWorkflow) — this is Copilot's own bounded
   * approval mechanism, separate from (and no less strict than) the main
   * AI Control Center's governance dispatcher: both require an explicit
   * human decision before a HIGH-risk action runs.
   */
  static async confirmAction(actionPreviewId, userContext) {
    const preview = await prisma.copilotActionPreview.findFirst({
      where: { id: actionPreviewId, organizationId: userContext.organizationId },
      include: { conversation: true }
    });
    if (!preview) {
      throw new NotFoundError(`Action preview "${actionPreviewId}" not found.`);
    }
    if (preview.status !== "PENDING") {
      throw new ValidationError(`Action preview is already in "${preview.status}" status.`);
    }
    const requiredPermission = preview.toolName === "modifyClientStatus" ? "clients.update" : "automation.execute";
    const isSuperAdmin = userContext.userPermissions.includes("*");
    if (!isSuperAdmin && !userContext.userPermissions.includes(requiredPermission)) {
      throw new AuthorizationError(`Permission "${requiredPermission}" required to confirm and execute this action.`);
    }
    const correlationId = `copilot-action-${crypto12.randomUUID()}`;
    const params = preview.parameters || {};
    let executionResult;
    try {
      if (preview.toolName === "modifyClientStatus") {
        const user = await userRepository.findById(userContext.userId);
        const caller = user && await resolveSanitizedUserForOrganization(user, userContext.organizationId);
        if (!caller) throw new NotFoundError("Confirming user no longer has access to this organization.");
        const client3 = await clientService.updateClient(caller, String(params.clientId), { status: params.newStatus });
        executionResult = { clientId: client3.id, status: client3.status };
      } else if (preview.toolName === "executeWorkflow") {
        const enqueued = await workflowEngine.enqueueExecution({
          workflowId: String(params.workflowId),
          organizationId: userContext.organizationId,
          initiatedById: userContext.userId,
          triggerType: "MANUAL"
        });
        executionResult = await workflowEngine.execute(enqueued.executionId);
      } else {
        throw new ValidationError(`Action "${preview.toolName}" is not confirmable.`);
      }
    } catch (err) {
      await prisma.copilotActionPreview.update({
        where: { id: preview.id },
        data: { status: "FAILED", executionResult: { error: err.message }, confirmedById: userContext.userId, confirmedAt: /* @__PURE__ */ new Date() }
      });
      throw err;
    }
    const updatedPreview = await prisma.copilotActionPreview.update({
      where: { id: preview.id },
      data: { status: "EXECUTED", executionResult, confirmedById: userContext.userId, confirmedAt: /* @__PURE__ */ new Date() }
    });
    await prisma.copilotMessage.create({
      data: {
        conversationId: preview.conversationId,
        role: "assistant",
        content: `**Action Confirmed & Executed Successfully:** ${preview.changesSummary}

\`\`\`json
${JSON.stringify(executionResult, null, 2)}
\`\`\``,
        status: "COMPLETED",
        correlationId,
        metadata: { actionPreviewId: preview.id, executedBy: userContext.userId }
      }
    });
    await auditLogRepository.record({
      organizationId: userContext.organizationId,
      actorUserId: userContext.userId,
      actorType: "USER",
      action: "COPILOT_ACTION_CONFIRMED",
      resourceType: "copilot_action_preview",
      resourceId: preview.id,
      metadata: { toolName: preview.toolName, actionType: preview.actionType, targetEntity: preview.targetEntity, correlationId },
      requestId: correlationId
    });
    return { success: true, preview: updatedPreview, result: executionResult };
  }
  /** Reject a pending CopilotActionPreview. */
  static async rejectAction(actionPreviewId, userContext) {
    const preview = await prisma.copilotActionPreview.findFirst({ where: { id: actionPreviewId, organizationId: userContext.organizationId } });
    if (!preview) {
      throw new NotFoundError(`Action preview "${actionPreviewId}" not found.`);
    }
    if (preview.status !== "PENDING") {
      throw new ValidationError(`Action preview is already in "${preview.status}" status.`);
    }
    const updated = await prisma.copilotActionPreview.update({
      where: { id: actionPreviewId },
      data: { status: "REJECTED", confirmedById: userContext.userId, confirmedAt: /* @__PURE__ */ new Date() }
    });
    await prisma.copilotMessage.create({
      data: {
        conversationId: preview.conversationId,
        role: "assistant",
        content: `*Action cancelled by user:* The proposed action (${preview.actionType}) was declined. No changes were made.`,
        status: "COMPLETED",
        metadata: { actionPreviewId: preview.id, rejectedBy: userContext.userId }
      }
    });
    await auditLogRepository.record({
      organizationId: userContext.organizationId,
      actorUserId: userContext.userId,
      actorType: "USER",
      action: "COPILOT_ACTION_REJECTED",
      resourceType: "copilot_action_preview",
      resourceId: preview.id,
      metadata: { toolName: preview.toolName, actionType: preview.actionType }
    });
    return { success: true, preview: updated };
  }
  /** Real-time metrics for the Copilot section of the Control Center. */
  static async getDashboardStats(organizationId) {
    await this.ensureDefaultWorkspaces(organizationId);
    const [conversations, usages, pendingActions, executedActions, workspaces] = await Promise.all([
      prisma.copilotConversation.findMany({ where: { organizationId }, select: { id: true, status: true, workspaceId: true } }),
      prisma.copilotUsage.findMany({ where: { organizationId }, take: 200 }),
      prisma.copilotActionPreview.count({ where: { organizationId, status: "PENDING" } }),
      prisma.copilotActionPreview.count({ where: { organizationId, status: "EXECUTED" } }),
      prisma.copilotWorkspace.findMany({ where: { organizationId }, include: { _count: { select: { conversations: true } } } })
    ]);
    const activeConversations = conversations.filter((c) => c.status === "ACTIVE").length;
    const convIds = conversations.map((c) => c.id);
    const totalMessages = convIds.length > 0 ? await prisma.copilotMessage.count({ where: { conversationId: { in: convIds } } }) : 0;
    const totalTokens = usages.reduce((sum, u) => sum + u.totalTokens, 0);
    const totalCost = usages.reduce((sum, u) => sum + u.estimatedCost, 0);
    const successfulRequests = usages.filter((u) => u.status === "SUCCESS").length;
    const failedRequests = usages.filter((u) => u.status === "FAILED").length;
    const workspaceUsage = workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug, icon: w.icon, conversationsCount: w._count?.conversations || 0 })).sort((a, b) => b.conversationsCount - a.conversationsCount);
    return {
      activeConversations,
      totalMessages,
      totalRequests: usages.length,
      successfulRequests,
      failedRequests,
      pendingActions,
      executedActions,
      totalTokens,
      estimatedCost: Number(totalCost.toFixed(4)),
      mostUsedWorkspaces: workspaceUsage,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
};

// server/schemas/copilotSchemas.ts
import { z as z33 } from "zod";
var conversationModeSchema = z33.enum(["ANSWER", "EXPLAIN", "SUMMARIZE", "ANALYZE", "RECOMMEND", "DRAFT", "EXECUTE"]);
var createWorkspaceSchema = z33.object({
  name: z33.string().trim().min(1).max(200),
  slug: z33.string().trim().min(1).max(150).regex(/^[a-z0-9-]+$/, "slug must be lowercase, URL-safe (letters, numbers, hyphens)").optional(),
  description: z33.string().trim().max(2e3).optional(),
  icon: z33.string().trim().max(100).optional(),
  allowedTools: z33.array(z33.string().trim().min(1)).max(100).optional(),
  allowedModules: z33.array(z33.string().trim().min(1)).max(100).optional(),
  requiredPermissions: z33.array(z33.string().trim().min(1)).max(100).optional(),
  systemInstruction: z33.string().trim().max(1e4).optional(),
  defaultMode: conversationModeSchema.optional(),
  temperature: z33.coerce.number().min(0).max(2).optional(),
  maxTokens: z33.coerce.number().int().positive().max(32e3).optional(),
  requireCitations: z33.coerce.boolean().optional()
});
var createConversationSchema = z33.object({
  workspaceId: z33.string().trim().uuid().optional(),
  title: z33.string().trim().max(300).optional(),
  contextMetadata: z33.record(z33.unknown()).optional()
});
var listConversationsQuerySchema = z33.object({
  workspaceId: z33.string().trim().uuid().optional(),
  status: z33.string().trim().max(50).optional(),
  search: z33.string().trim().max(300).optional(),
  limit: z33.coerce.number().int().positive().max(100).optional(),
  offset: z33.coerce.number().int().nonnegative().optional()
});
var contextMetadataSchema = z33.object({
  currentModule: z33.string().trim().max(200).optional(),
  currentPage: z33.string().trim().max(200).optional(),
  selectedClientId: z33.string().trim().uuid().optional(),
  selectedInvoiceId: z33.string().trim().uuid().optional(),
  selectedDocumentId: z33.string().trim().uuid().optional(),
  selectedWorkflowId: z33.string().trim().uuid().optional()
}).catchall(z33.unknown()).optional();
var sendMessageSchema = z33.object({
  conversationId: z33.string().trim().uuid().optional(),
  workspaceId: z33.string().trim().uuid().optional(),
  content: z33.string().trim().min(1).max(2e4),
  mode: conversationModeSchema.optional(),
  contextMetadata: contextMetadataSchema
});

// server/routes/v1/copilotRoutes.ts
var router39 = Router39();
router39.use(authenticateToken);
router39.get(
  "/workspaces",
  asyncHandler(async (req, res) => {
    const permissions = req.user.role.permissions || [];
    const workspaces = await CopilotService.listWorkspaces(req.user.organizationId, permissions);
    sendSuccess(res, { workspaces });
  })
);
router39.post(
  "/workspaces",
  requirePermission("copilot.manage"),
  asyncHandler(async (req, res) => {
    const input = createWorkspaceSchema.parse(req.body);
    const workspace = await CopilotService.createWorkspace(req.user.organizationId, req.user.id, input);
    sendSuccess(res, { workspace }, 201);
  })
);
router39.get(
  "/workspaces/:id",
  asyncHandler(async (req, res) => {
    const permissions = req.user.role.permissions || [];
    const workspace = await CopilotService.getWorkspace(req.params.id, req.user.organizationId, permissions);
    sendSuccess(res, { workspace });
  })
);
router39.get(
  "/conversations",
  requirePermission("copilot.read"),
  asyncHandler(async (req, res) => {
    const query = listConversationsQuerySchema.parse(req.query);
    const result = await CopilotService.listConversations(req.user.organizationId, req.user.id, {
      workspaceId: query.workspaceId,
      status: query.status,
      search: query.search,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0
    });
    sendSuccess(res, result);
  })
);
router39.post(
  "/conversations",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const input = createConversationSchema.parse(req.body);
    const conversation = await CopilotService.createConversation(req.user.organizationId, req.user.id, input);
    sendSuccess(res, { conversation }, 201);
  })
);
router39.get(
  "/conversations/:id",
  requirePermission("copilot.read"),
  asyncHandler(async (req, res) => {
    const conversation = await CopilotService.getConversation(req.params.id, req.user.organizationId, req.user.id);
    sendSuccess(res, { conversation });
  })
);
router39.post(
  "/conversations/:id/archive",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const updated = await CopilotService.archiveConversation(req.params.id, req.user.organizationId, req.user.id);
    sendSuccess(res, { conversation: updated });
  })
);
router39.delete(
  "/conversations/:id",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const result = await CopilotService.deleteConversation(req.params.id, req.user.organizationId, req.user.id);
    sendSuccess(res, result);
  })
);
router39.post(
  "/messages",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const permissions = req.user.role.permissions || [];
    const input = sendMessageSchema.parse(req.body);
    const result = await CopilotService.sendMessage(
      {
        organizationId: req.user.organizationId,
        userId: req.user.id,
        userPermissions: permissions,
        displayName: req.user.email?.split("@")[0] || "User"
      },
      input
    );
    sendSuccess(res, result);
  })
);
router39.post(
  "/messages/stream",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const permissions = req.user.role.permissions || [];
    const input = sendMessageSchema.parse(req.body);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const sendEvent = (event, data) => {
      res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
    };
    sendEvent("start", { status: "PROCESSING" });
    try {
      const result = await CopilotService.sendMessage(
        {
          organizationId: req.user.organizationId,
          userId: req.user.id,
          userPermissions: permissions,
          displayName: req.user.email?.split("@")[0] || "User"
        },
        input
      );
      if (result.citations && result.citations.length > 0) {
        sendEvent("citations", result.citations);
      }
      if (result.toolResults && result.toolResults.length > 0) {
        sendEvent("tool_calls", result.toolResults);
      }
      if (result.actionPreview) {
        sendEvent("action_preview", result.actionPreview);
      }
      const fullText = result.assistantMessage.content;
      const words = fullText.split(" ");
      for (let i = 0; i < words.length; i += 3) {
        const chunk = words.slice(i, i + 3).join(" ") + (i + 3 < words.length ? " " : "");
        sendEvent("chunk", { text: chunk });
      }
      sendEvent("done", {
        conversationId: result.conversationId,
        messageId: result.assistantMessage.id,
        correlationId: result.correlationId
      });
      res.end();
    } catch (error) {
      sendEvent("error", { error: error.message });
      res.end();
    }
  })
);
router39.post(
  "/actions/:id/confirm",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const permissions = req.user.role.permissions || [];
    const result = await CopilotService.confirmAction(req.params.id, {
      organizationId: req.user.organizationId,
      userId: req.user.id,
      userPermissions: permissions
    });
    sendSuccess(res, result);
  })
);
router39.post(
  "/actions/:id/reject",
  requirePermission("copilot.use"),
  asyncHandler(async (req, res) => {
    const permissions = req.user.role.permissions || [];
    const result = await CopilotService.rejectAction(req.params.id, {
      organizationId: req.user.organizationId,
      userId: req.user.id,
      userPermissions: permissions
    });
    sendSuccess(res, result);
  })
);
router39.get(
  "/dashboard",
  requirePermission("copilot.read"),
  asyncHandler(async (req, res) => {
    const stats = await CopilotService.getDashboardStats(req.user.organizationId);
    sendSuccess(res, stats);
  })
);
var copilotRoutes_default = router39;

// server/routes/v1/index.ts
var v1Router = Router40();
v1Router.use("/auth", authRoutes_default);
v1Router.use("/webhooks", webhookRoutes_default);
v1Router.use("/system", systemRoutes_default);
v1Router.use("/users", userRoutes_default);
v1Router.use("/roles", roleRoutes_default);
v1Router.use("/permissions", permissionsRouter);
v1Router.use("/organizations", organizationRoutes_default);
v1Router.use("/audit-logs", auditLogRoutes_default);
v1Router.use("/settings", settingsRoutes_default);
v1Router.use("/leads", leadRoutes_default);
v1Router.use("/clients", clientRoutes_default);
v1Router.use("/contacts", contactRoutes_default);
v1Router.use("/crm", crmRoutes_default);
v1Router.use("/onboarding", onboardingRoutes_default);
v1Router.use("/workspaces", workspaceRoutes_default);
v1Router.use("/invitations", invitationRoutes_default);
v1Router.use("/products", productRoutes_default);
v1Router.use("/product-modules", productModuleRoutes_default);
v1Router.use("/pages", pageRoutes_default);
v1Router.use("/posts", postRoutes_default);
v1Router.use("/categories", categoryRoutes_default);
v1Router.use("/tags", tagRoutes_default);
v1Router.use("/authors", authorRoutes_default);
v1Router.use("/media", mediaRoutes_default);
v1Router.use("/contracts", contractRoutes_default);
v1Router.use("/subscriptions", subscriptionRoutes_default);
v1Router.use("/invoices", invoiceRoutes_default);
v1Router.use("/payments", paymentRoutes_default);
v1Router.use("/portal", portalRoutes_default);
v1Router.use("/public", publicRoutes_default);
v1Router.use("/ai/providers", aiProviderRoutes_default);
v1Router.use("/ai/tools", aiToolRoutes_default);
v1Router.use("/ai/prompts", aiPromptRoutes_default);
v1Router.use("/ai/workflows", aiWorkflowRoutes_default);
v1Router.use("/ai/executions", aiExecutionRoutes_default);
v1Router.use("/ai/usage", aiUsageRoutes_default);
v1Router.use("/ai/approvals", aiApprovalRoutes_default);
v1Router.use("/automation", automationRoutes_default);
v1Router.use("/knowledge", knowledgeRoutes_default);
v1Router.use("/copilot", copilotRoutes_default);
var v1_default = v1Router;

// server/app/app.ts
function createApp() {
  const app2 = express4();
  app2.use(requestIdMiddleware);
  applySecurityMiddleware(app2);
  app2.use(requestLogger);
  app2.use("/api", generalApiLimiter);
  app2.use("/api/v1", v1_default);
  return app2;
}
function finalizeApp(app2) {
  app2.use("/api", notFoundHandler);
  app2.use(errorHandlerMiddleware);
}

// server/vercelHandler.ts
var app = createApp();
finalizeApp(app);
var vercelHandler_default = app;
export {
  vercelHandler_default as default
};
