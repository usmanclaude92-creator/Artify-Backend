/**
 * Authentication/authorization middleware. Ported from the Phase 0 audit's
 * artifysolscom/server/services/authService.ts middleware chain
 * (docs/AUTHORIZATION_MODEL.md §2 — REUSE, this design was sound), now
 * backed by real Postgres sessions instead of an in-memory Map.
 *
 * Important scope note (docs/AUTHORIZATION_MODEL.md §3.1): these functions
 * confirm a caller is authenticated and holds a permission/role. They do
 * NOT by themselves confirm the caller owns the specific record being
 * acted on — every route that mutates a single resource by ID must
 * additionally call `enforceTenantIsolation` (or an equivalent per-record
 * ownership check) once the record's companyId is known. This is the exact
 * gap Phase 0 found in several artifysolscom/server/v1 routes; the
 * middleware exists here so Phase 3+ route authors have no excuse to skip it.
 */
import type { NextFunction, Request, Response } from "express";
import { authService } from "../services/authService";
import { AuthenticationError, AuthorizationError, TenantIsolationError } from "../core/errors";
import type { PermissionKey, RoleName } from "../types/domain";
import { asyncHandler } from "../utils/asyncHandler";

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }
  return undefined;
}

export const authenticateToken = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
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
  req.companyId = user.companyId;
  next();
});

export const optionalAuthenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearerToken(req);
  if (token) {
    const user = await authService.verifySession(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
      req.companyId = user.companyId;
    }
  }
  next();
});

export function requirePermission(permission: PermissionKey) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new AuthenticationError();
    if (req.user.role === "SUPER_ADMINISTRATOR") return next();
    if (!req.user.permissions.includes(permission)) {
      throw new AuthorizationError(`Permission denied. Required privilege: "${permission}"`);
    }
    next();
  };
}

export function requireRole(allowedRoles: RoleName[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new AuthenticationError();
    if (req.user.role === "SUPER_ADMINISTRATOR" || allowedRoles.includes(req.user.role)) {
      return next();
    }
    throw new AuthorizationError(`Forbidden. Requires one of: ${allowedRoles.join(", ")}`);
  };
}

/**
 * Rejects a request whose target companyId (param/query/body) doesn't
 * match the caller's own — the tenant-boundary check every single-record
 * route must apply (see the module doc comment above).
 */
export function enforceTenantIsolation(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw new AuthenticationError();
  if (req.user.role === "SUPER_ADMINISTRATOR") return next();

  const requested =
    (req.params.companyId as string | undefined) ??
    (req.query.companyId as string | undefined) ??
    (req.body as Record<string, unknown> | undefined)?.companyId;

  if (typeof requested === "string" && requested !== req.user.companyId) {
    throw new TenantIsolationError();
  }
  next();
}

/**
 * Generic per-record ownership guard: loads a record's companyId via
 * `loadCompanyId` and rejects the request if it doesn't match the caller's
 * tenant. Use this on every route that takes a resource :id, once real
 * business resources exist (Phase 4+) — this is the concrete fix for the
 * horizontal-privilege-escalation gap documented in
 * docs/AUTHORIZATION_MODEL.md §3.1.
 */
export function enforceRecordOwnership(loadCompanyId: (req: Request) => Promise<string | null>) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AuthenticationError();
    if (req.user.role === "SUPER_ADMINISTRATOR") return next();

    const recordCompanyId = await loadCompanyId(req);
    if (recordCompanyId === null) return next(); // route's own NotFoundError should fire next
    if (recordCompanyId !== req.user.companyId) {
      throw new TenantIsolationError();
    }
    next();
  });
}
