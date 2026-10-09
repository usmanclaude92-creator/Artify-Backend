# QA: sidebar role × page matrix (Step 14)

Generated from `NAV_ITEMS` (`src/lib/permissions.ts`) and the role → permission rows of the seeded catalogue. ✔ = item shown in the sidebar and the page opens; — = hidden in the sidebar, and a typed URL shows the *Access denied* page (`AppShell`). The API enforces the same permission: `tests/integration/qaRoleMatrix.test.ts` probes one endpoint per permission the sidebar uses, for all six roles and an anonymous caller.

Dashboard, Notifications and Security (own sessions/MFA) need no permission. CLIENT_PORTAL is the external client role: it sees only those three plus Client Portal, and `/dashboard` shows it a pointer to the portal instead of workspace numbers.

81 items in 10 sections.

## Dashboard

| Page | Path | Needs | SUPER_ADMIN | ADMIN | MANAGER | USER | VIEWER | CLIENT_PORTAL |
|---|---|---|---|---|---|---|---|---|
| dashboard | `/dashboard` | any signed-in user | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| my-work | `/my-work` | automation.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| notification-center | `/notifications` | any signed-in user | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| approvals | `/approvals` | approvals.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| analytics-dashboard | `/analytics` | analytics.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| analytics-reports | `/reports` | reports.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |

## Administration

| Page | Path | Needs | SUPER_ADMIN | ADMIN | MANAGER | USER | VIEWER | CLIENT_PORTAL |
|---|---|---|---|---|---|---|---|---|
| administration | `/administration` | security.read | ✔ | ✔ | — | — | — | — |
| users | `/users` | users.read | ✔ | ✔ | ✔ | — | ✔ | — |
| roles | `/roles` | roles.read | ✔ | ✔ | — | — | ✔ | — |
| permissions | `/permissions` | roles.read | ✔ | ✔ | — | — | ✔ | — |
| organizations | `/organizations` | organizations.read | ✔ | ✔ | — | — | ✔ | — |
| audit-log | `/audit-log` | audit.read | ✔ | ✔ | — | — | ✔ | — |
| security | `/security` | any signed-in user | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| security-center | `/security-center` | security.read | ✔ | ✔ | — | — | — | — |
| ops-health | `/system-health` | ops.health.read | ✔ | ✔ | — | — | — | — |
| ops-reports | `/scheduled-reports` | reports.manage | ✔ | ✔ | — | — | — | — |
| ops-backups | `/backups` | ops.backups.read | ✔ | ✔ | — | — | — | — |
| privacy | `/privacy` | privacy.read | ✔ | ✔ | — | — | — | — |
| integrations | `/integrations` | integrations.read,webhooks.read,api_keys.read | ✔ | ✔ | — | — | — | — |
| settings | `/settings` | settings.read | ✔ | ✔ | — | — | ✔ | — |
| workspaces-all | `/workspaces` | workspaces.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| workspaces-members | `/workspaces/members` | workspaces.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |

## CRM

| Page | Path | Needs | SUPER_ADMIN | ADMIN | MANAGER | USER | VIEWER | CLIENT_PORTAL |
|---|---|---|---|---|---|---|---|---|
| crm-dashboard | `/crm` | leads.read,clients.read,opportunities.read,onboarding.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| crm-leads | `/crm/leads` | leads.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| crm-clients | `/crm/clients` | clients.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| crm-contacts | `/crm/contacts` | contacts.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| crm-opportunities | `/crm/opportunities` | opportunities.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| onboarding-overview | `/onboarding` | onboarding.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| onboarding-pending | `/onboarding/pending` | onboarding.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| marketing-forms | `/marketing/forms` | forms.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |

## Catalog

| Page | Path | Needs | SUPER_ADMIN | ADMIN | MANAGER | USER | VIEWER | CLIENT_PORTAL |
|---|---|---|---|---|---|---|---|---|
| products-all | `/products` | products.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| products-modules | `/products/modules` | product_modules.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| services-all | `/services` | products.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| solutions-all | `/solutions` | products.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| products-taxonomy | `/products/taxonomy` | product_categories.read,industries.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |

## Website Management

| Page | Path | Needs | SUPER_ADMIN | ADMIN | MANAGER | USER | VIEWER | CLIENT_PORTAL |
|---|---|---|---|---|---|---|---|---|
| website-templates | `/website/templates` | templates.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| website-template-parts | `/website/template-parts` | template_parts.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| website-navigation-menus | `/website/navigation-menus` | navigation_menus.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| website-homepage | `/website/homepage` | content.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| website-site-identity | `/website/site-identity` | settings.read | ✔ | ✔ | — | — | ✔ | — |
| website-global-styles | `/website/global-styles` | settings.read | ✔ | ✔ | — | — | ✔ | — |
| website-site-editor | `/website/site-editor` | content.update | ✔ | ✔ | ✔ | — | — | — |
| cms-pages | `/cms/pages` | content.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| cms-posts | `/cms/posts` | content.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| cms-case-studies | `/cms/case-studies` | content.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| cms-taxonomy | `/cms/taxonomy` | content.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| cms-authors | `/cms/authors` | authors.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| cms-media | `/cms/media` | media.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| seo-issues | `/seo/issues` | seo.audit.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| seo-redirects | `/seo/redirects` | seo.redirects.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |

