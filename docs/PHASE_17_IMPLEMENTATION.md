# Phase 17 — Security, Administration & Integrations

Extends the existing identity/RBAC/audit/automation systems; nothing was rebuilt.

## Permissions
New keys (all seeded; `SUPER_ADMIN` holds every key): `security.read`, `security.manage`,
`integrations.read`, `integrations.manage`, `webhooks.read`, `webhooks.manage`,
`api_keys.read`, `api_keys.manage`. `ADMIN` receives the four `*.read` keys only; manage keys
are granted deliberately (custom role) rather than by default.

## Administration & security
| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /admin/overview` | `security.read` | Real org-scoped counts only |
| `GET /admin/security/policy` | `security.read` | Read-only effective policy; no secrets |
| `GET /admin/security/events` | `security.read` | Audit feed filtered to security actions, with severity |
| `GET /admin/sessions`, `POST /admin/sessions/:id/revoke` | `security.read` / `security.manage` | Org-scoped; never returns tokens/hashes |
| `GET /users/:id/sessions` | `users.read` + `security.read` | |
| `POST /users/:id/revoke-sessions`, `POST /users/:id/unlock` | `users.update` | Rate limited; audited |
| `POST /auth/sessions/revoke-others` | authenticated | Keeps the current session |

Hardening added to existing flows: an admin cannot deactivate themselves; only a `SUPER_ADMIN` can
modify a `SUPER_ADMIN` account; **no caller can assign a role holding permissions they do not hold**
(user create/update and organization membership add/update); `SUPER_ADMIN` is never assignable via API;
the cron tick secret is compared in constant time.

## Roles
Roles are platform-global rows, so custom-role management (`POST/PATCH/PUT/DELETE /roles…`) is
`SUPER_ADMIN`-only. System roles are immutable; a role in use cannot be deleted; permissions that
control security/RBAC (`server/services/admin/criticalPermissions.ts`) need explicit confirmation;
every change is audited with a before/after permission diff. Per-organization roles would need an
`organizationId` on `roles` — intentionally not done in this phase.

## Audit log
`GET /audit-logs` gains `q`, `severity`, `actorType`, `resourceId`; `GET /audit-logs/:id` (detail,
org-scoped) and `GET /audit-logs/facets`. Severity is derived (`critical` = RBAC/credential changes,
`warning` = failures/lockouts, else `info`). There is still no update/delete path; the repository
keeps its single `record` method. DB-level immutability (revoking UPDATE/DELETE from the app role)
requires a separate privileged database role and remains a deployment step.

## Integrations, webhooks, API keys
- **Integrations** (`/integrations`): *system* services (Gemini, storage, Redis, cron, inbound webhook,
  public site) are reported from deployment configuration as configured/not configured with real
  last-activity timestamps — never "connected" without verification. *Configurable* providers
  (currently `custom_api`) store a credential encrypted with AES-256-GCM (`server/utils/secretBox.ts`);
  `VERIFIED` only after a real successful test; any credential/target change resets verification.
- **Outbound webhooks** (`/webhook-endpoints`): subscribes to the existing `EventEngine`, so the event
  catalog is exactly what the platform emits. Signed `X-Artify-Signature: sha256=HMAC(secret, "<ts>.<body>")`,
  SSRF-guarded (HTTPS-only in production, private/link-local/metadata ranges blocked, re-checked at
  delivery, redirects not followed), 5 attempts with backoff driven by the automation cron tick,
  delivery log, manual retry, secret rotation.
- **API keys** (`/api-keys`, consumed at `/external/*`): `artify_ak_<256-bit>`, shown once, stored as
  SHA-256, scoped to permissions the creator holds (never administrative ones), expiring (≤ 365 days),
  revocable, `lastUsedAt` tracked. Keys authenticate **only** `/external/*` (currently `GET /external/whoami`).

## Secrets handling
Plaintext secrets are returned exactly once (`Cache-Control: no-store`), never logged or audited,
never present in list/detail responses; only `secretLast4` is shown. Key material:
`INTEGRATIONS_ENCRYPTION_KEY` (≥ 32 chars, optional). If unset, the key is HKDF-derived from
`SESSION_SECRET` — functional, but rotating the session secret would then make stored credentials
unreadable; set a dedicated key to decouple them.

## Migration
`20261005100000_phase17_admin_security_integrations` — additive: `integrations`, `webhook_endpoints`,
`webhook_deliveries`, `api_keys` + enums. No existing table is altered or dropped.
