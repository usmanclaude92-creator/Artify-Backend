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

async function paginatedGet<T>(path: string, key: string, params: Record<string, string | number | boolean | undefined>) {
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

// ---------------------------------------------------------------------------
// Phase 5 — CRM (leads, clients, contacts)
// ---------------------------------------------------------------------------

export type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED" | "LOST";
export type ClientStatusValue = "PROSPECT" | "ACTIVE" | "INACTIVE" | "SUSPENDED" | "ARCHIVED";

export interface Lead {
  id: string;
  organizationId: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: LeadStatus;
  notes: string | null;
  assignedTo: string | null;
  convertedClientId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmClient {
  id: string;
  organizationId: string;
  clientCode: string;
  name: string;
  legalName: string | null;
  status: ClientStatusValue;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  accountManager: string | null;
  notes: string | null;
  workspaceOrganizationId: string | null;
  /** Backend-computed (Phase 6 §32) — never inferred client-side. */
  provisioningStatus: "NOT_PROVISIONED" | "PROVISIONING" | "PROVISIONED" | "SUSPENDED";
  createdAt: string;
  updatedAt: string;
}

export interface CrmContact {
  id: string;
  organizationId: string;
  clientId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  isPrimary: boolean;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
}

export interface CrmSummary {
  leads: {
    total: number;
    new: number;
    contacted: number;
    qualified: number;
    converted: number;
    lost: number;
    recent: Lead[];
  } | null;
  clients: {
    total: number;
    prospect: number;
    active: number;
    inactive: number;
    suspended: number;
    archived: number;
    recent: CrmClient[];
  } | null;
}

export const leadsApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: LeadStatus;
      source?: string;
      assignedTo?: string;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<Lead>("/leads", "leads", params),
  get: (id: string) => apiClient.get<{ lead: Lead }>(`/leads/${id}`),
  create: (payload: {
    companyName: string;
    contactName?: string;
    email?: string;
    phone?: string;
    source?: string;
    status?: LeadStatus;
    notes?: string;
    assignedTo?: string;
  }) => apiClient.post<{ lead: Lead }>("/leads", payload),
  update: (id: string, payload: Partial<Omit<Lead, "id" | "organizationId" | "createdAt" | "updatedAt" | "convertedClientId" | "convertedAt">>) =>
    apiClient.patch<{ lead: Lead }>(`/leads/${id}`, payload),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/leads/${id}`),
  convert: (
    id: string,
    payload: { clientCode: string; name?: string; email?: string; phone?: string; website?: string; address?: string; createContact?: boolean }
  ) => apiClient.post<{ client: CrmClient; contactId: string | null }>(`/leads/${id}/convert`, payload),
};

export const clientsApi = {
  list: (params: { page?: number; limit?: number; search?: string; status?: ClientStatusValue; sort?: string; order?: "asc" | "desc" } = {}) =>
    paginatedGet<CrmClient>("/clients", "clients", params),
  get: (id: string) => apiClient.get<{ client: CrmClient }>(`/clients/${id}`),
  create: (payload: {
    clientCode: string;
    name: string;
    legalName?: string;
    status?: ClientStatusValue;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
    accountManager?: string;
    notes?: string;
  }) => apiClient.post<{ client: CrmClient }>("/clients", payload),
  update: (id: string, payload: Partial<Omit<CrmClient, "id" | "organizationId" | "clientCode" | "createdAt" | "updatedAt">>) =>
    apiClient.patch<{ client: CrmClient }>(`/clients/${id}`, payload),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/clients/${id}`),
  contacts: (clientId: string, params: { page?: number; limit?: number } = {}) =>
    paginatedGet<CrmContact>(`/clients/${clientId}/contacts`, "contacts", params),
  addContact: (clientId: string, payload: { firstName: string; lastName: string; email?: string; phone?: string; jobTitle?: string; isPrimary?: boolean }) =>
    apiClient.post<{ contact: CrmContact }>(`/clients/${clientId}/contacts`, payload),
  // Phase 6 — onboarding/workspace provisioning, nested under the owning client (docs/CLIENT_ONBOARDING_ARCHITECTURE.md).
  startOnboarding: (clientId: string) => apiClient.post<{ onboarding: Onboarding }>(`/clients/${clientId}/onboarding/start`),
  getOnboarding: (clientId: string) => apiClient.get<{ onboarding: Onboarding | null }>(`/clients/${clientId}/onboarding`),
  provisionWorkspace: (clientId: string, payload: { name?: string; timezone?: string; currency?: string; locale?: string } = {}) =>
    apiClient.post<{ workspace: Workspace }>(`/clients/${clientId}/workspace/provision`, payload),
};

