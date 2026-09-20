/**
 * Typed request functions over apiClient.ts for every Phase 3/4 endpoint
 * the Control Center consumes. One file, one shape per resource — no
 * component calls apiClient/fetch directly (Phase 4 §5/§37).
 */
import { apiClient } from "./apiClient";

export interface ResolvedRole {
  id: string;
  key: string;
  name: string;
  permissions: string[];
}

export interface SanitizedUser {
  id: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  phone: string | null;
  title: string | null;
  roleId: string;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  mfaEnabled: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  role: ResolvedRole;
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  roleKey: string;
  roleName: string;
  isPrimary: boolean;
  isCurrent: boolean;
}

export interface Organization {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  type: "INTERNAL" | "CLIENT" | "PARTNER";
  tier: "GROWTH" | "ENTERPRISE" | "CUSTOM";
  status: "ACTIVE" | "TRIAL" | "SUSPENDED" | "ARCHIVED";
  email: string | null;
  phone: string | null;
  website: string | null;
  country: string | null;
  currency: string;
  createdAt: string;
}

export interface OrganizationMember {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  status: "ACTIVE" | "INVITED" | "SUSPENDED";
  isPrimary: boolean;
  roleKey: string;
  roleName: string;
  joinedAt: string;
}

export interface Permission {
  id: string;
  key: string;
  name: string;
  description: string | null;
  module: string;
}

export interface AuditLogEntry {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorType: "USER" | "AI_COWORKER" | "SYSTEM" | "API_KEY";
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  result: "SUCCESS" | "FAILURE";
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  isCurrent: boolean;
}

export interface SystemSetting {
  id: string;
  organizationId: string;
  key: string;
  value: unknown;
  type: "STRING" | "NUMBER" | "BOOLEAN" | "JSON";
  description: string | null;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface EnvelopeMeta {
  pagination?: { page: number; limit: number; total: number; totalPages: number };
}

async function paginatedGet<T>(path: string, key: string, params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") query.set(k, String(v));
  }
  const qs = query.toString();
  const raw = await apiClient.getRaw<Record<string, unknown>>(qs ? `${path}?${qs}` : path);
  const meta = raw.meta as EnvelopeMeta;
  const items = (raw.data as Record<string, unknown>)[key] as T[];
  return {
    items,
    page: meta.pagination?.page ?? 1,
    limit: meta.pagination?.limit ?? items.length,
    total: meta.pagination?.total ?? items.length,
    totalPages: meta.pagination?.totalPages ?? 1,
  } satisfies Paginated<T>;
}

export const authApi = {
  // suppressUnauthorizedHandling: a 401 here means "wrong credentials" or
  // "bad/expired reset token," never "your existing session expired" —
  // must not trigger the global session-expired clear/redirect.
  login: (email: string, password: string) =>
    apiClient.post<{ session: { token: string; expiresAt: string }; user: SanitizedUser }>(
      "/auth/login",
      { email, password },
      { suppressUnauthorizedHandling: true }
    ),
  register: (payload: { email: string; password: string; firstName: string; lastName: string; organizationName: string }) =>
    apiClient.post<{ session: { token: string; expiresAt: string }; user: SanitizedUser }>("/auth/register", payload, {
      suppressUnauthorizedHandling: true,
    }),
  me: () => apiClient.get<{ user: SanitizedUser; organizations: MembershipSummary[] }>("/auth/me"),
  logout: () => apiClient.post<{ message: string }>("/auth/logout"),
  logoutAll: () => apiClient.post<{ message: string }>("/auth/logout-all"),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post<{ message: string }>("/auth/change-password", { currentPassword, newPassword }),
  requestPasswordReset: (email: string) =>
    apiClient.post<{ message: string; devToken?: string }>("/auth/password-reset/request", { email }),
  confirmPasswordReset: (token: string, newPassword: string) =>
    apiClient.post<{ message: string }>(
      "/auth/password-reset/confirm",
      { token, newPassword },
      { suppressUnauthorizedHandling: true }
    ),
  switchOrganization: (organizationId: string) =>
    apiClient.post<{ session: { token: string; expiresAt: string }; user: SanitizedUser }>("/auth/switch-organization", {
      organizationId,
    }),
  sessions: () => apiClient.get<{ sessions: SessionSummary[] }>("/auth/sessions"),
  revokeSession: (id: string) => apiClient.post<{ message: string }>(`/auth/sessions/${id}/revoke`),
};

export const usersApi = {
  list: (params: { page?: number; limit?: number } = {}) => paginatedGet<SanitizedUser>("/users", "users", params),
  get: (id: string) => apiClient.get<{ user: SanitizedUser }>(`/users/${id}`),
  create: (payload: { email: string; password: string; firstName: string; lastName: string; title?: string; roleKey: string }) =>
    apiClient.post<{ user: SanitizedUser }>("/users", payload),
  update: (
    id: string,
    payload: Partial<{
      firstName: string;
      lastName: string;
      title: string | null;
      phone: string | null;
      status: "ACTIVE" | "INVITED" | "DISABLED";
      roleKey: string;
    }>
  ) => apiClient.patch<{ user: SanitizedUser }>(`/users/${id}`, payload),
};

export const rolesApi = {
  list: () => apiClient.get<{ roles: ResolvedRole[] }>("/roles"),
};

export const permissionsApi = {
  list: () => apiClient.get<{ permissions: Permission[] }>("/permissions"),
};

export const organizationsApi = {
  list: () => apiClient.get<{ organizations: Organization[] }>("/organizations"),
  get: (id: string) => apiClient.get<{ organization: Organization }>(`/organizations/${id}`),
  summary: (id: string) => apiClient.get<{ memberCount: number; activeSessionCount: number }>(`/organizations/${id}/summary`),
  members: (id: string, params: { page?: number; limit?: number } = {}) =>
    paginatedGet<OrganizationMember>(`/organizations/${id}/members`, "members", params),
  addMember: (id: string, payload: { userId: string; roleKey: string }) =>
    apiClient.post<{ membership: unknown }>(`/organizations/${id}/members`, payload),
  updateMember: (id: string, userId: string, payload: { roleKey?: string; status?: "ACTIVE" | "INVITED" | "SUSPENDED" }) =>
    apiClient.patch<{ membership: unknown }>(`/organizations/${id}/members/${userId}`, payload),
  removeMember: (id: string, userId: string) => apiClient.delete<{ message: string }>(`/organizations/${id}/members/${userId}`),
};

export const auditLogsApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      action?: string;
      resourceType?: string;
      result?: "SUCCESS" | "FAILURE";
      dateFrom?: string;
      dateTo?: string;
    } = {}
  ) => paginatedGet<AuditLogEntry>("/audit-logs", "auditLogs", params),
};

export const settingsApi = {
  list: () => apiClient.get<{ settings: SystemSetting[] }>("/settings"),
  update: (key: string, value: unknown, type: SystemSetting["type"] = "STRING", description?: string) =>
    apiClient.patch<{ setting: SystemSetting }>(`/settings/${key}`, { value, type, description }),
};
