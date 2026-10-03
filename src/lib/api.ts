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

/** Exported for src/lib/aiApi.ts (Phase 12) — same list-envelope parsing every paginated module here already shares. */
export async function paginatedGet<T>(path: string, key: string, params: Record<string, string | number | boolean | undefined>) {
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
// Phase 3 (Site Identity + Global Styles) — typed convenience endpoints on
// top of the generic SystemSetting store (server/schemas/siteSettingsSchemas.ts).
// ---------------------------------------------------------------------------

export interface SiteIdentity {
  siteName: string;
  tagline: string;
  description: string;
  logoMediaId: string | null;
  logoDarkMediaId: string | null;
  logoMobileMediaId: string | null;
  faviconMediaId: string | null;
  socialImageMediaId: string | null;
  defaultMetaTitle: string;
  defaultMetaDescription: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  organizationLegalName?: string;
}

export type FontWeightValue = number | "normal" | "bold";

export interface GlobalStyles {
  colors: {
    primary: string;
    primaryHover: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    background: string;
    surface: string;
    textPrimary: string;
    textSecondary: string;
    link: string;
    linkHover: string;
    border: string;
  };
  typography: {
    fontFamilyBase: string;
    fontFamilyHeading: string;
    fontSizeBase: string;
    headingScale: { h1: string; h2: string; h3: string; h4: string; h5: string; h6: string };
    lineHeightBase: number;
    lineHeightHeading: number;
    fontWeightBase: FontWeightValue;
    fontWeightHeading: FontWeightValue;
    fontWeightBold: FontWeightValue;
  };
  layout: {
    containerMaxWidth: string;
    spacingScale: { xs: string; sm: string; md: string; lg: string; xl: string };
    borderRadius: { sm: string; md: string; lg: string; full: string };
  };
  effects: {
    borderColor: string;
    borderWidth: string;
    shadowSm: string;
    shadowMd: string;
    shadowLg: string;
  };
  buttons: {
    radius: string;
    paddingX: string;
    paddingY: string;
    fontWeight: FontWeightValue;
    primaryBg: string;
    primaryText: string;
    primaryHoverBg: string;
    secondaryBg: string;
    secondaryText: string;
    secondaryBorder: string;
  };
  forms: {
    radius: string;
    borderColor: string;
    focusColor: string;
    background: string;
    text: string;
  };
  responsive: {
    tablet: { containerMaxWidth?: string; fontSizeBase?: string };
    mobile: { containerMaxWidth?: string; fontSizeBase?: string };
  };
}

export interface SettingsGroupState<T> {
  draft: T;
  published: T;
  isDirty: boolean;
  updatedAt: string | null;
  publishedAt: string | null;
}

export const siteSettingsApi = {
  getIdentity: () => apiClient.get<SettingsGroupState<SiteIdentity>>("/site-settings/identity"),
  saveIdentityDraft: (input: SiteIdentity) => apiClient.put<{ draft: SiteIdentity }>("/site-settings/identity/draft", input),
  publishIdentity: () => apiClient.post<{ published: SiteIdentity }>("/site-settings/identity/publish"),
  revertIdentity: () => apiClient.post<{ draft: SiteIdentity }>("/site-settings/identity/revert"),

  getGlobalStyles: () => apiClient.get<SettingsGroupState<GlobalStyles>>("/site-settings/global-styles"),
  saveGlobalStylesDraft: (input: GlobalStyles) => apiClient.put<{ draft: GlobalStyles }>("/site-settings/global-styles/draft", input),
  publishGlobalStyles: () => apiClient.post<{ published: GlobalStyles }>("/site-settings/global-styles/publish"),
  revertGlobalStyles: () => apiClient.post<{ draft: GlobalStyles }>("/site-settings/global-styles/revert"),
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

export type OpportunityStageValue = "PROSPECTING" | "QUALIFICATION" | "PROPOSAL" | "NEGOTIATION" | "CLOSED_WON" | "CLOSED_LOST";
/** The subset PATCH may set directly — CLOSED_WON/CLOSED_LOST are reachable only via opportunitiesApi.win/lose. */
export type NonTerminalOpportunityStage = "PROSPECTING" | "QUALIFICATION" | "PROPOSAL" | "NEGOTIATION";

export interface Opportunity {
  id: string;
  organizationId: string;
  clientId: string;
  leadId: string | null;
  name: string;
  stage: OpportunityStageValue;
  value: string;
  currency: string;
  expectedCloseDate: string | null;
  actualCloseDate: string | null;
  lostReason: string | null;
  notes: string | null;
  assignedTo: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string; clientCode: string };
  lead: { id: string; companyName: string } | null;
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
  opportunities: {
    openCount: number;
    openValue: string;
    byStage: Record<string, { count: number; value: string }>;
    recent: Opportunity[];
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

export const opportunitiesApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      stage?: OpportunityStageValue;
      clientId?: string;
      assignedTo?: string;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<Opportunity>("/opportunities", "opportunities", params),
  get: (id: string) => apiClient.get<{ opportunity: Opportunity }>(`/opportunities/${id}`),
  create: (payload: {
    clientId: string;
    leadId?: string;
    name: string;
    stage?: NonTerminalOpportunityStage;
    value: number;
    currency?: string;
    expectedCloseDate?: string;
    notes?: string;
    assignedTo?: string;
  }) => apiClient.post<{ opportunity: Opportunity }>("/opportunities", payload),
  update: (
    id: string,
    payload: Partial<{
      name: string;
      stage: NonTerminalOpportunityStage;
      value: number;
      currency: string;
      expectedCloseDate: string | null;
      notes: string | null;
      assignedTo: string | null;
    }>
  ) => apiClient.patch<{ opportunity: Opportunity }>(`/opportunities/${id}`, payload),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/opportunities/${id}`),
  win: (id: string) => apiClient.post<{ opportunity: Opportunity }>(`/opportunities/${id}/win`),
  lose: (id: string, lostReason?: string) => apiClient.post<{ opportunity: Opportunity }>(`/opportunities/${id}/lose`, { lostReason }),
};

// ---------------------------------------------------------------------------
// Phase 11 — Notifications. IN_APP only (no email/SMS transport exists in
// this codebase) — never claim a delivery channel that isn't real.
// ---------------------------------------------------------------------------
export type NotificationStatusValue = "UNREAD" | "READ" | "ARCHIVED";
export interface AppNotification {
  id: string;
  organizationId: string | null;
  userId: string;
  type: string;
  title: string;
  message: string;
  status: NotificationStatusValue;
  readAt: string | null;
  createdAt: string;
}

export const notificationsApi = {
  list: (params: { page?: number; limit?: number; status?: NotificationStatusValue } = {}) =>
    paginatedGet<AppNotification>("/notifications", "notifications", params),
  unreadCount: () => apiClient.get<{ count: number }>("/notifications/unread-count"),
  markRead: (id: string) => apiClient.post<{ notification: AppNotification }>(`/notifications/${id}/read`),
  markAllRead: () => apiClient.post<{ count: number }>("/notifications/read-all"),
};

// ---------------------------------------------------------------------------
// Phase 9 (MVP slice) — Marketing forms. A submission reuses the existing
// Lead-intake pattern (publicFormService.ts in the backend) rather than
// being a parallel, CRM-disconnected record — see docs/FORMS_ARCHITECTURE.md.
// ---------------------------------------------------------------------------
export type FormStatusValue = "ACTIVE" | "ARCHIVED";
export type FormFieldTypeValue = "text" | "email" | "tel" | "textarea";
export interface FormFieldDef {
  key: string;
  label: string;
  type: FormFieldTypeValue;
  required: boolean;
}
export interface MarketingForm {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: FormStatusValue;
  fields: FormFieldDef[];
  successMessage: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface FormSubmission {
  id: string;
  formId: string;
  organizationId: string;
  data: Record<string, string>;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  leadId: string | null;
  createdAt: string;
}

export const formsApi = {
  list: (params: { page?: number; limit?: number; search?: string; status?: FormStatusValue; sort?: string; order?: "asc" | "desc" } = {}) =>
    paginatedGet<MarketingForm>("/forms", "forms", params),
  get: (id: string) => apiClient.get<{ form: MarketingForm }>(`/forms/${id}`),
  create: (payload: { name: string; slug?: string; fields: FormFieldDef[]; successMessage?: string }) =>
    apiClient.post<{ form: MarketingForm }>("/forms", payload),
  update: (id: string, payload: Partial<{ name: string; slug: string; fields: FormFieldDef[]; successMessage: string | null; status: FormStatusValue }>) =>
    apiClient.patch<{ form: MarketingForm }>(`/forms/${id}`, payload),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/forms/${id}`),
  listSubmissions: (id: string, params: { page?: number; limit?: number } = {}) =>
    paginatedGet<FormSubmission>(`/forms/${id}/submissions`, "submissions", params),
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
// Phase 2 (Site Editor) — block tree shared by a Page's own canvas
// (ContentRevision.editorBlocks) and a Template Part's content
// (TemplatePart.content). Mirrors server/schemas/editorSchemas.ts exactly.
// ---------------------------------------------------------------------------

export type BlockType =
  | "section"
  | "container"
  | "columns"
  | "text"
  | "heading"
  | "image"
  | "button"
  | "card"
  | "spacer"
  | "divider"
  | "templatePart"
  | "navigationMenu";

export interface EditorBlock {
  id: string;
  type: BlockType;
  props: Record<string, unknown>;
  children?: EditorBlock[];
}

export interface EditorDocument {
  version: 1;
  blocks: EditorBlock[];
}

// ---------------------------------------------------------------------------
// Phase 8 — CMS (pages, posts, categories, tags, authors, revisions)
// ---------------------------------------------------------------------------

export type ContentStatusValue = "DRAFT" | "IN_REVIEW" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
/** Only status reachable through the generic PATCH — every forward move is a dedicated endpoint (server/schemas/contentSchemas.ts). */
export type PatchableContentStatus = "DRAFT";

/**
 * Stored on `ContentRevision.metadata`, validated server-side by
 * server/schemas/contentSchemas.ts's `seoMetadataSchema` (`.strict()` —
 * an unknown key is rejected, not silently dropped), and exposed publicly
 * as `seo`. Field names mirror artifysolscom's `ArticleSeoMetadata`
 * (src/types.ts there) exactly, since that's what actually reads this
 * data to render `<title>`/meta tags/JSON-LD — the two must agree.
 */
export interface PostSeoMetadata {
  metaTitle?: string;
  metaDescription?: string;
  focusKeywords?: string[];
  canonicalUrl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  twitterImage?: string;
  ogType?: "article" | "website" | "news";
  twitterCard?: "summary_large_image" | "summary";
  robotsDirective?: "index, follow" | "noindex, nofollow" | "noindex, follow";
  schemaType?: "TechArticle" | "NewsArticle" | "BlogPosting" | "Report";
}

export interface ContentRevision {
  id: string;
  pageId: string | null;
  postId: string | null;
  version: number;
  status: ContentStatusValue;
  title: string;
  // Phase 7 — short author-written summary, distinct from metadata.metaDescription.
  excerpt: string | null;
  body: string;
  metadata: PostSeoMetadata;
  editorBlocks: EditorDocument | null;
  createdById: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export type PageTypeValue = "STANDARD" | "LANDING";

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
  // Phase 1 (Website module) — additive; every page created before this
  // phase reads templateId: null, pageType: "STANDARD", isHomepage: false.
  templateId: string | null;
  pageType: PageTypeValue;
  isHomepage: boolean;
  // Phase 5 — additive; every page created before this phase reads parentId: null.
  parentId: string | null;
}

export interface CmsCategory {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  // Phase 7 — hierarchy + usage count; null/0 on every category created before this phase.
  parentId: string | null;
  parent: { id: string; name: string; slug: string } | null;
  postCount: number;
}

export interface CmsTag {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  createdAt: string;
  // Phase 7 — description + usage count; null/0 on every tag created before this phase.
  description: string | null;
  postCount: number;
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
  // Phase 7 — usage count; 0 is a genuine "no posts yet", not a loading placeholder.
  postCount: number;
}

const contentUpdateBody = (payload: {
  title?: string;
  slug?: string;
  body?: string;
  excerpt?: string | null;
  metadata?: PostSeoMetadata;
  editorBlocks?: EditorDocument | null;
  status?: PatchableContentStatus;
  featuredMediaId?: string | null;
  templateId?: string | null;
  pageType?: PageTypeValue;
  isHomepage?: boolean;
  parentId?: string | null;
  expectedUpdatedAt?: string;
}) => payload;

// Phase 7 — bulk workflow action result: ids that succeeded, and per-id
// failures with the real error message (not a fabricated generic one),
// shared shape for both pagesApi and postsApi's bulk methods.
export interface BulkActionResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

export const pagesApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: ContentStatusValue;
      fromDate?: string;
      toDate?: string;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<CmsPage>("/pages", "pages", params),
  get: (id: string) => apiClient.get<{ page: CmsPage }>(`/pages/${id}`),
  revisions: (id: string) => apiClient.get<{ revisions: ContentRevision[] }>(`/pages/${id}/revisions`),
  create: (payload: {
    title: string;
    slug?: string;
    body?: string;
    excerpt?: string;
    metadata?: PostSeoMetadata;
    editorBlocks?: EditorDocument;
    featuredMediaId?: string;
    templateId?: string;
    pageType?: PageTypeValue;
    isHomepage?: boolean;
    parentId?: string;
  }) => apiClient.post<{ page: CmsPage }>("/pages", payload),
  update: (id: string, payload: Parameters<typeof contentUpdateBody>[0]) => apiClient.patch<{ page: CmsPage }>(`/pages/${id}`, contentUpdateBody(payload)),
  children: (id: string) => apiClient.get<{ children: { id: string; title: string; slug: string; status: string }[] }>(`/pages/${id}/children`),
  submitForReview: (id: string) => apiClient.post<{ page: CmsPage }>(`/pages/${id}/submit-review`),
  publish: (id: string) => apiClient.post<{ page: CmsPage }>(`/pages/${id}/publish`),
  schedule: (id: string, scheduledAt: string) => apiClient.post<{ page: CmsPage }>(`/pages/${id}/schedule`, { scheduledAt }),
  archive: (id: string) => apiClient.post<{ page: CmsPage }>(`/pages/${id}/archive`),
  revert: (id: string, revisionId: string) => apiClient.post<{ page: CmsPage }>(`/pages/${id}/revert`, { revisionId }),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/pages/${id}`),
  // Phase 7 — Trash view + bulk actions.
  trash: (params: { page?: number; limit?: number } = {}) => paginatedGet<CmsPage>("/pages/trash", "pages", params),
  restore: (id: string) => apiClient.post<{ message: string }>(`/pages/${id}/restore`),
  bulkArchive: (ids: string[]) => apiClient.post<BulkActionResult>("/pages/bulk/archive", { ids }),
  bulkTrash: (ids: string[]) => apiClient.post<BulkActionResult>("/pages/bulk/trash", { ids }),
  bulkRestore: (ids: string[]) => apiClient.post<BulkActionResult>("/pages/bulk/restore", { ids }),
};

// ---------------------------------------------------------------------------
// Phase 1 (Website module) — Templates + Template Parts.
// docs/control-center-replacement-roadmap.md.
// ---------------------------------------------------------------------------

export type TemplateWorkflowStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type TemplateTypeValue =
  | "HOMEPAGE"
  | "STANDARD_PAGE"
  | "BLOG_INDEX"
  | "SINGLE_POST"
  | "CATEGORY"
  | "TAG"
  | "SEARCH"
  | "ARCHIVE"
  | "AUTHOR"
  | "NOT_FOUND"
  | "PRODUCT"
  | "SERVICE"
  | "SOLUTION"
  | "CASE_STUDY"
  | "LANDING_PAGE";

export type TemplatePartTypeValue =
  | "HEADER"
  | "FOOTER"
  | "PRIMARY_NAVIGATION"
  | "MOBILE_HEADER"
  | "SIDEBAR"
  | "ANNOUNCEMENT_BAR"
  | "CTA_SECTION"
  | "NEWSLETTER_SECTION"
  | "CONTACT_SECTION"
  | "SOCIAL_SECTION";

// `structure` stays unconstrained JSON (server/schemas/templateSchemas.ts).
// Phase 4 (server/utils/templateStructure.ts) formalizes `regions` as an
// ORDERED array (`{key, templatePartId}[]`) rather than a plain object,
// since JSON object key order isn't guaranteed to round-trip through
// Postgres JSONB — needed for "reorder regions." The original Phase 2
// `Record<string,string>` shape is still accepted when reading (a
// template saved before this phase), just normalized on first edit.
export interface TemplateRegionEntry {
  key: string;
  templatePartId: string | null;
}
export interface TemplateStructure {
  regions?: TemplateRegionEntry[] | Record<string, string>;
  [key: string]: unknown;
}

/** Mirrors server/utils/templateStructure.ts's normalizeRegions — tolerates both the Phase 2 map shape and the Phase 4 ordered-array shape. */
export function normalizeTemplateRegions(structure: TemplateStructure | undefined | null): TemplateRegionEntry[] {
  const regions = structure?.regions;
  if (!regions) return [];
  if (Array.isArray(regions)) return regions;
  return Object.entries(regions).map(([key, templatePartId]) => ({ key, templatePartId }));
}

export interface TemplateRevision {
  id: string;
  templateId: string;
  version: number;
  status: TemplateWorkflowStatus;
  name: string;
  structure: TemplateStructure;
  createdById: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface Template {
  id: string;
  organizationId: string;
  type: TemplateTypeValue;
  name: string;
  slug: string;
  description: string | null;
  status: TemplateWorkflowStatus;
  isSystem: boolean;
  currentRevisionId: string | null;
  currentRevision: TemplateRevision | null;
  _count: { pages: number };
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TemplatePartRevision {
  id: string;
  templatePartId: string;
  version: number;
  status: TemplateWorkflowStatus;
  name: string;
  content: EditorDocument;
  createdById: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface TemplatePart {
  id: string;
  organizationId: string;
  type: TemplatePartTypeValue;
  name: string;
  slug: string;
  status: TemplateWorkflowStatus;
  isSystem: boolean;
  currentRevisionId: string | null;
  currentRevision: TemplatePartRevision | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const templatesApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: TemplateWorkflowStatus;
      type?: TemplateTypeValue;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<Template>("/templates", "templates", params),
  get: (id: string) => apiClient.get<{ template: Template }>(`/templates/${id}`),
  revisions: (id: string) => apiClient.get<{ revisions: TemplateRevision[] }>(`/templates/${id}/revisions`),
  create: (payload: { type: TemplateTypeValue; name: string; slug?: string; description?: string; structure?: TemplateStructure }) =>
    apiClient.post<{ template: Template }>("/templates", payload),
  update: (
    id: string,
    payload: Partial<{ name: string; slug: string; description: string | null; structure: TemplateStructure; expectedUpdatedAt: string }>
  ) => apiClient.patch<{ template: Template }>(`/templates/${id}`, payload),
  publish: (id: string) => apiClient.post<{ template: Template }>(`/templates/${id}/publish`),
  archive: (id: string) => apiClient.post<{ template: Template }>(`/templates/${id}/archive`),
  revert: (id: string, revisionId: string) => apiClient.post<{ template: Template }>(`/templates/${id}/revert`, { revisionId }),
  duplicate: (id: string, name?: string) => apiClient.post<{ template: Template }>(`/templates/${id}/duplicate`, name ? { name } : {}),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/templates/${id}`),
  usage: (id: string) => apiClient.get<{ pages: { id: string; title: string; slug: string; status: string }[] }>(`/templates/${id}/usage`),
  preview: (id: string) =>
    apiClient.get<{ template: Template; regions: { key: string; templatePartId: string | null; part: TemplatePart | null }[] }>(`/templates/${id}/preview`),
};

