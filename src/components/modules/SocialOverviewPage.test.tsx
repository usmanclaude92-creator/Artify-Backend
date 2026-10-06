import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const listMock = vi.fn();
const navigateMock = vi.fn();
vi.mock("../../lib/api", () => ({ socialApi: { list: () => listMock() } }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/social", navigate: navigateMock }) }));
const user = { role: { permissions: ["social.read"] } };
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } }) }));

import { SocialOverviewPage } from "./SocialOverviewPage";

const account = (over: Record<string, unknown> = {}) => ({
  id: "a1", provider: "mock", externalAccountId: "mock-a", displayName: "Mock A", handle: "@mock_a", avatarUrl: null, accountType: "PAGE", status: "CONNECTED",
  scopes: [], tokenExpiresAt: new Date(Date.now() + 40 * 86400_000).toISOString(), lastSyncAt: new Date().toISOString(), lastError: null, createdAt: "", updatedAt: "", ...over,
});

afterEach(() => {
  cleanup();
  listMock.mockReset();
  navigateMock.mockReset();
});

describe("SocialOverviewPage", () => {
  it("shows an empty state when nothing is connected", async () => {
    listMock.mockResolvedValue({ accounts: [], providers: [] });
    render(<SocialOverviewPage />);
    expect(await screen.findByText("No social accounts connected")).toBeInTheDocument();
  });

  it("summarises status counts and lists warnings", async () => {
    listMock.mockResolvedValue({
      accounts: [account(), account({ id: "a2", displayName: "Needs Help", status: "NEEDS_REAUTH", lastError: "Token rejected" }), account({ id: "a3", displayName: "Soon", tokenExpiresAt: new Date(Date.now() + 2 * 86400_000).toISOString() })],
      providers: [],
    });
    render(<SocialOverviewPage />);
    expect(await screen.findByText("2 accounts need attention")).toBeInTheDocument();
    expect(screen.getByText(/Token rejected/)).toBeInTheDocument();
    expect(screen.getByText(/token expires within 7 days/)).toBeInTheDocument();
    expect(screen.getByText("Needs reconnect", { selector: "p" }).nextElementSibling).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: /Manage accounts/ }));
    expect(navigateMock).toHaveBeenCalledWith("/social/accounts");
  });

  it("shows a healthy message and an error state", async () => {
    listMock.mockResolvedValueOnce({ accounts: [account()], providers: [] });
    const first = render(<SocialOverviewPage />);
    expect(await screen.findByText("All connections look healthy")).toBeInTheDocument();
    first.unmount();
    listMock.mockRejectedValueOnce(new Error("boom"));
    render(<SocialOverviewPage />);
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
