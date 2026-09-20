/**
 * Frontend permission helper + extensible navigation config (Phase 4 §7/§27).
 *
 * IMPORTANT: this is UX only. Hiding a nav item or button never substitutes
 * for backend authorization — every action below still calls a route
 * protected by `requirePermission`/`requireRole` server-side (§28). This
 * module exists so the UI doesn't show entry points a user's own token
 * would be rejected for, not to be the source of truth for what's allowed.
 */
import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  KeyRound,
  Building2,
  ScrollText,
  MonitorSmartphone,
  Settings,
} from "lucide-react";
import { DashboardPage } from "../components/modules/DashboardPage";
import { UsersPage } from "../components/modules/UsersPage";
import { RolesPage } from "../components/modules/RolesPage";
import { PermissionsPage } from "../components/modules/PermissionsPage";
import { OrganizationsPage } from "../components/modules/OrganizationsPage";
import { AuditLogPage } from "../components/modules/AuditLogPage";
import { SecurityPage } from "../components/modules/SecurityPage";
import { SettingsPage } from "../components/modules/SettingsPage";

export function hasPermission(permissions: readonly string[] | undefined, key: string): boolean {
  return !!permissions?.includes(key);
}

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  /** Any one of these permissions is enough to show the item; empty means always visible to an authenticated user. */
  requiresAnyPermission?: string[];
  component: ComponentType;
}

/**
 * Extensible by design (§6): future product modules (CRM, Products, CMS,
 * Media, Subscriptions, Billing, Reports, AI) register here the same way —
 * a nav entry + a permission gate + a lazily-mounted page — none of them
 * built yet, since Phase 4 is Control Center/System Administration only.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", path: "/dashboard", icon: LayoutDashboard, component: DashboardPage },
  {
    id: "users",
    label: "Users",
    path: "/users",
    icon: Users,
    requiresAnyPermission: ["users.read"],
    component: UsersPage,
  },
  {
    id: "roles",
    label: "Roles",
    path: "/roles",
    icon: ShieldCheck,
    requiresAnyPermission: ["roles.read"],
    component: RolesPage,
  },
  {
    id: "permissions",
    label: "Permissions",
    path: "/permissions",
    icon: KeyRound,
    requiresAnyPermission: ["roles.read"],
    component: PermissionsPage,
  },
  {
    id: "organizations",
    label: "Organizations",
    path: "/organizations",
    icon: Building2,
    requiresAnyPermission: ["organizations.read"],
    component: OrganizationsPage,
  },
  {
    id: "audit-log",
    label: "Audit Log",
    path: "/audit-log",
    icon: ScrollText,
    requiresAnyPermission: ["audit.read"],
    component: AuditLogPage,
  },
  { id: "security", label: "Security", path: "/security", icon: MonitorSmartphone, component: SecurityPage },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    icon: Settings,
    requiresAnyPermission: ["settings.read"],
    component: SettingsPage,
  },
];

export function visibleNavItems(permissions: readonly string[] | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.requiresAnyPermission || item.requiresAnyPermission.some((p) => hasPermission(permissions, p)));
}
