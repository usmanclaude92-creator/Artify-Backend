/**
 * Artify Platform API + Control Center bootstrap.
 *
 * This file replaces the Phase 0 prototype's server.ts (737 lines of
 * unauthenticated demo routes — /api/ai/generate, /api/audit-logs,
 * /api/webhooks/* with the inverted signature check, /api/leads,
 * /api/notifications/dispatch — all superseded by server/routes/v1/*).
 * See docs/PHASE_1_COMPLETION_REPORT.md for the full before/after.
 *
 * Fail-fast: importing server/config/env.ts validates the environment and
 * calls process.exit(1) before this file does anything else if required
 * configuration is missing or a known-compromised secret is reused.
 */
import path from "node:path";
import express from "express";
import { config } from "./server/config/env";
import { createApp, finalizeApp } from "./server/app/app";
import { logger } from "./server/core/logger";
import { prisma, disconnectPrisma } from "./server/db/prisma";

async function startServer(): Promise<void> {
  const app = createApp();

  if (config.nodeEnv !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  finalizeApp(app);

  // Fail fast on an unreachable database too — an app that "starts" but
  // can never serve a real request is worse than one that doesn't start.
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info({ event: "db_connected" }, "Database connection verified");
  } catch (err) {
    logger.fatal({ err, event: "db_connect_failed" }, "Could not reach the database at startup. Refusing to start.");
    process.exit(1);
  }

  const server = app.listen(config.port, "0.0.0.0", () => {
    logger.info({ event: "server_started", port: config.port, environment: config.nodeEnv }, "Artify Platform API listening");
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ event: "shutdown_start", signal }, "Received shutdown signal, closing gracefully");
    server.close(async (err) => {
      if (err) {
        logger.error({ err, event: "shutdown_error" }, "Error while closing HTTP server");
      }
      await disconnectPrisma();
      process.exit(err ? 1 : 0);
    });

    // Force-exit if graceful close hangs (e.g. a stuck keep-alive connection).
    setTimeout(() => {
      logger.warn({ event: "shutdown_forced" }, "Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

startServer().catch((err) => {
  logger.fatal({ err, event: "startup_failed" }, "Server failed to start");
  process.exit(1);
});
