/**
 * Liveness vs. readiness (Phase 1 §10). Fixes Phase 0 finding S9: the old
 * /api/health always reported `"database": "connected"` with no database
 * in existence. Readiness now performs a real query with a bounded
 * timeout and never exposes the connection string or a raw driver error.
 */
import { Router } from "express";
import { checkDatabase } from "../../db/health";
import { sendSuccess } from "../../core/apiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { config } from "../../config/env";

const router = Router();

/** Liveness: is the process up and able to handle a request at all. */
router.get("/live", (_req, res) => {
  sendSuccess(res, { status: "alive", timestamp: new Date().toISOString() });
});

/** Readiness: can the process reach the infrastructure it needs to serve traffic. */
router.get(
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
        timestamp: new Date().toISOString(),
      },
      healthy ? 200 : 503
    );
  })
);

export default router;