export const templatePartsApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: TemplateWorkflowStatus;
      type?: TemplatePartTypeValue;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<TemplatePart>("/template-parts", "templateParts", params),
  get: (id: string) => apiClient.get<{ templatePart: TemplatePart }>(`/template-parts/${id}`),
  revisions: (id: string) => apiClient.get<{ revisions: TemplatePartRevision[] }>(`/template-parts/${id}/revisions`),
  create: (payload: { type: TemplatePartTypeValue; name: string; slug?: string; content?: EditorDocument }) =>
    apiClient.post<{ templatePart: TemplatePart }>("/template-parts", payload),
  update: (id: string, payload: Partial<{ name: string; slug: string; content: EditorDocument; expectedUpdatedAt: string }>) =>
    apiClient.patch<{ templatePart: TemplatePart }>(`/template-parts/${id}`, payload),
  publish: (id: string) => apiClient.post<{ templatePart: TemplatePart }>(`/template-parts/${id}/publish`),
  archive: (id: string) => apiClient.post<{ templatePart: TemplatePart }>(`/template-parts/${id}/archive`),
  revert: (id: string, revisionId: string) => apiClient.post<{ templatePart: TemplatePart }>(`/template-parts/${id}/revert`, { revisionId }),
  duplicate: (id: string, name?: string) => apiClient.post<{ templatePart: TemplatePart }>(`/template-parts/${id}/duplicate`, name ? { name } : {}),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/template-parts/${id}`),
  usage: (id: string) =>
    apiClient.get<{
      templates: { id: string; name: string; slug: string; status: string }[];
      pages: { id: string; title: string; slug: string; status: string }[];
    }>(`/template-parts/${id}/usage`),
};

// ---------------------------------------------------------------------------
// Phase 5 (Navigation + Pages + Homepage) — Navigation Menus. Mirrors
// Templates/Template Parts' own draft/publish/revision/usage shape above.
// ---------------------------------------------------------------------------

export type NavigationMenuTypeValue = "PRIMARY" | "HEADER" | "FOOTER" | "MOBILE" | "CUSTOM";
export type MenuLinkType = "page" | "post" | "category" | "tag" | "product" | "custom";

export interface MenuItem {
  id: string;
  label: string;
  linkType: MenuLinkType;
  targetId?: string;
  url?: string;
  openInNewTab: boolean;
  children: MenuItem[];
}

export interface NavigationMenuRevision {
  id: string;
  navigationMenuId: string;
  version: number;
  status: TemplateWorkflowStatus;
  name: string;
  items: MenuItem[];
  createdById: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface NavigationMenu {
  id: string;
  organizationId: string;
  type: NavigationMenuTypeValue;
  name: string;
  slug: string;
  status: TemplateWorkflowStatus;
  isSystem: boolean;
  currentRevisionId: string | null;
  currentRevision: NavigationMenuRevision | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const navigationMenusApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: TemplateWorkflowStatus;
      type?: NavigationMenuTypeValue;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<NavigationMenu>("/navigation-menus", "navigationMenus", params),
  get: (id: string) => apiClient.get<{ navigationMenu: NavigationMenu }>(`/navigation-menus/${id}`),
  revisions: (id: string) => apiClient.get<{ revisions: NavigationMenuRevision[] }>(`/navigation-menus/${id}/revisions`),
  create: (payload: { type: NavigationMenuTypeValue; name: string; slug?: string; items?: MenuItem[] }) =>
    apiClient.post<{ navigationMenu: NavigationMenu }>("/navigation-menus", payload),
  update: (id: string, payload: Partial<{ name: string; slug: string; items: MenuItem[]; expectedUpdatedAt: string }>) =>
    apiClient.patch<{ navigationMenu: NavigationMenu }>(`/navigation-menus/${id}`, payload),
  publish: (id: string) => apiClient.post<{ navigationMenu: NavigationMenu }>(`/navigation-menus/${id}/publish`),
  archive: (id: string) => apiClient.post<{ navigationMenu: NavigationMenu }>(`/navigation-menus/${id}/archive`),
  revert: (id: string, revisionId: string) => apiClient.post<{ navigationMenu: NavigationMenu }>(`/navigation-menus/${id}/revert`, { revisionId }),
  duplicate: (id: string, name?: string) => apiClient.post<{ navigationMenu: NavigationMenu }>(`/navigation-menus/${id}/duplicate`, name ? { name } : {}),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/navigation-menus/${id}`),
  usage: (id: string) =>
    apiClient.get<{
      templateParts: { id: string; name: string; slug: string; status: string }[];
      pages: { id: string; title: string; slug: string; status: string }[];
    }>(`/navigation-menus/${id}/usage`),
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
      fromDate?: string;
      toDate?: string;
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
    excerpt?: string;
    metadata?: PostSeoMetadata;
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
      excerpt?: string | null;
      metadata?: PostSeoMetadata;
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
  // Phase 7 — Trash view + bulk actions.
  trash: (params: { page?: number; limit?: number } = {}) => paginatedGet<CmsPost>("/posts/trash", "posts", params),
  restore: (id: string) => apiClient.post<{ message: string }>(`/posts/${id}/restore`),
  bulkArchive: (ids: string[]) => apiClient.post<BulkActionResult>("/posts/bulk/archive", { ids }),
  bulkTrash: (ids: string[]) => apiClient.post<BulkActionResult>("/posts/bulk/trash", { ids }),
  bulkRestore: (ids: string[]) => apiClient.post<BulkActionResult>("/posts/bulk/restore", { ids }),
};

