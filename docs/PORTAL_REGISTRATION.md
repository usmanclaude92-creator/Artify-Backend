# Client portal sign-in & registration

## Flow
1. `POST /api/v1/auth/portal/register` (public site) — creates a TRIAL organization + user with the **CLIENT_PORTAL** role (read-only `portal.*` permissions, no Control Center administration).
2. With email configured: no session is issued; a verification email is sent. The response is identical whether or not the address already exists (the existing owner gets an "account already exists" email instead).
3. `POST /api/v1/auth/verify-email` confirms the address (single use, 48 h). Sign-in is refused (`EMAIL_NOT_VERIFIED`, only after a correct password) until then.
4. Operators see the account under **Workspaces → Pending client portal registrations** (and get an in-app notification) and either **link it to a CRM client** (activates the portal) or **reject** it (suspends the organization, ends sessions).
5. Password reset (`/auth/password-reset/request` + `/confirm`) is delivered by email; following the link also verifies the address.

## Protections
Per-IP registration cap (5/hour), per-IP+email auth throttling and account lockout, honeypot field, optional Cloudflare Turnstile, password policy (min length, not numeric, not common, must not contain the email name), single-use hashed tokens, generic responses, audit events (`AUTH_PORTAL_REGISTERED`, `AUTH_EMAIL_VERIFIED`, `PORTAL_REGISTRATION_LINKED/REJECTED`).
The legacy `POST /auth/register` (creates an organization **administrator**) is disabled in production unless `ALLOW_ADMIN_SELF_REGISTRATION=true`.

## Configuration (backend / Vercel `controlcenter`)
| Variable | Purpose |
|---|---|
| `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` | Enables email delivery + the verification gate. Without them the system runs in **degraded mode**: immediate sign-in after registration, duplicate emails return 409, and password reset cannot be delivered in production. |
| `PUBLIC_SITE_BASE_URL=https://artifysols.com` | Base of the links in emails (`/verify-email`, `/reset-password`). |
| `TURNSTILE_SECRET_KEY` | Enforces Turnstile on register / reset / resend. Pair with `VITE_TURNSTILE_SITE_KEY` on the site project. |
| `REDIS_URL` | Shares rate-limit counters across serverless instances (strongly recommended). |
| `ALLOW_ADMIN_SELF_REGISTRATION` | Leave unset/false in production. |

DNS for the sending domain (SPF, DKIM, DMARC) must be configured at the email provider before going live.
