/**
 * Minimal local-dev seed: one company + one Super Administrator, so a
 * freshly migrated database has something to log in as. Intentionally
 * does NOT seed products/leads/articles/subscriptions/etc. — that's
 * business data belonging to Phase 2+ once those tables exist; seeding it
 * here would just be re-creating the Phase 0 prototype's hardcoded
 * seedData.ts problem one layer down.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@artifysols.local";
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD must be set to seed a local admin account " +
        '(e.g. SEED_ADMIN_PASSWORD="ChangeMe123!" npm run db:seed) — no default password is hardcoded here.'
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Seed skipped: ${email} already exists.`);
    return;
  }

  const company = await prisma.company.create({
    data: {
      name: "Artify Solutions HQ",
      slug: "artify-solutions",
      industry: "Enterprise AI & Automation Software",
      tier: "ENTERPRISE",
      status: "ACTIVE",
      domain: "artifysols.com",
    },
  });

  const passwordHash = await bcrypt.hash(password, 12);

  const allPermissions = [
    "users.read",
    "users.create",
    "users.update",
    "users.delete",
    "clients.read",
    "clients.create",
    "clients.update",
    "content.read",
    "content.create",
    "content.publish",
    "products.read",
    "products.manage",
    "billing.read",
    "billing.manage",
    "leads.read",
    "leads.manage",
    "ai.agents.read",
    "ai.agents.execute",
    "ai.agents.configure",
    "ai.tasks.read",
    "ai.tasks.approve",
    "notifications.send",
    "audit.read",
    "settings.manage",
    "company.manage",
  ];

  await prisma.user.create({
    data: {
      companyId: company.id,
      email,
      passwordHash,
      fullName: "Super Administrator",
      title: "Super Administrator",
      role: "SUPER_ADMINISTRATOR",
      permissions: allPermissions,
    },
  });

  console.log(`Seeded ${email} as Super Administrator of "${company.name}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
