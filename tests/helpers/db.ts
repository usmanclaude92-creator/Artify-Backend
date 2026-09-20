/**
 * Test-only database reset helper. Only ever points at a database/schema
 * whose connection string is distinctly marked as test data (tests/setup.ts
 * loads .env.test before this or any server/ module is imported — see that
 * file for which distinguishing marker is currently in use: a separate
 * `artify_test` database name for local Postgres, or a `?schema=test`
 * query param when pointed at a shared hosted instance). Dev data must
 * never share the exact same marker.
 *
 * Wipes tenant/transactional data only (organizations and everything that
 * hangs off them) — NOT roles/permissions/role_permissions, which are
 * reference/configuration data seeded once by tests/setup.ts
 * (seedRolesAndPermissions), matching how a real deployment treats its
 * role/permission catalog as stable configuration, not per-test fixture
 * data. If a test creates its own extra reference-data rows (e.g. a new
 * Permission to prove role_permissions is data-driven), that test is
 * responsible for cleaning up after itself — resetDb() intentionally does
 * not touch the permissions/roles tables at all.
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

  // Break the pages/posts <-> content_revisions cycle (Page.currentRevisionId
  // and Post.currentRevisionId each point INTO content_revisions, which in
  // turn points back via pageId/postId) before deleting either side.
  await prisma.page.updateMany({ data: { currentRevisionId: null } });
  await prisma.post.updateMany({ data: { currentRevisionId: null } });

  // Delete in FK-dependency order, leaves first. organization_memberships
  // and sessions cascade automatically when their user/organization is
  // deleted (schema-level ON DELETE CASCADE), but are listed explicitly
  // for clarity and to avoid relying on delete order across unrelated
  // cascade paths.
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.subscriptionItem.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.contract.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.client.deleteMany();
  await prisma.lead.deleteMany();

  await prisma.contentRevision.deleteMany();
  await prisma.postTag.deleteMany();
  await prisma.post.deleteMany();
  await prisma.page.deleteMany();
  await prisma.category.deleteMany();
  await prisma.tag.deleteMany();

  await prisma.mediaAsset.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.systemSetting.deleteMany();

  await prisma.webhookEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.organizationMembership.deleteMany();
  await prisma.author.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
}
