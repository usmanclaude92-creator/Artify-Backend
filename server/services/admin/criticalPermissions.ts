/**
 * Permissions that grant control over security, credentials or the RBAC
 * system itself. They are never grantable to an API key, and a custom role
 * can only receive them with an explicit confirmation by a SUPER_ADMIN.
 */
export const CRITICAL_PERMISSIONS: readonly string[] = [
  "roles.create",
  "roles.update",
  "roles.delete",
  "roles.assign",
  "users.delete",
  "organizations.delete",
  "settings.manage",
  "security.manage",
  "integrations.manage",
  "webhooks.manage",
  "api_keys.manage",
];
