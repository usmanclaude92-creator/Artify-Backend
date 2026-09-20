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
 * Other business-domain route groups (subscriptions/billing, media, AI)
 * remain for their respective future phases.
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
import leadRoutes from "./leadRoutes";
import clientRoutes from "./clientRoutes";
import contactRoutes from "./contactRoutes";
import crmRoutes from "./crmRoutes";
import onboardingRoutes from "./onboardingRoutes";
import workspaceRoutes from "./workspaceRoutes";
import invitationRoutes from "./invitationRoutes";
import productRoutes from "./productRoutes";
import productModuleRoutes from "./productModuleRoutes";
import pageRoutes from "./pageRoutes";
import postRoutes from "./postRoutes";
import categoryRoutes from "./categoryRoutes";
import tagRoutes from "./tagRoutes";
import authorRoutes from "./authorRoutes";
import mediaRoutes from "./mediaRoutes";

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
v1Router.use("/leads", leadRoutes);
v1Router.use("/clients", clientRoutes);
v1Router.use("/contacts", contactRoutes);
v1Router.use("/crm", crmRoutes);
v1Router.use("/onboarding", onboardingRoutes);
v1Router.use("/workspaces", workspaceRoutes);
v1Router.use("/invitations", invitationRoutes);
v1Router.use("/products", productRoutes);
v1Router.use("/product-modules", productModuleRoutes);
v1Router.use("/pages", pageRoutes);
v1Router.use("/posts", postRoutes);
v1Router.use("/categories", categoryRoutes);
v1Router.use("/tags", tagRoutes);
v1Router.use("/authors", authorRoutes);
v1Router.use("/media", mediaRoutes);

export default v1Router;
