-- social.analytics.read stays admin-only (SUPER_ADMIN, ADMIN): revoke the grants the 20261016090000 migration gave to other roles.
-- Idempotent: deleting rows that are already gone is a no-op.
DELETE FROM "role_permissions"
WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "key" = 'social.analytics.read')
  AND "role_id" IN (SELECT "id" FROM "roles" WHERE "key" NOT IN ('SUPER_ADMIN', 'ADMIN'));
