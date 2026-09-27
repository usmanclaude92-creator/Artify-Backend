-- CreateTable
CREATE TABLE "redirects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "from_path" TEXT NOT NULL,
    "to_path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL DEFAULT 301,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "redirects_organization_id_idx" ON "redirects"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "redirects_organization_id_from_path_key" ON "redirects"("organization_id", "from_path");

-- AddForeignKey
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