export const contactsApi = {
  list: (params: { page?: number; limit?: number; search?: string; clientId?: string } = {}) =>
    paginatedGet<CrmContact>("/contacts", "contacts", params),
  get: (id: string) => apiClient.get<{ contact: CrmContact }>(`/contacts/${id}`),
  update: (id: string, payload: Partial<Pick<CrmContact, "firstName" | "lastName" | "email" | "phone" | "jobTitle" | "isPrimary" | "status">>) =>
    apiClient.patch<{ contact: CrmContact }>(`/contacts/${id}`, payload),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/contacts/${id}`),
};

export const crmApi = {
  summary: () => apiClient.get<CrmSummary>("/crm/summary"),
};

// ---------------------------------------------------------------------------
// Phase 6 — Client onboarding & workspace provisioning
// ---------------------------------------------------------------------------

export type OnboardingStatusValue = "NOT_STARTED" | "IN_PROGRESS" | "READY" | "COMPLETED" | "CANCELLED";
export type WorkspaceStatusValue = "TRIAL" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export interface OnboardingChecklistItem {
  key: string;
  label: string;
  completed: boolean;
  completedAt: string | null;
  completedById: string | null;
}

export interface Onboarding {
  id: string;
  organizationId: string;
  clientId: string;
  status: OnboardingStatusValue;
  currentStep: string | null;
  checklist: OnboardingChecklistItem[];
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string; clientCode: string; workspaceOrganization?: Workspace | null };
}

export interface Workspace {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  type: "INTERNAL" | "CLIENT" | "PARTNER";
  tier: "GROWTH" | "ENTERPRISE" | "CUSTOM";
  status: WorkspaceStatusValue;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  country: string | null;
  timezone: string;
  currency: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
  provisionedForClient?: { id: string; name: string; clientCode: string } | null;
}

export interface WorkspaceMember {
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

export type InvitationStatusValue = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface WorkspaceInvitation {
  id: string;
  organizationId: string;
  email: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: InvitationStatusValue;
  role: { key: string; name: string };
  invitedBy: { id: string; email: string; firstName: string; lastName: string; displayName: string | null } | null;
}

export interface InvitationPreview {
  email: string;
  workspaceName: string;
  roleName: string;
  expiresAt: string;
  requiresPassword: boolean;
}

export const onboardingApi = {
  list: (params: { page?: number; limit?: number; status?: OnboardingStatusValue; search?: string } = {}) =>
    paginatedGet<Onboarding>("/onboarding", "onboarding", params),
  get: (id: string) => apiClient.get<{ onboarding: Onboarding }>(`/onboarding/${id}`),
  completeStep: (id: string, step: string) => apiClient.patch<{ onboarding: Onboarding }>(`/onboarding/${id}`, { completeStep: step }),
  cancel: (id: string) => apiClient.patch<{ onboarding: Onboarding }>(`/onboarding/${id}`, { status: "CANCELLED" }),
  complete: (id: string) => apiClient.post<{ onboarding: Onboarding }>(`/onboarding/${id}/complete`),
};

export const workspacesApi = {
  list: (params: { page?: number; limit?: number; status?: WorkspaceStatusValue; search?: string } = {}) =>
    paginatedGet<Workspace>("/workspaces", "workspaces", params),
  get: (id: string) => apiClient.get<{ workspace: Workspace }>(`/workspaces/${id}`),
  update: (
    id: string,
    payload: Partial<{
      name: string;
      email: string | null;
      phone: string | null;
      website: string | null;
      address: string | null;
      timezone: string;
      currency: string;
      locale: string;
      status: WorkspaceStatusValue;
    }>
  ) => apiClient.patch<{ workspace: Workspace }>(`/workspaces/${id}`, payload),
  members: (id: string, params: { page?: number; limit?: number } = {}) =>
    paginatedGet<WorkspaceMember>(`/workspaces/${id}/members`, "members", params),
  invitations: (id: string, params: { page?: number; limit?: number } = {}) =>
    paginatedGet<WorkspaceInvitation>(`/workspaces/${id}/invitations`, "invitations", params),
  invite: (id: string, email: string) =>
    apiClient.post<{ invitation: WorkspaceInvitation; devToken?: string }>(`/workspaces/${id}/invitations`, { email }),
};

export const invitationsApi = {
  revoke: (id: string) => apiClient.post<{ message: string }>(`/invitations/${id}/revoke`),
  /** Public — no session required (an invitee has no account/token yet). */
  preview: (token: string) => apiClient.get<InvitationPreview>(`/invitations/${token}`, { suppressUnauthorizedHandling: true }),
  accept: (token: string, payload: { firstName?: string; lastName?: string; password?: string }) =>
    apiClient.post<{ session: { token: string; expiresAt: string }; user: SanitizedUser }>(`/invitations/${token}/accept`, payload, {
      suppressUnauthorizedHandling: true,
    }),
};

// ---------------------------------------------------------------------------
// Phase 7 — Product & Service catalog
// ---------------------------------------------------------------------------

export type ProductTypeValue = "PRODUCT" | "SERVICE";
export type ProductStatusValue = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type ProductModuleStatusValue = "DRAFT" | "ACTIVE" | "INACTIVE";

export interface CatalogProduct {
  id: string;
  code: string;
  name: string;
  slug: string;
  type: ProductTypeValue;
  shortDescription: string | null;
  description: string | null;
  status: ProductStatusValue;
  isFeatured: boolean;
  displayOrder: number;
  version: string;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductModule {
  id: string;
  productId: string;
  code: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProductModuleStatusValue;
  displayOrder: number;
  isCore: boolean;
  createdAt: string;
  updatedAt: string;
}

export const productsApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      type?: ProductTypeValue;
      status?: ProductStatusValue;
      isFeatured?: boolean;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<CatalogProduct>("/products", "products", params),
  get: (id: string) => apiClient.get<{ product: CatalogProduct }>(`/products/${id}`),
  create: (payload: {
    code: string;
    name: string;
    slug?: string;
    type: ProductTypeValue;
    shortDescription?: string;
    description?: string;
    status?: ProductStatusValue;
    isFeatured?: boolean;
    displayOrder?: number;
  }) => apiClient.post<{ product: CatalogProduct }>("/products", payload),
  update: (
    id: string,
    payload: Partial<{
      name: string;
      slug: string;
      type: ProductTypeValue;
      shortDescription: string | null;
      description: string | null;
      status: ProductStatusValue;
      isFeatured: boolean;
      displayOrder: number;
    }>
  ) => apiClient.patch<{ product: CatalogProduct }>(`/products/${id}`, payload),
  archive: (id: string) => apiClient.post<{ product: CatalogProduct }>(`/products/${id}/archive`),
  modules: (id: string, params: { page?: number; limit?: number; status?: ProductModuleStatusValue } = {}) =>
    paginatedGet<ProductModule>(`/products/${id}/modules`, "modules", params),
  addModule: (
    id: string,
    payload: { code: string; name: string; slug?: string; description?: string; status?: ProductModuleStatusValue; isCore?: boolean; displayOrder?: number }
  ) => apiClient.post<{ module: ProductModule }>(`/products/${id}/modules`, payload),
  reorderModules: (id: string, moduleIds: string[]) => apiClient.post<{ message: string }>(`/products/${id}/modules/reorder`, { moduleIds }),
};

export const productModulesApi = {
  get: (id: string) => apiClient.get<{ module: ProductModule }>(`/product-modules/${id}`),
  update: (
    id: string,
    payload: Partial<{ name: string; slug: string; description: string | null; status: ProductModuleStatusValue; isCore: boolean; displayOrder: number }>
  ) => apiClient.patch<{ module: ProductModule }>(`/product-modules/${id}`, payload),
  archive: (id: string) => apiClient.post<{ module: ProductModule }>(`/product-modules/${id}/archive`),
};

// ---------------------------------------------------------------------------
// Phase 8 — CMS (pages, posts, categories, tags, authors, revisions)
// ---------------------------------------------------------------------------

export type ContentStatusValue = "DRAFT" | "IN_REVIEW" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
/** Only status reachable through the generic PATCH — every forward move is a dedicated endpoint (server/schemas/contentSchemas.ts). */
export type PatchableContentStatus = "DRAFT";

export interface ContentRevision {
  id: string;
  pageId: string | null;
  postId: string | null;
  version: number;
  status: ContentStatusValue;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  createdById: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface CmsPage {
  id: string;
  organizationId: string;
  slug: string;
  title: string;
  status: ContentStatusValue;
  currentRevisionId: string | null;
  currentRevision: ContentRevision | null;
  featuredMediaId: string | null;
  createdById: string | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CmsCategory {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CmsTag {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  createdAt: string;
}

export interface CmsPost {
  id: string;
  organizationId: string;
  slug: string;
  title: string;
  status: ContentStatusValue;
  categoryId: string | null;
  authorId: string | null;
  currentRevisionId: string | null;
  currentRevision: ContentRevision | null;
  featuredMediaId: string | null;
  category: CmsCategory | null;
  author: { id: string; bio: string | null; avatarUrl: string | null } | null;
  tags: Array<{ postId: string; tagId: string; tag: CmsTag }>;
  createdById: string | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CmsAuthor {
  id: string;
  userId: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string; firstName: string; lastName: string; displayName: string | null; status: string };
}

const contentUpdateBody = (payload: {
  title?: string;
  slug?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  status?: PatchableContentStatus;
  featuredMediaId?: string | null;
  expectedUpdatedAt?: string;
}) => payload;

export const pagesApi = {
  list: (
    params: { page?: number; limit?: number; search?: string; status?: ContentStatusValue; sort?: string; order?: "asc" | "desc" } = {}
  ) => paginatedGet<CmsPage>("/pages", "pages", params),
  get: (id: string) => apiClient.get<{ page: CmsPage }>(`/pages/${id}`),
  revisions: (id: string) => apiClient.get<{ revisions: ContentRevision[] }>(`/pages/${id}/revisions`),
  create: (payload: { title: string; slug?: string; body?: string; metadata?: Record<string, unknown>; featuredMediaId?: string }) =>
    apiClient.post<{ page: CmsPage }>("/pages", payload),
  update: (id: string, payload: Parameters<typeof contentUpdateBody>[0]) => apiClient.patch<{ page: CmsPage }>(`/pages/${id}`, contentUpdateBody(payload)),
  submitForReview: (id: string) => apiClient.post<{ page: CmsPage }>(`/pages/${id}/submit-review`),
  publish: (id: string) => apiClient.post<{ page: CmsPage }>(`/pages/${id}/publish`),
  schedule: (id: string, scheduledAt: string) => apiClient.post<{ page: CmsPage }>(`/pages/${id}/schedule`, { scheduledAt }),
  archive: (id: string) => apiClient.post<{ page: CmsPage }>(`/pages/${id}/archive`),
  revert: (id: string, revisionId: string) => apiClient.post<{ page: CmsPage }>(`/pages/${id}/revert`, { revisionId }),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/pages/${id}`),
};

