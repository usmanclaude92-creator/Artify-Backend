/**
 * Authenticates a machine caller with an API key (Phase 17). Deliberately a
 * separate middleware from `authenticateToken` — session auth is unchanged,
 * and an API key can only reach routes that opt in with `requireApiKeyScope`.
 */
import type { NextFunction, Request, Response } from "express";
import { apiKeyService } from "../services/admin/apiKeyService";
import { AuthenticationError, AuthorizationError } from "../core/errors";
import { asyncHandler } from "../utils/asyncHandler";

export const authenticateApiKey = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  const presented = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const key = presented ? await apiKeyService.verify(presented, req.ip) : null;
  if (!key) throw new AuthenticationError("Invalid, expired or revoked API key.");
  req.apiKey = { id: key.id, organizationId: key.organizationId, scopes: key.scopes };
  next();
});

export function requireApiKeyScope(scope: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.apiKey) throw new AuthenticationError();
    if (!req.apiKey.scopes.includes(scope)) throw new AuthorizationError(`API key lacks the required scope: "${scope}"`);
    next();
  };
}
