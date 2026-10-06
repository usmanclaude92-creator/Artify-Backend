import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { api, notifyMock } = vi.hoisted(() => ({
  api: { list: vi.fn(), startConnect: vi.fn(), completeConnect: vi.fn(), reconnect: vi.fn(), disconnect: vi.fn(), checkHealth: vi.fn() },
  notifyMock: vi.fn(),
}));
let perms = ["social.read", "social.accounts.manage"];
vi.mock("../../lib/api", () => ({ socialApi: api }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: perms } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } }) }));

import { SocialAccountsPage } from "./SocialAccountsPage";

const providers = [
  { key: "meta", label: "Facebook & Instagram (Meta)", configured: false, available: false },
  { key: "linkedin", label: "LinkedIn", configured: false, available: false },
  { key: "mock", label: "Mock Network (dev/test)", configured: true, available: true },
];
const account = (over: Record<string, unknown> = {}) => ({
  id: "a1", provider: "mock", externalAccountId: "mock-a", displayName: "Mock A", handle: "@mock_a", avatarUrl: null, accountType: "PAGE", status: "CONNECTED",
  scopes: [], tokenExpiresAt: new Date(Date.now() + 40 * 86400_000).toISOString(), lastSyncAt: new Date(Date.now() - 2 * 3600_000).toISOString(), lastError: null, createdAt: "", updatedAt: "", ...over,
});

const assignMock = vi.fn();
beforeEach(() => {
  perms = ["social.read", "social.accounts.manage"];
  Object.defineProperty(window, "location", { value: { ...window.location, assign: assignMock, search: "" }, writable: true });
  window.history.replaceState = vi.fn();
});
afterEach(() => {
  cleanup();
  Object.values(api).forEach((m) => m.mockReset());
  notifyMock.mockReset();
  assignMock.mockReset();
});

describe("SocialAccountsPage", () => {
  it("lists providers: Connect for available ones, 'Not configured' otherwise", async () => {
    api.list.mockResolvedValue({ accounts: [], providers });
    render(<SocialAccountsPage />);
    expect(await screen.findByRole("button", { name: "Connect Mock Network (dev/test)" })).toBeInTheDocument();
    expect(screen.getAllByText("Not configured")).toHaveLength(4); // 2 badges + 2 captions
    expect(screen.queryByRole("button", { name: /Connect Facebook/ })).toBeNull();
  });

  it("explains how to connect when there are no accounts", async () => {
    api.list.mockResolvedValue({ accounts: [], providers });
    render(<SocialAccountsPage />);
    expect(await screen.findByText("No accounts connected yet")).toBeInTheDocument();
  });

  it("starts the OAuth flow and redirects to the provider URL", async () => {
    api.list.mockResolvedValue({ accounts: [], providers });
    api.startConnect.mockResolvedValue({ authUrl: "https://provider.example/auth?state=abc" });
    render(<SocialAccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Mock Network (dev/test)" }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("https://provider.example/auth?state=abc"));
    expect(api.startConnect).toHaveBeenCalledWith("mock");
  });

  it("renders account cards with status, last sync and warnings", async () => {
    api.list.mockResolvedValue({
      accounts: [account(), account({ id: "a2", displayName: "Stale Page", status: "NEEDS_REAUTH", lastError: "Token rejected by provider" })],
      providers,
    });
    render(<SocialAccountsPage />);
    expect(await screen.findByText("Mock A")).toBeInTheDocument();
    expect(screen.getByText("Connected", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Needs reconnect", { selector: "span" })).toBeInTheDocument();
    expect(screen.getAllByText(/Last sync 2h ago/)).toHaveLength(2);
    expect(screen.getByText("Token rejected by provider")).toBeInTheDocument();
  });

  it("disconnect asks for confirmation first, then calls the API", async () => {
    api.list.mockResolvedValue({ accounts: [account()], providers });
    api.disconnect.mockResolvedValue({ account: account({ status: "DISCONNECTED" }) });
    render(<SocialAccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Disconnect/ }));
    expect(api.disconnect).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Disconnect Mock A?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(api.disconnect).toHaveBeenCalledWith("a1"));
    expect(await screen.findByText("Disconnected", { selector: "span" })).toBeInTheDocument();
  });

  it("reconnect starts the flow for that account; check now updates status", async () => {
    api.list.mockResolvedValue({ accounts: [account({ status: "NEEDS_REAUTH", lastError: "x" })], providers });
    api.reconnect.mockResolvedValue({ authUrl: "https://provider.example/re" });
    api.checkHealth.mockResolvedValue({ account: account() });
    render(<SocialAccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Check now/ }));
    await waitFor(() => expect(api.checkHealth).toHaveBeenCalledWith("a1"));
    fireEvent.click(await screen.findByRole("button", { name: /Reconnect/ }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("https://provider.example/re"));
  });

  it("completes the OAuth return (?state&code) once and cleans the URL", async () => {
    api.list.mockResolvedValue({ accounts: [], providers });
    api.completeConnect.mockResolvedValue({ account: account() });
    Object.defineProperty(window, "location", { value: { ...window.location, assign: assignMock, search: "?state=art_oauth_x&code=mock_demo" }, writable: true });
    render(<SocialAccountsPage />);
    await waitFor(() => expect(api.completeConnect).toHaveBeenCalledWith({ state: "art_oauth_x", code: "mock_demo", error: undefined }));
    expect(window.history.replaceState).toHaveBeenCalledWith({}, "", "/social/accounts");
    await waitFor(() => expect(notifyMock).toHaveBeenCalledWith("Mock A connected.", "success"));
    expect(api.completeConnect).toHaveBeenCalledTimes(1);
  });

  it("read-only users see accounts but no Connect/Reconnect/Disconnect controls", async () => {
    perms = ["social.read"];
    api.list.mockResolvedValue({ accounts: [account()], providers });
    render(<SocialAccountsPage />);
    expect(await screen.findByText("Mock A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Mock Network (dev/test)" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Disconnect/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Reconnect/ })).toBeNull();
    expect(screen.getByText(/need the .*manage social accounts.* permission/i)).toBeInTheDocument();
  });

  it("shows an error state when loading fails", async () => {
    api.list.mockRejectedValue(new Error("nope"));
    render(<SocialAccountsPage />);
    expect(await screen.findByText("nope")).toBeInTheDocument();
  });
});