export const postsApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: ContentStatusValue;
      categoryId?: string;
      tagId?: string;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<CmsPost>("/posts", "posts", params),
  get: (id: string) => apiClient.get<{ post: CmsPost }>(`/posts/${id}`),
  revisions: (id: string) => apiClient.get<{ revisions: ContentRevision[] }>(`/posts/${id}/revisions`),
  create: (payload: {
    title: string;
    slug?: string;
    body?: string;
    metadata?: Record<string, unknown>;
    categoryId?: string;
    authorId?: string;
    tagIds?: string[];
    featuredMediaId?: string;
  }) => apiClient.post<{ post: CmsPost }>("/posts", payload),
  update: (
    id: string,
    payload: {
      title?: string;
      slug?: string;
      body?: string;
      metadata?: Record<string, unknown>;
      status?: PatchableContentStatus;
      categoryId?: string | null;
      authorId?: string | null;
      tagIds?: string[];
      featuredMediaId?: string | null;
      expectedUpdatedAt?: string;
    }
  ) => apiClient.patch<{ post: CmsPost }>(`/posts/${id}`, payload),
  submitForReview: (id: string) => apiClient.post<{ post: CmsPost }>(`/posts/${id}/submit-review`),
  publish: (id: string) => apiClient.post<{ post: CmsPost }>(`/posts/${id}/publish`),
  schedule: (id: string, scheduledAt: string) => apiClient.post<{ post: CmsPost }>(`/posts/${id}/schedule`, { scheduledAt }),
  archive: (id: string) => apiClient.post<{ post: CmsPost }>(`/posts/${id}/archive`),
  revert: (id: string, revisionId: string) => apiClient.post<{ post: CmsPost }>(`/posts/${id}/revert`, { revisionId }),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/posts/${id}`),
};

export const categoriesApi = {
  list: () => apiClient.get<{ categories: CmsCategory[] }>("/categories"),
  get: (id: string) => apiClient.get<{ category: CmsCategory }>(`/categories/${id}`),
  create: (payload: { name: string; slug?: string; description?: string }) => apiClient.post<{ category: CmsCategory }>("/categories", payload),
  update: (id: string, payload: Partial<{ name: string; slug: string; description: string | null }>) =>
    apiClient.patch<{ category: CmsCategory }>(`/categories/${id}`, payload),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/categories/${id}`),
};

