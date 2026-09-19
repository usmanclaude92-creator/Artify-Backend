/**
 * Artify Platform API v1 — canonical namespace (Phase 1 §11).
 * Business-domain route groups (cms, products, subscriptions, leads
 * business-logic, ai) are added in their respective phases per
 * docs/IMPLEMENTATION_PLAN.md — Phase 1 mounts only the auth, webhook, and
 * system foundation.
 */
import { Router } from "express";
import authRoutes from "./authRoutes";
import webhookRoutes from "./webhookRoutes";
import systemRoutes from "./systemRoutes";

const v1Router = Router();

v1Router.use("/auth", authRoutes);
v1Router.use("/webhooks", webhookRoutes);
v1Router.use("/system", systemRoutes);

export default v1Router;
