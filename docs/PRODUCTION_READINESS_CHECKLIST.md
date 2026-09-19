# Production Readiness Checklist

Not to be signed off until every box is genuinely true — this audit found that existing documentation (`ARCHITECTURE.md`, `metadata.json`'s "production-ready" framing) had asserted readiness the code does not back up. This checklist exists to prevent that recurring.

## Data
- [ ] Every entity has a real, migrated Postgres table (no `localStorage`, no in-memory array, no `seedData.ts` as a runtime source).
- [ ] Backups enabled and a restore has been tested at least once.
- [ ] Migrations are version-controlled and run automatically pre-deploy.

## Authentication & Authorization
- [ ] No client-side-only authentication path exists in any shipped build.
- [ ] Passwords hashed with bcrypt/argon2, never a fast unsalted hash.
- [ ] Every mutation route enforces both a permission check and a per-record tenant/ownership check.
- [ ] Login is rate-limited; password reset exists and is tested.
- [ ] Automated tests cover horizontal and vertical privilege escalation attempts and all pass (reject).

## API & Web security
- [ ] CORS allow-list configured (no wildcard `*` in production).
- [ ] Rate limiting active on public and authenticated endpoints.
- [ ] Security headers (CSP, HSTS, X-Frame-Options, etc.) present on every response.
- [ ] Webhook signatures verified with a timing-safe HMAC comparison; missing signature is rejected, not accepted.
- [ ] No secret has an insecure hardcoded fallback anywhere in source; the app fails to boot without required secrets set.
- [ ] Input validation (zod or equivalent) on every route accepting a body/query/params.
- [ ] Centralized error handler never leaks stack traces to clients in production.

## Observability
- [ ] Health check endpoint performs a real dependency check (DB ping, not a hardcoded "connected").
- [ ] Structured logging with request IDs; PII fields redacted.
- [ ] Error tracking (e.g. Sentry) wired in.
- [ ] Alerting on health-check failures and elevated error rates.

## Testing & CI
- [ ] Unit, integration, API, and E2E suites all running in CI and required to pass before merge.
- [ ] `npm audit`/Dependabot gate active.
- [ ] All critical business workflows in `TESTING_STRATEGY.md` §4 have passing automated coverage.

## Deployment
- [ ] Staging environment exists and mirrors production configuration.
- [ ] Rollback procedure documented and tested.
- [ ] Both repos' deploy targets (Vercel/Railway) use one consistent server entrypoint each, with no drifted duplicate logic.

## Product-level honesty
- [ ] No UI text or documentation claims "production-ready," "SOC2," "99.9% uptime," etc. unless independently verified true — several such claims exist today only as hardcoded demo copy (e.g. `seedData.ts` audit-trail claims, `/api/health` fabricated database status) and must not migrate into real user-facing claims without substantiation.
- [ ] All "demo mode" affordances (role switcher, instant fake login) are unreachable in the production build.