export const tagsApi = {
  list: () => apiClient.get<{ tags: CmsTag[] }>("/tags"),
  get: (id: string) => apiClient.get<{ tag: CmsTag }>(`/tags/${id}`),
  create: (payload: { name: string; slug?: string }) => apiClient.post<{ tag: CmsTag }>("/tags", payload),
  update: (id: string, payload: Partial<{ name: string; slug: string }>) => apiClient.patch<{ tag: CmsTag }>(`/tags/${id}`, payload),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/tags/${id}`),
};

export const authorsApi = {
  list: () => apiClient.get<{ authors: CmsAuthor[] }>("/authors"),
  get: (id: string) => apiClient.get<{ author: CmsAuthor }>(`/authors/${id}`),
  create: (payload: { userId: string; bio?: string; avatarUrl?: string }) => apiClient.post<{ author: CmsAuthor }>("/authors", payload),
  update: (id: string, payload: Partial<{ bio: string | null; avatarUrl: string | null }>) =>
    apiClient.patch<{ author: CmsAuthor }>(`/authors/${id}`, payload),
};

// ---------------------------------------------------------------------------
// Phase 9 — Media Library & object storage
// ---------------------------------------------------------------------------

export type MediaStatusValue = "PENDING" | "ACTIVE" | "FAILED" | "ARCHIVED";
export type MediaVisibilityValue = "PRIVATE" | "PUBLIC";
export type AllowedMediaMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "image/svg+xml" | "application/pdf";

export interface CmsMedia {
  id: string;
  organizationId: string;
  originalFilename: string;
  displayName: string | null;
  storageProvider: string;
  storageBucket: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  altText: string | null;
  caption: string | null;
  visibility: MediaVisibilityValue;
  status: MediaStatusValue;
  uploadedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UploadSessionResult {
  media: CmsMedia;
  upload: { url: string; method: "PUT" | "POST"; headers?: Record<string, string>; expiresAt: string };
  uploadToken: string;
}

export const mediaApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: MediaStatusValue;
      mimeType?: AllowedMediaMimeType;
      uploadedById?: string;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<CmsMedia>("/media", "media", params),
  get: (id: string) => apiClient.get<{ media: CmsMedia }>(`/media/${id}`),
  getReadUrl: (id: string) => apiClient.get<{ url: string; expiresAt: string }>(`/media/${id}/url`),
  createUploadSession: (payload: { filename: string; mimeType: AllowedMediaMimeType; sizeBytes: number; displayName?: string; altText?: string; caption?: string }) =>
    apiClient.post<UploadSessionResult>("/media/upload-session", payload),
  complete: (id: string, token: string) => apiClient.post<{ media: CmsMedia }>(`/media/${id}/complete`, { token }),
  update: (id: string, payload: Partial<{ displayName: string | null; altText: string | null; caption: string | null; visibility: MediaVisibilityValue }>) =>
    apiClient.patch<{ media: CmsMedia }>(`/media/${id}`, payload),
  archive: (id: string) => apiClient.post<{ media: CmsMedia }>(`/media/${id}/archive`),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/media/${id}`),
  /**
   * The one call in this file that doesn't go through `apiClient` — the
   * browser uploads directly to the signed URL (§12), which is a raw
   * binary PUT with no Authorization header and no JSON envelope
   * response, self-authorized by its own signature/token instead.
   */
  async uploadToSignedUrl(upload: UploadSessionResult["upload"], file: File): Promise<void> {
    const res = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
    if (!res.ok) throw new Error(`Upload failed with status ${res.status}`);
  },
  /** Full flow: create the session, upload the bytes, then confirm — the shape every uploader (Media Library, CMS media picker) uses. */
  async uploadFile(
    file: File,
    meta: { mimeType: AllowedMediaMimeType; displayName?: string; altText?: string; caption?: string }
  ): Promise<CmsMedia> {
    const session = await mediaApi.createUploadSession({ filename: file.name, mimeType: meta.mimeType, sizeBytes: file.size, ...meta });
    await mediaApi.uploadToSignedUrl(session.upload, file);
    const completed = await mediaApi.complete(session.media.id, session.uploadToken);
    return completed.media;
  },
};
