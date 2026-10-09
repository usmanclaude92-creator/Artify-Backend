/**
 * Artify Platform API v1 — canonical namespace (Phase 1 §11).
 * Phase 3 adds the identity/RBAC management surface (users, roles,
 * permissions, organizations/memberships — docs/RBAC_IMPLEMENTATION.md).
 * Phase 5 adds CRM (leads, clients, contacts — docs/CRM_ARCHITECTURE.md).
 * Phase 6 adds client onboarding + workspace provisioning (onboarding,
 * workspaces, invitations — docs/CLIENT_ONBOARDING_ARCHITECTURE.md,
 * docs/WORKSPACE_PROVISIONING.md).
 * Phase 7 adds the product/service catalog (products, product-modules —
 * docs/PRODUCT_CATALOG_ARCHITECTURE.md, docs/PRODUCT_MODULE_ARCHITECTURE.md).
 * Phase 8 adds the CMS (pages, posts, categories, tags —
 * docs/CMS_ARCHITECTURE.md).
 * Phase 9 adds the media library (media — docs/MEDIA_ARCHITECTURE.md).
 * Phase 10 adds commercial/billing (contracts, subscriptions, invoices,
 * payments) and the read-only client portal (portal —
 * docs/COMMERCIAL_ARCHITECTURE.md, docs/BILLING_ARCHITECTURE.md,
 * docs/CLIENT_PORTAL_ARCHITECTURE.md).
 * Phase 12 adds the AI Control Center (ai/providers, ai/tools, ai/prompts,
 * ai/workflows, ai/executions, ai/usage, ai/approvals —
 * docs/AI_ARCHITECTURE.md, docs/AI_GOVERNANCE.md).
 */
import { Router } from "express";
import authRoutes from "./authRoutes";
import webhookRoutes from "./webhookRoutes";
import systemRoutes from "./systemRoutes";
import userRoutes from "./userRoutes";
import roleRoutes, { permissionsRouter } from "./roleRoutes";
import organizationRoutes from "./organizationRoutes";
import auditLogRoutes from "./auditLogRoutes";
import settingsRoutes from "./settingsRoutes";
import siteSettingsRoutes from "./siteSettingsRoutes";
import leadRoutes from "./leadRoutes";
import clientRoutes from "./clientRoutes";
import contactRoutes from "./contactRoutes";
import opportunityRoutes from "./opportunityRoutes";
import notificationRoutes from "./notificationRoutes";
import approvalCenterRoutes from "./approvalCenterRoutes";
import navRoutes from "./navRoutes";
import { socialAccountsRouter } from "./socialRoutes";
import { socialContentRouter } from "./socialContentRoutes";
import { socialInternalRouter, socialPublishingRouter } from "./socialPublishingRoutes";
import { socialInboxRouter, socialWebhookRouter } from "./socialInboxRoutes";
import { socialAnalyticsRouter } from "./socialAnalyticsRoutes";
import { socialListeningRouter, socialReviewsRouter } from "./socialListeningRoutes";
import formRoutes from "./formRoutes";
import crmRoutes from "./crmRoutes";
import campaignRoutes from "./campaignRoutes";
import marketingRoutes from "./marketingRoutes";
import landingRoutes from "./landingRoutes";
import opsRoutes from "./opsRoutes";
import privacyRoutes from "./privacyRoutes";
import dashboardRoutes from "./dashboardRoutes";
import metaCallbackRoutes from "./metaCallbackRoutes";
import onboardingRoutes from "./onboardingRoutes";
import workspaceRoutes from "./workspaceRoutes";
import invitationRoutes from "./invitationRoutes";
import productRoutes from "./productRoutes";
import productModuleRoutes from "./productModuleRoutes";
import productCategoryRoutes from "./productCategoryRoutes";
import industryRoutes from "./industryRoutes";
import pageRoutes from "./pageRoutes";
import templateRoutes from "./templateRoutes";
import templatePartRoutes from "./templatePartRoutes";
import navigationMenuRoutes from "./navigationMenuRoutes";
import postRoutes from "./postRoutes";
import caseStudyRoutes from "./caseStudyRoutes";
import categoryRoutes from "./categoryRoutes";
import redirectRoutes from "./redirectRoutes";
import seoRoutes from "./seoRoutes";
import tagRoutes from "./tagRoutes";
import authorRoutes from "./authorRoutes";
import mediaRoutes from "./mediaRoutes";
import contractRoutes from "./contractRoutes";
import subscriptionRoutes from "./subscriptionRoutes";
import invoiceRoutes from "./invoiceRoutes";
import paymentRoutes from "./paymentRoutes";
import portalRoutes from "./portalRoutes";
import publicRoutes from "./publicRoutes";
import aiProviderRoutes from "./aiProviderRoutes";
import aiToolRoutes from "./aiToolRoutes";
import aiPromptRoutes from "./aiPromptRoutes";
import aiWorkflowRoutes from "./aiWorkflowRoutes";
import aiExecutionRoutes from "./aiExecutionRoutes";
import aiUsageRoutes from "./aiUsageRoutes";
import aiHealthRoutes from "./aiHealthRoutes";
import portalRegistrationRoutes from "./portalRegistrationRoutes";
import aiApprovalRoutes from "./aiApprovalRoutes";
import automationRoutes from "./automationRoutes";
import knowledgeRoutes from "./knowledgeRoutes";
import copilotRoutes from "./copilotRoutes";
import adminRoutes from "./adminRoutes";
import { integrationsRouter, webhookEndpointsRouter, apiKeysRouter } from "./integrationRoutes";
import externalRoutes from "./externalRoutes";
import analyticsRoutes from "./analyticsRoutes";
import reportsRoutes from "./reportsRoutes";
import contentApprovalRoutes from "./contentApprovalRoutes";

