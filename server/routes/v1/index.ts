/**
 * Artify Platform API v1 — canonical namespace (Phase 1 §11).
 * Phase 3 adds the identity/RBAC management surface (users, roles,
 * permissions, organizations/memberships — docs/RBAC_IMPLEMENTATION.md).
 * Phase 5 adds CRM (leads, clients, contacts — docs/CRM_ARCHITECTURE.md).
 * Other business-domain route groups (products, subscriptions/billing,
 * CMS, media, AI) remain for their respective future phases.
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

export default v1Router;
