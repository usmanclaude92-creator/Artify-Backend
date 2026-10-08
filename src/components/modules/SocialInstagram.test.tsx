import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { api, notifyMock } = vi.hoisted(() => ({
  api: { list: vi.fn(), startConnect: vi.fn(), completeConnect: vi.fn(), selectPages: vi.fn(), providerSetup: vi.fn(), reconnect: vi.fn(), disconnect: vi.fn(), checkHealth: vi.fn() },
  notifyMock: vi.fn(),
}));
vi.mock("../../lib/api", () => ({ socialApi: api }));
vi.mock("../../lib/apiClient", () => ({ ApiClientError: class extends Error {} }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: ["social.read", "social.accounts.manage"] } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } }) }));

import { SocialAccountsPage } from "./SocialAccountsPage";

const providers = [{ key: "meta_facebook", label: "Facebook Pages", configured: true, available: true }, { key: "meta_instagram", label: "Instagram", configured: true, available: true }];
const setup = {
  provider: "meta_instagram", label: "Instagram", configured: true, appMode: "development", apiVersion: "v25.0", redirectUri: "https://cc.example/social/accounts",
  webhookCallbackUrl: "https://cc.example/api/v1/social/webhooks/meta_instagram", verifyTokenConfigured: true, verifyTokenEnvVar: "META_WEBHOOK_VERIFY_TOKEN", webhookObject: "instagram", webhookFields: ["comments", "messages"],
  prerequisites: ["The Instagram account is a Business or Creator (professional) account, not a personal one.", "It is linked to a Facebook Page, and you manage that Page."], dailyPublishLimit: 50,
  permissions: [{ name: "instagram_content_publish", required: true }, { name: "instagram_manage_messages", required: false }], envVars: [{ name: "META_APP_ID", set: true }], notes: ["Publishing needs a JPEG image."],
};

beforeEach(() => {
  api.list.mockResolvedValue({ accounts: [], providers });
  Object.defineProperty(window, "location", { value: { ...window.location, assign: vi.fn(), search: "" }, writable: true });
  window.history.replaceState = vi.fn();
});
afterEach(() => { cleanup(); Object.values(api).forEach((m) => m.mockReset()); notifyMock.mockReset(); });

describe("Instagram on Connected Accounts", () => {
  it("offers Connect Instagram and an Instagram setup panel with prerequisites, object, fields and the daily limit", async () => {
    api.providerSetup.mockResolvedValue(setup);
    render(<SocialAccountsPage />);
    expect(await screen.findByRole("button", { name: "Connect Instagram" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Instagram setup/ }));
    expect(await screen.findByText(/Business or Creator/)).toBeInTheDocument();
    expect(screen.getByText(/linked to a Facebook Page/)).toBeInTheDocument();
    expect(screen.getByText("https://cc.example/api/v1/social/webhooks/meta_instagram")).toBeInTheDocument();
    expect(screen.getByText("Webhook fields (instagram object)")).toBeInTheDocument();
    expect(screen.getByText("comments, messages")).toBeInTheDocument();
    expect(screen.getByText(/50 posts per 24 hours/)).toBeInTheDocument();
    expect(screen.getByText("instagram_content_publish · required")).toBeInTheDocument();
    expect(api.providerSetup).toHaveBeenCalledWith("meta_instagram");
  });

  it("the account picker talks about Instagram accounts, not Pages", async () => {
    Object.defineProperty(window, "location", { value: { ...window.location, assign: vi.fn(), search: "?state=st_abc_123456&code=thecode" }, writable: true });
    api.completeConnect.mockResolvedValue({ selection: { id: "sel1", provider: "meta_instagram", pages: [{ externalId: "IG1", name: "Artify (@artify)", avatarUrl: null, tasks: [], warnings: ["Direct messages are unavailable."], alreadyConnected: false }] } });
    render(<SocialAccountsPage />);
    expect(await screen.findByText("Choose Instagram accounts to connect")).toBeInTheDocument();
    expect(screen.getByText(/linked to a Facebook Page you manage/)).toBeInTheDocument();
    expect(screen.getByText("Direct messages are unavailable.")).toBeInTheDocument();
  });
});