export const categoriesApi = {
  list: () => apiClient.get<{ categories: CmsCategory[] }>("/categories"),
  get: (id: string) => apiClient.get<{ category: CmsCategory }>(`/categories/${id}`),
  create: (payload: { name: string; slug?: string; description?: string; parentId?: string }) =>
    apiClient.post<{ category: CmsCategory }>("/categories", payload),
  update: (id: string, payload: Partial<{ name: string; slug: string; description: string | null; parentId: string | null }>) =>
    apiClient.patch<{ category: CmsCategory }>(`/categories/${id}`, payload),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/categories/${id}`),
};

export const tagsApi = {
  list: () => apiClient.get<{ tags: CmsTag[] }>("/tags"),
  get: (id: string) => apiClient.get<{ tag: CmsTag }>(`/tags/${id}`),
  create: (payload: { name: string; slug?: string; description?: string }) => apiClient.post<{ tag: CmsTag }>("/tags", payload),
  update: (id: string, payload: Partial<{ name: string; slug: string; description: string | null }>) =>
    apiClient.patch<{ tag: CmsTag }>(`/tags/${id}`, payload),
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
  getEmbedUrl: (id: string) => apiClient.get<{ url: string }>(`/media/${id}/embed-url`),
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

// ---------------------------------------------------------------------------
// Phase 5 — SEO Control Center: redirects + the rule-based SEO audit.
// ---------------------------------------------------------------------------
export interface CmsRedirect {
  id: string;
  organizationId: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  resourceType: string | null;
  resourceId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export const redirectsApi = {
  list: (params: { page?: number; limit?: number; search?: string; sort?: string; order?: "asc" | "desc" } = {}) =>
    paginatedGet<CmsRedirect>("/redirects", "redirects", params),
  get: (id: string) => apiClient.get<{ redirect: CmsRedirect }>(`/redirects/${id}`),
  create: (payload: { fromPath: string; toPath: string; statusCode?: 301 | 302 | 307 | 308 }) =>
    apiClient.post<{ redirect: CmsRedirect }>("/redirects", payload),
  update: (id: string, payload: Partial<{ toPath: string; statusCode: 301 | 302 | 307 | 308 }>) =>
    apiClient.patch<{ redirect: CmsRedirect }>(`/redirects/${id}`, payload),
  remove: (id: string) => apiClient.delete<{ message: string }>(`/redirects/${id}`),
};

export type SeoIssueSeverity = "critical" | "warning";
export interface SeoIssue {
  resourceType: "post" | "page";
  resourceId: string;
  resourceTitle: string;
  slug: string;
  status: string;
  severity: SeoIssueSeverity;
  code: string;
  message: string;
}

export const seoApi = {
  issues: () => apiClient.get<{ issues: SeoIssue[] }>("/seo/issues"),
};

// ---------------------------------------------------------------------------
// Phase 10 — Commercial/Billing (contracts, subscriptions, invoices,
// payments) & the read-only Client Portal. Every monetary field is the
// server's Decimal serialized as a string (e.g. "1290.5") — never parsed
// back into a JS number for calculation, only for display (docs/BILLING_ARCHITECTURE.md).
// ---------------------------------------------------------------------------

export type ContractStatusValue = "DRAFT" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "TERMINATED";
export type SubscriptionStatusValue = "DRAFT" | "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELLED" | "EXPIRED";
export type BillingCycleValue = "ONE_TIME" | "MONTHLY" | "QUARTERLY" | "ANNUAL";
export type InvoiceStatusValue = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID" | "CANCELLED";
export type PaymentMethodValue = "BANK_TRANSFER" | "CARD" | "CASH" | "CHEQUE" | "ONLINE" | "OTHER";
export type PaymentStatusValue = "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";

export interface ContractVariation {
  id: string;
  contractId: string;
  variationNumber: number;
  amount: string;
  effectiveDate: string;
  reason: string;
  createdById: string | null;
  createdAt: string;
}

export interface Contract {
  id: string;
  contractNumber: string;
  organizationId: string;
  clientId: string;
  title: string;
  description: string | null;
  status: ContractStatusValue;
  startDate: string;
  endDate: string | null;
  /** The original, never-overwritten contract value (§5) — see currentValue for the figure that includes variations. */
  contractValue: string;
  /** Computed on every read as contractValue + Σ(variations.amount) — never cached. */
  currentValue: string;
  currency: string;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  variations: ContractVariation[];
}

export interface SubscriptionItem {
  id: string;
  subscriptionId: string;
  productModuleId: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  subscriptionNumber: string;
  organizationId: string;
  clientId: string;
  productId: string;
  status: SubscriptionStatusValue;
  startDate: string;
  renewalDate: string | null;
  endDate: string | null;
  billingCycle: BillingCycleValue;
  quantity: number;
  price: string;
  currency: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancelledById: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  items: SubscriptionItem[];
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  productModuleId: string | null;
  description: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  lineTotal: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  organizationId: string;
  amount: string;
  currency: string;
  paymentDate: string;
  method: PaymentMethodValue;
  reference: string | null;
  status: PaymentStatusValue;
  notes: string | null;
  reversalReason: string | null;
  reversedAt: string | null;
  reversedById: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  organizationId: string;
  clientId: string;
  contractId: string | null;
  subscriptionId: string | null;
  status: InvoiceStatusValue;
  /** OVERDUE is never a stored status — this is status combined with dueDate, computed server-side on every read. */
  effectiveStatus: InvoiceStatusValue;
  issueDate: string;
  dueDate: string;
  currency: string;
  subtotal: string;
  tax: string;
  discount: string;
  total: string;
  amountPaid: string;
  amountDue: string;
  notes: string | null;
  voidReason: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItem[];
  payments: Payment[];
}

export interface InvoiceItemPayload {
  productModuleId?: string;
  description: string;
  quantity: number;
  unitPrice: string;
  discount?: string;
}

export const contractsApi = {
  list: (
    params: { page?: number; limit?: number; search?: string; status?: ContractStatusValue; clientId?: string; sort?: string; order?: "asc" | "desc" } = {}
  ) => paginatedGet<Contract>("/contracts", "contracts", params),
  get: (id: string) => apiClient.get<{ contract: Contract }>(`/contracts/${id}`),
  create: (payload: { clientId: string; title: string; description?: string; startDate: string; endDate?: string; contractValue: string; currency?: string; notes?: string }) =>
    apiClient.post<{ contract: Contract }>("/contracts", payload),
  update: (id: string, payload: Partial<{ title: string; description: string | null; endDate: string | null; notes: string | null }>) =>
    apiClient.patch<{ contract: Contract }>(`/contracts/${id}`, payload),
  activate: (id: string) => apiClient.post<{ contract: Contract }>(`/contracts/${id}/activate`),
  suspend: (id: string) => apiClient.post<{ contract: Contract }>(`/contracts/${id}/suspend`),
  terminate: (id: string, reason: string) => apiClient.post<{ contract: Contract }>(`/contracts/${id}/terminate`, { reason }),
  addVariation: (id: string, payload: { amount: string; effectiveDate: string; reason: string }) =>
    apiClient.post<{ contract: Contract }>(`/contracts/${id}/variations`, payload),
};

export const subscriptionsApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: SubscriptionStatusValue;
      clientId?: string;
      productId?: string;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<Subscription>("/subscriptions", "subscriptions", params),
  get: (id: string) => apiClient.get<{ subscription: Subscription }>(`/subscriptions/${id}`),
  create: (payload: {
    clientId: string;
    productId: string;
    startDate: string;
    billingCycle: BillingCycleValue;
    quantity?: number;
    price: string;
    currency?: string;
    items?: { productModuleId?: string; description: string; quantity?: number; unitPrice: string }[];
  }) => apiClient.post<{ subscription: Subscription }>("/subscriptions", payload),
  update: (id: string, payload: Partial<{ renewalDate: string | null; endDate: string | null; quantity: number; price: string }>) =>
    apiClient.patch<{ subscription: Subscription }>(`/subscriptions/${id}`, payload),
  activate: (id: string) => apiClient.post<{ subscription: Subscription }>(`/subscriptions/${id}/activate`),
  pause: (id: string) => apiClient.post<{ subscription: Subscription }>(`/subscriptions/${id}/pause`),
  cancel: (id: string, reason: string) => apiClient.post<{ subscription: Subscription }>(`/subscriptions/${id}/cancel`, { reason }),
};

export const invoicesApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: InvoiceStatusValue;
      clientId?: string;
      contractId?: string;
      subscriptionId?: string;
      dateFrom?: string;
      dateTo?: string;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<Invoice>("/invoices", "invoices", params),
  get: (id: string) => apiClient.get<{ invoice: Invoice }>(`/invoices/${id}`),
  create: (payload: {
    clientId: string;
    contractId?: string;
    subscriptionId?: string;
    issueDate: string;
    dueDate: string;
    currency?: string;
    discount?: string;
    tax?: string;
    notes?: string;
    items: InvoiceItemPayload[];
  }) => apiClient.post<{ invoice: Invoice }>("/invoices", payload),
  update: (id: string, payload: Partial<{ issueDate: string; dueDate: string; discount: string; tax: string; notes: string | null; items: InvoiceItemPayload[] }>) =>
    apiClient.patch<{ invoice: Invoice }>(`/invoices/${id}`, payload),
  issue: (id: string) => apiClient.post<{ invoice: Invoice }>(`/invoices/${id}/issue`, {}),
  void: (id: string, reason: string) => apiClient.post<{ invoice: Invoice }>(`/invoices/${id}/void`, { reason }),
  listPayments: (id: string) => apiClient.get<{ payments: Payment[] }>(`/invoices/${id}/payments`),
  recordPayment: (id: string, payload: { amount: string; currency?: string; paymentDate: string; method: PaymentMethodValue; reference?: string; notes?: string }) =>
    apiClient.post<{ payment: Payment }>(`/invoices/${id}/payments`, payload),
};

export const paymentsApi = {
  list: (
    params: {
      page?: number;
      limit?: number;
      status?: PaymentStatusValue;
      method?: PaymentMethodValue;
      invoiceId?: string;
      clientId?: string;
      dateFrom?: string;
      dateTo?: string;
      sort?: string;
      order?: "asc" | "desc";
    } = {}
  ) => paginatedGet<Payment>("/payments", "payments", params),
  get: (id: string) => apiClient.get<{ payment: Payment }>(`/payments/${id}`),
  reverse: (id: string, reason: string) => apiClient.post<{ payment: Payment }>(`/payments/${id}/reverse`, { reason }),
};

export interface ClientPortalDashboard {
  activeContractCount: number;
  activeSubscriptionCount: number;
  outstandingInvoiceCount: number;
  amountDue: string;
  currency: string | undefined;
  recentPayments: Payment[];
}

/** Read-only — the client portal never exposes create/update/issue/void/reverse (§25/§26). */
export const portalApi = {
  dashboard: () => apiClient.get<{ dashboard: ClientPortalDashboard }>("/portal/dashboard"),
  contracts: (params: { page?: number; limit?: number } = {}) => paginatedGet<Contract & { currentValue: string }>("/portal/contracts", "contracts", params),
  contract: (id: string) => apiClient.get<{ contract: Contract }>(`/portal/contracts/${id}`),
  subscriptions: (params: { page?: number; limit?: number } = {}) => paginatedGet<Subscription>("/portal/subscriptions", "subscriptions", params),
  subscription: (id: string) => apiClient.get<{ subscription: Subscription }>(`/portal/subscriptions/${id}`),
  invoices: (params: { page?: number; limit?: number; status?: InvoiceStatusValue } = {}) => paginatedGet<Invoice>("/portal/invoices", "invoices", params),
  invoice: (id: string) => apiClient.get<{ invoice: Invoice }>(`/portal/invoices/${id}`),
  payments: (params: { page?: number; limit?: number } = {}) => paginatedGet<Payment>("/portal/payments", "payments", params),
};