## Marketing

| Page | Path | Needs | SUPER_ADMIN | ADMIN | MANAGER | USER | VIEWER | CLIENT_PORTAL |
|---|---|---|---|---|---|---|---|---|
| marketing-dashboard | `/marketing` | campaigns.read,leads.read,forms.read,opportunities.read,clients.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| marketing-campaigns | `/marketing/campaigns` | campaigns.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| marketing-landing-pages | `/marketing/landing-pages` | marketing.landing.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |

## Automation & AI

| Page | Path | Needs | SUPER_ADMIN | ADMIN | MANAGER | USER | VIEWER | CLIENT_PORTAL |
|---|---|---|---|---|---|---|---|---|
| automation | `/automation` | automation.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| ai-overview | `/ai` | ai.executions.read,ai.approvals.read,ai.usage.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| ai-providers | `/ai/providers` | ai.providers.read | ✔ | ✔ | ✔ | — | ✔ | — |
| ai-tools | `/ai/tools` | ai.tools.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| ai-prompts | `/ai/prompts` | ai.prompts.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| ai-workflows | `/ai/workflows` | ai.workflows.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| ai-executions | `/ai/executions` | ai.executions.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| ai-usage | `/ai/usage` | ai.usage.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| ai-approvals | `/ai/approvals` | ai.approvals.read | ✔ | ✔ | ✔ | — | ✔ | — |
| ai-copilot | `/ai/copilot` | copilot.read,copilot.use | ✔ | ✔ | ✔ | ✔ | ✔ | — |

## Commercial

| Page | Path | Needs | SUPER_ADMIN | ADMIN | MANAGER | USER | VIEWER | CLIENT_PORTAL |
|---|---|---|---|---|---|---|---|---|
| commercial-contracts | `/commercial/contracts` | contracts.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| commercial-subscriptions | `/commercial/subscriptions` | subscriptions.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| commercial-invoices | `/commercial/invoices` | invoices.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| commercial-payments | `/commercial/payments` | payments.read | ✔ | ✔ | ✔ | ✔ | ✔ | — |

## Client Portal

| Page | Path | Needs | SUPER_ADMIN | ADMIN | MANAGER | USER | VIEWER | CLIENT_PORTAL |
|---|---|---|---|---|---|---|---|---|
| client-portal | `/portal` | portal.dashboard.read | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

## Social Media

| Page | Path | Needs | SUPER_ADMIN | ADMIN | MANAGER | USER | VIEWER | CLIENT_PORTAL |
|---|---|---|---|---|---|---|---|---|
| social-overview | `/social` | social.read | ✔ | ✔ | ✔ | — | ✔ | — |
| social-calendar | `/social/calendar` | social.read | ✔ | ✔ | ✔ | — | ✔ | — |
| social-posts | `/social/posts` | social.read | ✔ | ✔ | ✔ | — | ✔ | — |
| social-compose | `/social/compose` | social.publish | ✔ | ✔ | — | — | — | — |
| social-inbox | `/social/inbox` | social.read | ✔ | ✔ | ✔ | — | ✔ | — |
| social-listening | `/social/listening` | social.listening.read | ✔ | ✔ | ✔ | — | ✔ | — |
| social-reviews | `/social/reviews` | social.listening.read | ✔ | ✔ | ✔ | — | ✔ | — |
| social-queue | `/social/queue` | social.read | ✔ | ✔ | ✔ | — | ✔ | — |
| social-failures | `/social/failures` | social.read | ✔ | ✔ | ✔ | — | ✔ | — |
| social-analytics | `/social/analytics` | social.analytics.read | ✔ | ✔ | — | — | — | — |
| social-audience | `/social/audience` | social.analytics.read | ✔ | ✔ | — | — | — | — |
| social-brand-voice | `/social/brand-voice` | social.read | ✔ | ✔ | ✔ | — | ✔ | — |
| social-accounts | `/social/accounts` | social.read | ✔ | ✔ | ✔ | — | ✔ | — |

## Totals

| Role | Pages visible (of 81) |
|---|---|
| SUPER_ADMIN | 81 |
| ADMIN | 81 |
| MANAGER | 64 |
| USER | 50 |
| VIEWER | 70 |
| CLIENT_PORTAL | 4 |
