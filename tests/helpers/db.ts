/**
 * Test-only database reset helper. Only ever points at a database/schema
 * whose connection string is distinctly marked as test data (tests/setup.ts
 * loads .env.test before this or any server/ module is imported — see that
 * file for which distinguishing marker is currently in use: a separate
 * `artify_test` database name for local Postgres, or a `?schema=test`
 * query param when pointed at a shared hosted instance). Dev data must
 * never share the exact same marker.
 */
import { prisma } from "../../server/db/prisma";
import { config } from "../../server/config/env";

function assertTestDatabase(): void {
  if (config.nodeEnv !== "test" || !config.databaseUrl.includes("test")) {
    throw new Error(
      "Refusing to reset a database that doesn't look like the dedicated test DB. " +
        "Expected NODE_ENV=test and a DATABASE_URL containing 'test' (see .env.test)."
    );
  }
}

export async function resetDb(): Promise<void> {
  assertTestDatabase();
  // Delete in FK-dependency order (children before parents).
  await prisma.webhookEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
}
