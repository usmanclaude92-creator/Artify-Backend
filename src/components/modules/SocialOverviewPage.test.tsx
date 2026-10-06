import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const listMock = vi.fn();
const navigateMock = vi.fn();
const metricsMock = vi.fn();
vi.mock("../../lib/api", () => ({ socialApi: { list: () => listMock() }, socialPublishingApi: { metrics: () => metricsMock() } }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/social", navigate: navigateMock }) }));
const user = { role: { permissions: ["social.read"] } };
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } }) }));

import { SocialOverviewPage } from "./SocialOverviewPage";

const account = (over: Record<string, unknown> = {}) => ({
  id: "a1", provider: "mock", externalAccountId: "mock-a", displayName: "Mock A", handle: "@mock_a", avatarUrl: null, accountType: "PAGE", status: "CONNECTED",
  scopes: [], tokenExpiresAt: new Date(Date.now() + 40 * 86400_000).toISOString(), lastSyncAt: new Date().toISOString(), lastError: null, createdAt: "", updatedAt: "", ...over,
});

beforeEach(() => metricsMock.mockRejectedValue(new Error("metrics unavailable")));
afterEach(() => {
  cleanup();
  listMock.mockReset();
  navigateMock.mockReset();
  metricsMock.mockReset();
});

describe("SocialOverviewPage", () => {
  it("shows publishing health with the oldest due-but-unpublished figure, and survives a metrics failure", async () => {
    listMock.mockResolvedValue({ accounts: [account()], providers: [] });
    metricsMock.mockResolvedValue({ queued: 3, needsAttention: 2, oldestDueAt: "x", oldestDueSeconds: 1500, last24h: { published: 7, failed: 1, retried: 2, uncertain: 0, dryRun: 0 } });
    const first = render(<SocialOverviewPage />);
    expect(await screen.findByText("25 min overdue")).toBeInTheDocument();
    expect(screen.getByText("Published", { selector: "p" }).nextElementSibling).toHaveTextContent("7");
    fireEvent.click(screen.getByRole("button", { name: /2 publishes need attention/ }));
    expect(navigateMock).toHaveBeenCalledWith("/social/failures");
    first.unmount();
    metricsMock.mockRejectedValue(new Error("nope"));
    render(<SocialOverviewPage />);
    expect(await screen.findByText("All connections look healthy")).toBeInTheDocument();
    expect(screen.queryByLabelText("Publishing health")).toBeNull();
  });

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
