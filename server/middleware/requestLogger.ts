/**
 * Structured per-request access logging via pino-http. Emits one log line
 * per request with requestId/route/method/statusCode/duration (Phase 1
 * §13/§14), replacing ad-hoc console.log in request paths.
 */
import pinoHttp from "pino-http";
import type { Request } from "express";
import { logger } from "../core/logger";

/** Path segments and query values that carry a credential (invitation, landing preview, reset/verify tokens) never reach the logs. */
export function redactUrl(url: string): string {
  const [path = "", query] = url.split("?");
  const safePath = path
    .replace(/(\/invitations\/)[^/]+/i, "$1[REDACTED]")
    .replace(/(\/landing-preview\/)[^/]+/i, "$1[REDACTED]")
    .replace(/(\/lp-preview\/)[^/]+/i, "$1[REDACTED]");
  if (!query) return safePath;
  const params = new URLSearchParams(query);
  for (const k of [...params.keys()]) if (/token|code|key|secret|password|signature|hub\.verify_token/i.test(k)) params.set(k, "[REDACTED]");
  return `${safePath}?${params.toString()}`;
}

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req: Request) => req.requestId,
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customProps: (req: Request) => ({
    actorId: req.user?.id,
    organizationId: req.organizationId,
  }),
  serializers: {
    req: (req) => ({ method: req.method, url: redactUrl(req.url) }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
