/**
 * Prisma client singleton with connection pooling (managed by Prisma's
 * built-in pool over DATABASE_URL) and graceful shutdown. See
 * docs/DATABASE_DESIGN.md §2 "Connection pooling".
 */
import { PrismaClient } from "@prisma/client";
import { config } from "../config/env";
import { logger } from "../core/logger";

export const prisma = new PrismaClient({
  datasourceUrl: config.databaseUrl,
  log: config.nodeEnv === "development" ? ["warn", "error"] : ["error"],
});

let shuttingDown = false;

export async function disconnectPrisma(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await prisma.$disconnect();
    logger.info({ event: "db_disconnected" }, "Prisma client disconnected");
  } catch (err) {
    logger.error({ err, event: "db_disconnect_error" }, "Error disconnecting Prisma client");
  }
}
