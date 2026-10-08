import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const listMock = vi.fn();
const navigateMock = vi.fn();
const metricsMock = vi.fn();
const inboxMock = vi.fn();
const analyticsMock = vi.fn();
vi.mock("../../lib/api", () => ({ socialApi: { list: () => listMock() }, socialPublishingApi: { metrics: () => metricsMock() }, socialInboxApi: { metrics: () => inboxMock() }, socialAnalyticsApi: { summary: () => analyticsMock() } }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/social", navigate: navigateMock }) }));
const user = { role: { permissions: ["social.read"] as string[] } };
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } }) }));

import { SocialOverviewPage } from "./SocialOverviewPage";

const account = (over: Record<string, unknown> = {}) => ({
  id: "a1", provider: "mock", externalAccountId: "mock-a", displayName: "Mock A", handle: "@mock_a", avatarUrl: null, accountType: "PAGE", status: "CONNECTED",
  scopes: [], tokenExpiresAt: new Date(Date.now() + 40 * 86400_000).toISOString(), lastSyncAt: new Date().toISOString(), lastError: null, createdAt: "", updatedAt: "", ...over,
});

beforeEach(() => { metricsMock.mockRejectedValue(new Error("metrics unavailable")); inboxMock.mockRejectedValue(new Error("inbox unavailable")); });
afterEach(() => {
  cleanup();
  listMock.mockReset();
  navigateMock.mockReset();
  metricsMock.mockReset();
  inboxMock.mockReset();
  analyticsMock.mockReset();
  user.role.permissions = ["social.read"];
});

describe("SocialOverviewPage", () => {
  it("shows inbox open/overdue counts and the median first-response time", async () => {
    listMock.mockResolvedValue({ accounts: [account()], providers: [] });
    inboxMock.mockResolvedValue({ open: 12, overdue: 3, unassigned: 5, medianFirstResponseMs: 25 * 60_000, answeredLast30d: 40 });
    render(<SocialOverviewPage />);
    expect(await screen.findByText("25m")).toBeInTheDocument();
    expect(screen.getByText("Overdue", { selector: "p" }).nextElementSibling).toHaveTextContent("3");
    fireEvent.click(screen.getByRole("button", { name: /Open inbox/ }));
    expect(navigateMock).toHaveBeenCalledWith("/social/inbox");
  });

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

  describe("performance card (social.analytics.read)", () => {
    const k = (metric: string, label: string, current: number | null, over: Record<string, unknown> = {}) => ({ metric, label, kind: "flow", description: "", current, previous: null, daysWithData: current === null ? 0 : 28, daysInRange: 28, previousDaysWithData: 0, changePct: null, compareNote: null, netChange: null, series: [], unavailableReason: "No data has been collected for this period yet.", ...over });
    const acct = (headline: unknown[], over: Record<string, unknown> = {}) => ({ id: "ig", provider: "meta_instagram", displayName: "QA_TEST_2026_ IG", analytics: "supported", headline, ...over });
    const summary = (accounts: unknown[]) => ({ range: { from: "a", to: "b" }, previous: { from: "c", to: "d" }, days: 28, accounts, aiAvailable: false });

    it("is not requested or shown without the permission", async () => {
      listMock.mockResolvedValue({ accounts: [account()], providers: [] });
      render(<SocialOverviewPage />);
      await screen.findByText("All connections look healthy");
      expect(analyticsMock).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Performance")).toBeNull();
    });

    it("shows real numbers with '—' for missing ones and day coverage for partial data", async () => {
      user.role.permissions = ["social.read", "social.analytics.read"];
      listMock.mockResolvedValue({ accounts: [account()], providers: [] });
      analyticsMock.mockResolvedValue(summary([acct([k("followers", "Followers", 1234, { kind: "level" }), k("reach", "Reach", 250, { daysWithData: 3 }), k("views", "Views", null), k("engagement", "Engagement", 21)])]));
      render(<SocialOverviewPage />);
      const card = await screen.findByLabelText("Performance");
      expect(within(card).getByText("1,234")).toBeInTheDocument();
      expect(within(card).getByText("250")).toBeInTheDocument();
      expect(within(card).getByText("3/28 days")).toBeInTheDocument();
      expect(within(card).getByText("—")).toBeInTheDocument();
      fireEvent.click(within(card).getByRole("button", { name: /Open analytics/ }));
      expect(navigateMock).toHaveBeenCalledWith("/social/analytics");
    });

    it("shows an honest empty state instead of zeros when nothing has been collected", async () => {
      user.role.permissions = ["social.read", "social.analytics.read"];
      listMock.mockResolvedValue({ accounts: [account()], providers: [] });
      analyticsMock.mockResolvedValue(summary([acct([k("followers", "Followers", null), k("reach", "Reach", null)])]));
      render(<SocialOverviewPage />);
      expect(await screen.findByText(/No analytics have been collected yet/)).toBeInTheDocument();
      expect(within(screen.getByLabelText("Performance")).queryByText("0")).toBeNull();
    });

    it("says so when no connected network provides analytics, and survives a failure", async () => {
      user.role.permissions = ["social.read", "social.analytics.read"];
      listMock.mockResolvedValue({ accounts: [account()], providers: [] });
      analyticsMock.mockResolvedValue(summary([acct([], { analytics: "unsupported", provider: "linkedin" })]));
      const first = render(<SocialOverviewPage />);
      expect(await screen.findByText(/None of the connected networks provides analytics/)).toBeInTheDocument();
      first.unmount();
      analyticsMock.mockRejectedValue(new Error("nope"));
      render(<SocialOverviewPage />);
      expect(await screen.findByText("All connections look healthy")).toBeInTheDocument();
      expect(screen.queryByLabelText("Performance")).toBeNull();
    });
  });
});
