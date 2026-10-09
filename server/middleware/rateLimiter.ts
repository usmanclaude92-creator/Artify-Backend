/**
 * Rate limiting foundation (Phase 1 §15, fixes part of S6). Two profiles:
 * a general API limiter and a strict one for auth endpoints (brute-force /
 * credential-stuffing protection — docs/SECURITY_MODEL.md target
 * architecture, "Authentication" section).
 *
 * Store: when config.redisUrl is set, every limiter below shares one Redis
 * connection via rate-limit-redis (each limiter uses its own `prefix` so
 * their counters never collide) — this is what actually enforces limits
 * correctly on a serverless deployment (Vercel), where the default
 * per-process MemoryStore does not persist across instances. Left unset,
 * every limiter below falls back to that in-memory store (fine for local
 * dev/single-instance, not for serverless production — see env.ts's
 * REDIS_URL doc comment, which warns at boot).
 */
import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { RedisStore } from "rate-limit-redis";
import Redis from "ioredis";
import { sendError, ApiErrorCode } from "../core/apiResponse";
import { config } from "../config/env";
import { logger } from "../core/logger";

const redisClient = config.redisUrl
  ? new Redis(config.redisUrl, {
      // Rate limiting must never block a request waiting on Redis to
      // reconnect — express-rate-limit's `passOnStoreError` (set per
      // limiter below) lets the request through if the store throws, but
      // a fast-failing client gets there sooner than ioredis's default
      // unbounded retry backoff.
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      lazyConnect: false,
    })
  : null;

redisClient?.on("error", (err) => {
  logger.error({ err }, "[rateLimiter] Redis connection error — limits fall back to allowing the request through");
});

function makeStore(prefix: string): RedisStore | undefined {
  if (!redisClient) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    // ioredis's `call` overload requires its first parameter typed as a
    // literal `command: string`, not part of a spread array — spreading a
    // plain `string[]` into it fails TS2556 ("must have a tuple type").
    // Splitting the command out fixes the typing without changing the
    // actual command dispatched (rate-limit-redis always calls this with
    // at least one element).
    sendCommand: (...args: string[]) => redisClient.call(args[0]!, ...args.slice(1)) as Promise<never>,
  });
}

function rateLimitHandler(req: Request, res: Response): void {
  sendError(res, 429, ApiErrorCode.RATE_LIMIT_EXCEEDED, "Too many requests. Please try again later.");
}

export const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("general"),
  passOnStoreError: true,
});

/** Applied to /auth/login and /auth/register only. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("auth"),
  passOnStoreError: true,
  // Key by IP + attempted email so one IP can't lock out unrelated accounts,
  // while still throttling both credential stuffing and single-account brute force.
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "unknown";
    return `${req.ip ?? "unknown-ip"}:${email}`;
  },
});

/** Public client-portal registration — a hard per-IP cap on new accounts, independent of the email used. */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("register"),
  passOnStoreError: true,
  keyGenerator: (req: Request) => req.ip ?? "unknown-ip",
});

/** Email-verification confirm/resend. */
export const verificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("verification"),
  passOnStoreError: true,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "unknown";
    return `${req.ip ?? "unknown-ip"}:${email}`;
  },
});

export const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("webhook"),
  passOnStoreError: true,
});

/** Meta deauthorize / data-deletion callbacks and the public deletion-status lookup (Step 15). Anonymous, IP-keyed. */
export const metaCallbackLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("meta-callback"),
  passOnStoreError: true,
});

/** Password-reset request/confirm — prevents token-guessing and reset-spam against a single account, keyed the same way as authLimiter. */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("password-reset"),
  passOnStoreError: true,
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "unknown";
    return `${req.ip ?? "unknown-ip"}:${email}`;
  },
});

/** Public website lead intake (Phase 11 §8) — anonymous, so keyed by IP only; tight enough to blunt spam/scraping without blocking a genuine visitor who submits more than once. */
export const publicLeadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("public-lead"),
  passOnStoreError: true,
  keyGenerator: (req: Request) => req.ip ?? "unknown-ip",
});

/** Step 13 — public token-bearing links (invitation preview/accept, landing preview): a stricter per-IP budget than the general limiter so a link token can never be probed at volume. */
export const tokenLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("token-link"),
  passOnStoreError: true,
  keyGenerator: (req: Request) => req.ip ?? "unknown-ip",
});

/** Phase 15 — public website analytics event ingestion (docs/ANALYTICS_ARCHITECTURE.md). Anonymous, IP-keyed like publicLeadLimiter, but far more generous: a page-view beacon fires on every route change rather than a deliberate form submission. */
export const publicAnalyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("public-analytics"),
  passOnStoreError: true,
  keyGenerator: (req: Request) => req.ip ?? "unknown-ip",
});

/** Authenticated sensitive actions (change-password, organization switch) — lower volume than general API traffic, keyed per-caller. */
export const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("sensitive-action"),
  passOnStoreError: true,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? "unknown",
});

/** Phase 12 — AI tool-call/workflow execution (docs/AI_GOVERNANCE.md). Tighter than general API traffic: each call can reach an external AI provider or mutate real data, keyed per-caller so one noisy user can't exhaust another's budget. */
export const aiExecutionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  store: makeStore("ai-execution"),
  passOnStoreError: true,
  keyGenerator: (req: Request) => req.user?.id ?? req.ip ?? "unknown",
});
