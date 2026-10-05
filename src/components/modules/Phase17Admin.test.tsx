/** Phase 17 — admin UI: real-data rendering, permission gating, one-time secrets, dangerous-action confirmation, honest integration status. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdministrationPage } from "./AdministrationPage";
import { IntegrationsPage } from "./IntegrationsPage";
import { RolesPage } from "./RolesPage";
import { AuditLogPage } from "./AuditLogPage";

const m = {
  overview: vi.fn(), integrations: vi.fn(), webhooksList: vi.fn(), webhooksEvents: vi.fn(), webhooksCreate: vi.fn(), webhooksRotate: vi.fn(),
  keysList: vi.fn(), keysCreate: vi.fn(), keysRevoke: vi.fn(), rolesList: vi.fn(), rolesCreate: vi.fn(), rolesRemove: vi.fn(), permsList: vi.fn(),
  auditList: vi.fn(), auditActions: vi.fn(), auditGet: vi.fn(), integrationsSave: vi.fn(), integrationsTest: vi.fn(),
};

vi.mock("../../lib/api", () => ({
  adminApi: { overview: (...a: unknown[]) => m.overview(...a) },
  integrationsApi: { overview: (...a: unknown[]) => m.integrations(...a), save: (...a: unknown[]) => m.integrationsSave(...a), test: (...a: unknown[]) => m.integrationsTest(...a), clearSecret: vi.fn() },
  webhookEndpointsApi: {
    list: (...a: unknown[]) => m.webhooksList(...a), events: (...a: unknown[]) => m.webhooksEvents(...a), create: (...a: unknown[]) => m.webhooksCreate(...a),
    rotateSecret: (...a: unknown[]) => m.webhooksRotate(...a), update: vi.fn(), test: vi.fn(), remove: vi.fn(), deliveries: vi.fn(), retry: vi.fn(),
  },
  apiKeysApi: { list: (...a: unknown[]) => m.keysList(...a), create: (...a: unknown[]) => m.keysCreate(...a), revoke: (...a: unknown[]) => m.keysRevoke(...a) },
  rolesApi: { list: (...a: unknown[]) => m.rolesList(...a), create: (...a: unknown[]) => m.rolesCreate(...a), remove: (...a: unknown[]) => m.rolesRemove(...a), update: vi.fn(), setPermissions: vi.fn() },
  permissionsApi: { list: (...a: unknown[]) => m.permsList(...a) },
  auditLogsApi: { list: (...a: unknown[]) => m.auditList(...a), actions: (...a: unknown[]) => m.auditActions(...a), get: (...a: unknown[]) => m.auditGet(...a) },
}));

let mockPermissions: string[] = [];
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: "me", role: { key: "ADMIN", permissions: mockPermissions } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/", navigate: vi.fn() }) }));

afterEach(() => {
  cleanup();
  Object.values(m).forEach((fn) => fn.mockReset());
  mockPermissions = [];
});

const overview = {
  users: { total: 7, active: 5, invited: 1, disabled: 1, lockedNow: 2 },
  roles: { total: 6, custom: 1, distribution: [{ roleKey: "ADMIN", roleName: "Administrator", members: 2 }] },
  organizations: null,
  sessions: { active: 4, createdLast24h: 3 },
  security: { failedLogins24h: 9, lockoutsLast7d: 1, expiringApiKeys14d: 0 },
  recentActivity: [{ id: "a1", action: "ROLE_PERMISSIONS_CHANGED", actorName: "Sam", actorType: "USER", resourceType: "role", resourceId: "r1", result: "SUCCESS", createdAt: "2026-10-05T10:00:00.000Z", severity: "critical" }],
  integrations: { systemConfigured: 3, systemTotal: 6, configurableEnabled: 1, configurableFailing: 1, webhookEndpoints: { total: 2, enabled: 1, failedDeliveries24h: 4, retrying: 1 }, apiKeys: { active: 3 } },
};

describe("AdministrationPage", () => {
  it("renders the real figures returned by the API and the recent activity feed", async () => {
    m.overview.mockResolvedValue({ overview });
    render(<AdministrationPage />);
    expect(await screen.findByText("Administration")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument(); // total users
    expect(screen.getByText("9")).toBeInTheDocument(); // failed sign-ins
    expect(screen.getByText("3/6")).toBeInTheDocument();
    expect(screen.getByText("ROLE_PERMISSIONS_CHANGED")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
  });

  it("shows an error state instead of fabricated numbers when the API fails", async () => {
    m.overview.mockRejectedValue(new Error("boom"));
    render(<AdministrationPage />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});

const integrationsPayload = (integration: unknown) => ({
  system: [
    { key: "ai_gemini", name: "AI provider (Gemini)", category: "AI", managedBy: "environment", status: "not_configured", verified: false, detail: "GEMINI_API_KEY is not set.", lastSuccessAt: null, lastFailureAt: null, requires: ["GEMINI_API_KEY"] },
    { key: "cron", name: "Scheduled automation tick", category: "Automation", managedBy: "environment", status: "configured", verified: false, detail: "CRON_SECRET set.", lastSuccessAt: null, lastFailureAt: null, requires: [] },
  ],
  configurable: [{ provider: "custom_api", label: "Custom HTTP API", description: "An external HTTPS API.", configFields: [{ key: "baseUrl", label: "Base URL", required: true }], secretLabel: "API token", integration }],
  encryption: { source: "derived-from-session-secret" },
});

describe("IntegrationsPage", () => {
  it("never calls an integration connected unless verified, and masks credentials", async () => {
    mockPermissions = ["integrations.read"];
    m.integrations.mockResolvedValue(integrationsPayload({ id: "i1", provider: "custom_api", name: "x", enabled: true, config: { baseUrl: "https://api.example.com" }, hasSecret: true, secretLast4: "1234", status: "CONFIGURED", lastVerifiedAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null }));
    render(<IntegrationsPage />);
    expect(await screen.findByText("Configured — not verified")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    expect(screen.getByText("••••1234")).toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument(); // Gemini
    expect(screen.getByText(/Requires:/)).toHaveTextContent("GEMINI_API_KEY");
    // read-only caller: no way to change anything
    expect(screen.queryByRole("button", { name: /configure|edit configuration|test connection/i })).not.toBeInTheDocument();
  });

  it("shows failure details for a failing integration and offers management actions only with the manage permission", async () => {
    mockPermissions = ["integrations.read", "integrations.manage"];
    m.integrations.mockResolvedValue(integrationsPayload({ id: "i1", provider: "custom_api", name: "x", enabled: true, config: { baseUrl: "https://api.example.com" }, hasSecret: true, secretLast4: "1234", status: "FAILING", lastVerifiedAt: null, lastSuccessAt: null, lastFailureAt: "2026-10-05T10:00:00.000Z", lastError: "Endpoint responded with HTTP 500." }));
    render(<IntegrationsPage />);
    expect(await screen.findByText("Failing")).toBeInTheDocument();
    expect(screen.getByText("Endpoint responded with HTTP 500.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /test connection/i })).toBeInTheDocument();
  });

  it("shows a newly created webhook signing secret exactly once", async () => {
    mockPermissions = ["webhooks.read", "webhooks.manage"];
    m.webhooksList.mockResolvedValue({ endpoints: [] });
    m.webhooksEvents.mockResolvedValue({ events: [{ eventType: "lead.created", description: "d", sourceModule: "CRM" }] });
    m.webhooksCreate.mockResolvedValue({ endpoint: { id: "w1" }, secret: "whsec_ONLY_SHOWN_ONCE" });
    render(<IntegrationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /add endpoint/i }));
    fireEvent.change(await screen.findByLabelText(/^name/i), { target: { value: "CRM" } });
    fireEvent.change(screen.getByLabelText(/endpoint url/i), { target: { value: "https://example.com/hook" } });
    fireEvent.click(await screen.findByLabelText(/all events/i));
    fireEvent.click(screen.getByRole("button", { name: /create endpoint/i }));

    const secret = await screen.findByTestId("one-time-secret");
    expect(secret).toHaveTextContent("whsec_ONLY_SHOWN_ONCE");
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /i have saved it/i }));
    await waitFor(() => expect(screen.queryByTestId("one-time-secret")).not.toBeInTheDocument());
    expect(screen.queryByText("whsec_ONLY_SHOWN_ONCE")).not.toBeInTheDocument();
  });

  it("hides API-key management from a read-only user and never lists a key's secret", async () => {
    mockPermissions = ["api_keys.read"];
    m.keysList.mockResolvedValue({ apiKeys: [{ id: "k1", name: "Reporting", prefix: "artify_ak_ab12cd", scopes: ["leads.read"], expiresAt: null, revokedAt: null, lastUsedAt: null, createdAt: "2026-10-01T00:00:00.000Z", status: "active" }] });
    render(<IntegrationsPage />);
    expect(await screen.findByText("Reporting")).toBeInTheDocument();
    expect(screen.getByText(/artify_ak_ab12cd/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create api key/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revoke/i })).not.toBeInTheDocument();
  });

  it("requires confirmation before revoking an API key", async () => {
    mockPermissions = ["api_keys.read", "api_keys.manage"];
    m.keysList.mockResolvedValue({ apiKeys: [{ id: "k1", name: "Reporting", prefix: "artify_ak_ab12cd", scopes: ["leads.read"], expiresAt: null, revokedAt: null, lastUsedAt: null, createdAt: "2026-10-01T00:00:00.000Z", status: "active" }] });
    m.keysRevoke.mockResolvedValue({ apiKey: {} });
    render(<IntegrationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    expect(m.keysRevoke).not.toHaveBeenCalled(); // nothing happens until confirmed
    const dialog = await screen.findByText(/stops working immediately/i);
    fireEvent.click(within(dialog.closest("div")!.parentElement!).getByRole("button", { name: /revoke key/i }));
    await waitFor(() => expect(m.keysRevoke).toHaveBeenCalledWith("k1"));
  });
});

describe("RolesPage", () => {
  const roles = [
    { id: "r1", key: "ADMIN", name: "Administrator", isSystem: true, memberCount: 3, permissions: ["users.read"], description: null },
    { id: "r2", key: "CUSTOM_REVIEWER", name: "Reviewer", isSystem: false, memberCount: 0, permissions: ["content.read"], description: "Reviews content" },
  ];
  it("protects system roles and offers edit/delete only on custom roles to permitted users", async () => {
    mockPermissions = ["roles.read", "roles.create", "roles.update", "roles.delete"];
    m.rolesList.mockResolvedValue({ roles });
    m.permsList.mockResolvedValue({ permissions: [{ id: "p1", key: "content.read", name: "c", description: null, module: "content" }] });
    render(<RolesPage />);
    expect(await screen.findByText("Reviewer")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: /create role/i })).toBeInTheDocument();
  });

  it("offers no role-management controls without the permissions", async () => {
    mockPermissions = ["roles.read"];
    m.rolesList.mockResolvedValue({ roles });
    m.permsList.mockResolvedValue({ permissions: [] });
    render(<RolesPage />);
    expect(await screen.findByText("Reviewer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create role|edit|delete/i })).not.toBeInTheDocument();
  });

  it("requires explicit confirmation before a role can receive critical permissions", async () => {
    mockPermissions = ["roles.read", "roles.create"];
    m.rolesList.mockResolvedValue({ roles });
    m.permsList.mockResolvedValue({ permissions: [{ id: "p1", key: "security.manage", name: "s", description: null, module: "security" }] });
    m.rolesCreate.mockResolvedValue({ role: { id: "new", key: "CUSTOM_X" } });
    render(<RolesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /create role/i }));
    fireEvent.change(await screen.findByLabelText(/^name/i), { target: { value: "Security Lead" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /^security\.manage\s*critical$/i }));
    const submit = screen.getAllByRole("button", { name: "Create role" }).at(-1)!;
    expect(submit).toBeDisabled(); // critical permission selected, not yet confirmed
    fireEvent.click(screen.getByLabelText(/i understand/i));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(m.rolesCreate).toHaveBeenCalledWith(expect.objectContaining({ permissionKeys: ["security.manage"], confirmCritical: true })));
  });
});

describe("AuditLogPage", () => {
  const entry = { id: "e1", organizationId: "o", actorUserId: "u", actorName: "Sam", actorType: "USER", action: "ROLE_DELETED", resourceType: "role", resourceId: "r9", result: "SUCCESS", ipAddress: "1.2.3.4", userAgent: "UA", createdAt: "2026-10-05T10:00:00.000Z", severity: "critical" };
  it("searches and filters server-side, and drills into an event's detail", async () => {
    m.auditActions.mockResolvedValue({ actions: ["ROLE_DELETED"] });
    m.auditList.mockResolvedValue({ items: [entry], page: 1, limit: 25, total: 1, totalPages: 1 });
    m.auditGet.mockResolvedValue({ auditLog: { ...entry, beforeData: { name: "Old role" }, afterData: null, requestId: "req-1" } });
    render(<AuditLogPage />);
    expect(await screen.findByText("ROLE_DELETED", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search audit log"), { target: { value: "role" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(m.auditList).toHaveBeenLastCalledWith(expect.objectContaining({ q: "role" })));

    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "critical" } });
    await waitFor(() => expect(m.auditList).toHaveBeenLastCalledWith(expect.objectContaining({ severity: "critical", page: 1 })));

    fireEvent.click(await screen.findByText("ROLE_DELETED", { selector: "td" }));
    expect(await screen.findByText(/Old role/)).toBeInTheDocument();
    expect(screen.getByText("req-1")).toBeInTheDocument();
  });

  it("offers no edit or delete controls", async () => {
    m.auditActions.mockResolvedValue({ actions: [] });
    m.auditList.mockResolvedValue({ items: [entry], page: 1, limit: 25, total: 1, totalPages: 1 });
    render(<AuditLogPage />);
    await screen.findByText("ROLE_DELETED", { selector: "td" });
    expect(screen.queryByRole("button", { name: /edit|delete|remove/i })).not.toBeInTheDocument();
  });
});
