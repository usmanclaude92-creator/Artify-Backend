import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { api, notifyMock } = vi.hoisted(() => ({
  api: { list: vi.fn(), startConnect: vi.fn(), completeConnect: vi.fn(), selectPages: vi.fn(), providerSetup: vi.fn(), reconnect: vi.fn(), disconnect: vi.fn(), checkHealth: vi.fn() },
  notifyMock: vi.fn(),
}));
let perms = ["social.read", "social.accounts.manage"];
vi.mock("../../lib/api", () => ({ socialApi: api }));
vi.mock("../../lib/apiClient", () => ({ ApiClientError: class extends Error {} }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: perms } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } }) }));

import { SocialAccountsPage } from "./SocialAccountsPage";

const providers = (configured: boolean) => [{ key: "meta_facebook", label: "Facebook Pages", configured, available: configured }, { key: "linkedin", label: "LinkedIn", configured: false, available: false }];
const setup = { provider: "meta_facebook", label: "Facebook Pages", configured: true, appMode: "development", apiVersion: "v25.0", redirectUri: "https://cc.example/social/accounts", webhookCallbackUrl: "https://cc.example/api/v1/social/webhooks/meta_facebook", verifyTokenConfigured: true, verifyTokenEnvVar: "META_WEBHOOK_VERIFY_TOKEN",
  permissions: [{ name: "pages_manage_posts", required: true }, { name: "pages_messaging", required: false }], webhookFields: ["feed", "messages"], envVars: [{ name: "META_APP_ID", set: true }, { name: "META_WEBHOOK_VERIFY_TOKEN", set: false }], notes: ["While the app is in Development mode only people with a role on the app can connect Pages."] };
const pages = [
  { externalId: "P1", name: "Artify Official", category: "Software", avatarUrl: null, tasks: ["CREATE_CONTENT"], warnings: [], alreadyConnected: false },
  { externalId: "P2", name: "Artify Outlet", category: "Retail", avatarUrl: null, tasks: ["ANALYZE"], warnings: ["You can't publish posts to this Page (needs the Create content task)."], alreadyConnected: true },
];
const assignMock = vi.fn();

beforeEach(() => {
  perms = ["social.read", "social.accounts.manage"];
  api.list.mockResolvedValue({ accounts: [], providers: providers(true) });
  Object.defineProperty(window, "location", { value: { ...window.location, assign: assignMock, search: "" }, writable: true });
  window.history.replaceState = vi.fn();
});
afterEach(() => { cleanup(); Object.values(api).forEach((m) => m.mockReset()); notifyMock.mockReset(); assignMock.mockReset(); });

describe("Facebook on Connected Accounts", () => {
  it("shows Facebook Pages as ready to connect when it is configured, and not otherwise", async () => {
    render(<SocialAccountsPage />);
    expect(await screen.findByRole("button", { name: "Connect Facebook Pages" })).toBeEnabled();
    cleanup();
    api.list.mockResolvedValue({ accounts: [], providers: providers(false) });
    render(<SocialAccountsPage />);
    await screen.findByText("Facebook Pages");
    expect(screen.queryByRole("button", { name: "Connect Facebook Pages" })).toBeNull();
  });

  it("the Facebook Page setup panel lists the Meta app settings, mode and secret status without secret values", async () => {
    api.providerSetup.mockResolvedValue(setup);
    render(<SocialAccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Facebook Page setup/ }));
    expect(await screen.findByText("https://cc.example/social/accounts")).toBeInTheDocument();
    expect(screen.getByText("https://cc.example/api/v1/social/webhooks/meta_facebook")).toBeInTheDocument();
    expect(screen.getByText("Development mode")).toBeInTheDocument();
    expect(screen.getByText(/Graph API v25.0/)).toBeInTheDocument();
    expect(screen.getByText("pages_manage_posts · required")).toBeInTheDocument();
    expect(screen.getByText("pages_messaging")).toBeInTheDocument();
    expect(screen.getByText(/Paste the value of/)).toHaveTextContent("META_WEBHOOK_VERIFY_TOKEN");
    expect(screen.getAllByText("META_WEBHOOK_VERIFY_TOKEN", { selector: "code" }).length).toBe(2); // in the guidance and the environment checklist (shown unset)
  });

  it("hides the setup panel from people who cannot manage accounts", async () => {
    perms = ["social.read"];
    render(<SocialAccountsPage />);
    await screen.findByText("Facebook Pages");
    expect(screen.queryByRole("button", { name: /Facebook Page setup/ })).toBeNull();
    expect(api.providerSetup).not.toHaveBeenCalled();
  });

  it("after OAuth shows a Page picker; connecting needs a choice and sends only the chosen Pages", async () => {
    Object.defineProperty(window, "location", { value: { ...window.location, assign: assignMock, search: "?state=st_abc_123456&code=thecode" }, writable: true });
    api.completeConnect.mockResolvedValue({ selection: { id: "sel1", provider: "meta_facebook", pages } });
    api.selectPages.mockResolvedValue({ accounts: [{ id: "a1" }], warnings: ["Artify Official: Could not subscribe this Page to webhooks."] });
    render(<SocialAccountsPage />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Already connected")).toBeInTheDocument();
    expect(screen.getByText(/needs the Create content task/)).toBeInTheDocument();
    const connect = screen.getByRole("button", { name: /Connect\s*selected/ });
    expect(connect).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Connect Artify Official"));
    expect(connect).toBeEnabled();
    fireEvent.click(connect);
    await waitFor(() => expect(api.selectPages).toHaveBeenCalledWith("sel1", ["P1"]));
    expect(notifyMock).toHaveBeenCalledWith("1 Page connected.", "success");
    expect(notifyMock).toHaveBeenCalledWith("Artify Official: Could not subscribe this Page to webhooks.", "error"); // webhook warnings are surfaced
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("preselects the only Page, and a direct connection (reconnect) skips the picker", async () => {
    Object.defineProperty(window, "location", { value: { ...window.location, assign: assignMock, search: "?state=st_abc_123456&code=c" }, writable: true });
    api.completeConnect.mockResolvedValueOnce({ selection: { id: "sel2", provider: "meta_facebook", pages: [pages[0]] } });
    render(<SocialAccountsPage />);
    expect(await screen.findByLabelText("Connect Artify Official", {}, { timeout: 4000 })).toBeChecked();
    cleanup();
    api.completeConnect.mockResolvedValueOnce({ account: { id: "a1", displayName: "Artify Official" }, warnings: ["Webhooks failed"] });
    Object.defineProperty(window, "location", { value: { ...window.location, assign: assignMock, search: "?state=st_abc_654321&code=c" }, writable: true });
    render(<SocialAccountsPage />);
    await waitFor(() => expect(notifyMock).toHaveBeenCalledWith("Artify Official connected.", "success"), { timeout: 4000 });
    expect(notifyMock).toHaveBeenCalledWith("Webhooks failed", "error");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
