-- CreateEnum
CREATE TYPE "NavigationMenuType" AS ENUM ('PRIMARY', 'HEADER', 'FOOTER', 'MOBILE', 'CUSTOM');

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "parent_id" TEXT;

-- CreateTable
CREATE TABLE "navigation_menus" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "NavigationMenuType" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "current_revision_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "navigation_menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "navigation_menu_revisions" (
    "id" TEXT NOT NULL,
    "navigation_menu_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "navigation_menu_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "navigation_menus_current_revision_id_key" ON "navigation_menus"("current_revision_id");

-- CreateIndex
CREATE INDEX "navigation_menus_organization_id_status_idx" ON "navigation_menus"("organization_id", "status");

-- CreateIndex
CREATE INDEX "navigation_menus_organization_id_type_idx" ON "navigation_menus"("organization_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "navigation_menus_organization_id_slug_key" ON "navigation_menus"("organization_id", "slug");

-- CreateIndex
CREATE INDEX "navigation_menu_revisions_navigation_menu_id_idx" ON "navigation_menu_revisions"("navigation_menu_id");

-- CreateIndex
CREATE INDEX "pages_parent_id_idx" ON "pages"("parent_id");

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "navigation_menus" ADD CONSTRAINT "navigation_menus_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "navigation_menus" ADD CONSTRAINT "navigation_menus_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "navigation_menus" ADD CONSTRAINT "navigation_menus_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "navigation_menu_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "navigation_menu_revisions" ADD CONSTRAINT "navigation_menu_revisions_navigation_menu_id_fkey" FOREIGN KEY ("navigation_menu_id") REFERENCES "navigation_menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "navigation_menu_revisions" ADD CONSTRAINT "navigation_menu_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
