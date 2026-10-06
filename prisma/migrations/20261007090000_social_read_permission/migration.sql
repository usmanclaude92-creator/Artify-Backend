-- social.read: gates the Social Media placeholder page (Step 1 sidebar redesign). Idempotent; granted to the admin roles.
INSERT INTO "permissions" ("id", "key", "name", "module", "created_at")
SELECT gen_random_uuid()::text, 'social.read', 'Social: Read', 'social', NOW()
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "key" = 'social.read');

INSERT INTO "role_permissions" ("id", "role_id", "permission_id")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'social.read'
WHERE r."key" IN ('SUPER_ADMIN', 'ADMIN')
  AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id");
