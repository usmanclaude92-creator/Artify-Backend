-- approvals.read: front door of the global Approvals center (Step 2 redesign). Additive and idempotent.
-- Granted to every role that already holds at least one approval-source read permission; the center still
-- enforces each source's own permission, so this widens nothing the caller could not already see.
INSERT INTO "permissions" ("id", "key", "name", "module", "created_at")
SELECT gen_random_uuid()::text, 'approvals.read', 'Approvals: Read', 'approvals', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'approvals.read');

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, r."id", np."id"
FROM "roles" r
JOIN "permissions" np ON np."key" = 'approvals.read'
WHERE r."key" <> 'CLIENT_PORTAL'
  AND EXISTS (
    SELECT 1 FROM "role_permissions" rp
    JOIN "permissions" p ON p."id" = rp."permission_id"
    WHERE rp."role_id" = r."id" AND p."key" IN ('ai.approvals.read', 'automation.read', 'content.update')
  )
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" x WHERE x."role_id" = r."id" AND x."permission_id" = np."id");
