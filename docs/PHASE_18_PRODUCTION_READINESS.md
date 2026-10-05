# Phase 18 — AI Control Center, Final QA, Production Readiness

## AI behaviour (honesty rules)
- Provider credentials live only in server env (`AI_PROVIDER=gemini`, `GEMINI_API_KEY`). They are never returned by any API; `GET /api/v1/ai/health` reports booleans/labels only.
- "Configured" means credentials are present. Connectivity is **not probed**; provider errors surface on the first real request.
- With no provider: `AdapterFactory` throws a 503 outside `NODE_ENV=test` (the mock adapter is test-only); Copilot replies with an explicit notice, stores the message as `FAILED` with 0 tokens / 0 cost; workflow AI steps fail; knowledge search degrades to keyword-only and ingestion stores chunks without embeddings.
- Token/cost accounting uses only provider-reported usage. Provider calls time out after `AI_REQUEST_TIMEOUT_MS` (default 30000).
- Copilot read tools check per-entity permissions (`clients.read`, `leads.read`, `invoices.read`); write tools still require preview + `clients.update` / `automation.execute` on confirm. Workflow knowledge retrieval uses the initiating user's real permissions (none for unattributed runs).

## New surface
- `GET /api/v1/ai/health` (`ai.usage.read`): provider state, capabilities, catalog, 30d usage, limits, recent activity/errors, knowledge status (org-scoped).
- `PUT /api/v1/ai/limits` (`ai.providers.manage`): daily request/token caps (0 = unlimited) in `system_settings` key `ai.limits`; audited (`AI_LIMITS_UPDATED`); enforced for Copilot and workflow AI steps (429).
- Control Center → AI Overview shows the health panel.
- No database migration in Phase 18.

## Production configuration required
`DATABASE_URL`, `SESSION_SECRET` (≥32 chars), `CORS_ORIGINS`, `WEBHOOK_SECRET`, `PUBLIC_WEBSITE_ORGANIZATION_ID`, `PLATFORM_API_BASE_URL` (site), optionally `INTEGRATIONS_ENCRYPTION_KEY`, `AI_PROVIDER`, `GEMINI_API_KEY`, `AI_REQUEST_TIMEOUT_MS`.

## Deployment
Rebuild `api/index.mjs` (`npm run build:vercel-api`) and commit it whenever server code changes; trigger Vercel deployment manually if the GitHub hook doesn't fire; verify `cc.artifysols.com` points at the new deployment.

## Known limitations
- Only the Gemini adapter is implemented (OpenAI/Anthropic catalog rows are metadata only).
- Copilot rate limit (35/min/user) is in-memory per serverless instance.
- Supabase pooler connection limit 5 can cause transient 500s under bursts.
- Workflow `BUSINESS_ACTION` steps still run actions with system permissions behind the approval gate.
- Authenticated production smoke tests need a real admin login and were not performed from this environment.