const v1Router = Router();

v1Router.use("/auth", authRoutes);
v1Router.use("/webhooks", webhookRoutes);
v1Router.use("/system", systemRoutes);
v1Router.use("/users", userRoutes);
v1Router.use("/roles", roleRoutes);
v1Router.use("/permissions", permissionsRouter);
v1Router.use("/organizations", organizationRoutes);
v1Router.use("/audit-logs", auditLogRoutes);
v1Router.use("/settings", settingsRoutes);
v1Router.use("/site-settings", siteSettingsRoutes);
v1Router.use("/leads", leadRoutes);
v1Router.use("/clients", clientRoutes);
v1Router.use("/contacts", contactRoutes);
v1Router.use("/opportunities", opportunityRoutes);
v1Router.use("/notifications", notificationRoutes);
v1Router.use("/approvals", approvalCenterRoutes);
v1Router.use("/nav", navRoutes);
v1Router.use("/social/internal", socialInternalRouter); // CRON_SECRET-protected, must precede the authenticated social routers
v1Router.use("/social/webhooks", socialWebhookRouter); // provider-signed, no session
v1Router.use("/social/publishing", socialPublishingRouter);
v1Router.use("/social/inbox", socialInboxRouter);
v1Router.use("/social/accounts", socialAccountsRouter);
v1Router.use("/social/analytics", socialAnalyticsRouter);
v1Router.use("/social/listening", socialListeningRouter);
v1Router.use("/social/reviews", socialReviewsRouter);
v1Router.use("/social", socialContentRouter);
v1Router.use("/forms", formRoutes);
v1Router.use("/crm", crmRoutes);
v1Router.use("/campaigns", campaignRoutes);
v1Router.use("/marketing/landing-pages", landingRoutes);
v1Router.use("/ops", opsRoutes);
v1Router.use("/privacy", privacyRoutes);
v1Router.use("/dashboard", dashboardRoutes);
v1Router.use("/meta", metaCallbackRoutes); // Step 15: signed_request-protected, no session
v1Router.use("/marketing", marketingRoutes);
v1Router.use("/onboarding", onboardingRoutes);
v1Router.use("/workspaces", workspaceRoutes);
v1Router.use("/invitations", invitationRoutes);
v1Router.use("/products", productRoutes);
v1Router.use("/product-modules", productModuleRoutes);
v1Router.use("/product-categories", productCategoryRoutes);
v1Router.use("/industries", industryRoutes);
v1Router.use("/pages", pageRoutes);
v1Router.use("/templates", templateRoutes);
v1Router.use("/template-parts", templatePartRoutes);
v1Router.use("/navigation-menus", navigationMenuRoutes);
v1Router.use("/posts", postRoutes);
v1Router.use("/case-studies", caseStudyRoutes);
v1Router.use("/categories", categoryRoutes);
v1Router.use("/redirects", redirectRoutes);
v1Router.use("/seo", seoRoutes);
v1Router.use("/tags", tagRoutes);
v1Router.use("/authors", authorRoutes);
v1Router.use("/media", mediaRoutes);
v1Router.use("/contracts", contractRoutes);
v1Router.use("/subscriptions", subscriptionRoutes);
v1Router.use("/invoices", invoiceRoutes);
v1Router.use("/payments", paymentRoutes);
v1Router.use("/portal", portalRoutes);
v1Router.use("/portal-registrations", portalRegistrationRoutes);
v1Router.use("/public", publicRoutes);
v1Router.use("/ai", aiHealthRoutes);
v1Router.use("/ai/providers", aiProviderRoutes);
v1Router.use("/ai/tools", aiToolRoutes);
v1Router.use("/ai/prompts", aiPromptRoutes);
v1Router.use("/ai/workflows", aiWorkflowRoutes);
v1Router.use("/ai/executions", aiExecutionRoutes);
v1Router.use("/ai/usage", aiUsageRoutes);
v1Router.use("/ai/approvals", aiApprovalRoutes);
v1Router.use("/automation", automationRoutes);
v1Router.use("/knowledge", knowledgeRoutes);
v1Router.use("/copilot", copilotRoutes);
v1Router.use("/admin", adminRoutes);
v1Router.use("/integrations", integrationsRouter);
v1Router.use("/webhook-endpoints", webhookEndpointsRouter);
v1Router.use("/api-keys", apiKeysRouter);
v1Router.use("/external", externalRoutes);
v1Router.use("/analytics", analyticsRoutes);
v1Router.use("/reports", reportsRoutes);
v1Router.use("/automation/content-approvals", contentApprovalRoutes);

export default v1Router;
