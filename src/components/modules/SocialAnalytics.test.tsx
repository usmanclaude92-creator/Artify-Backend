import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { api, notifyMock, navigateMock } = vi.hoisted(() => ({
  api: { summary: vi.fn(), account: vi.fn(), posts: vi.fn(), audience: vi.fn(), bestTimes: vi.fn(), post: vi.fn(), aiSummary: vi.fn(), refresh: vi.fn(), downloadCsv: vi.fn() },
  notifyMock: vi.fn(), navigateMock: vi.fn(),
}));
let perms = ["social.read", "social.analytics.read"];
vi.mock("../../lib/api", () => ({ socialAnalyticsApi: api }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: perms } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/social/analytics", navigate: navigateMock }) }));

import { SocialAnalyticsPage } from "./SocialAnalyticsPage";
import { SocialAudiencePage } from "./SocialAudiencePage";

const sync = { firstSyncAt: "2026-10-08T10:00:00Z", lastRunAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), lastError: null, backfillFrom: "2026-09-08", historyLimitDays: 30 };
const meta = (over: Record<string, unknown> = {}) => ({ id: "ig", provider: "meta_instagram", displayName: "QA_TEST_2026_ IG", handle: "@qa", avatarUrl: null, accountType: "BUSINESS", status: "CONNECTED", analytics: "supported", unsupportedReason: null, historyDays: 30, sync, ...over });
const kpi = (metric: string, label: string, over: Record<string, unknown> = {}) => ({
  metric, label, kind: "flow", description: `${label} description`, current: null, previous: null, daysWithData: 0, daysInRange: 28, previousDaysWithData: 0, changePct: null, compareNote: null,
  netChange: null, series: [], unavailableReason: "No data has been collected for this period yet.", ...over,
});
const summary = (accounts: unknown[], aiAvailable = false) => ({ range: { from: "2026-09-10", to: "2026-10-07" }, previous: { from: "2026-08-13", to: "2026-09-09" }, days: 28, accounts, aiAvailable });
const detail = (account: unknown, kpis: unknown[], aiAvailable = false) => ({ range: { from: "2026-09-10", to: "2026-10-07" }, previous: { from: "2026-08-13", to: "2026-09-09" }, days: 28, account, kpis, coverage: { firstDataDate: "2026-09-08", lastDataDate: "2026-10-07" }, aiAvailable });
const noPosts = { range: { from: "a", to: "b" }, sort: "interactions", total: 0, withMetrics: 0, rows: [] };
const noBest = { metric: "interactions", timeZone: "UTC", postsWithData: 2, minPosts: 10, minPerSlot: 2, enough: false, slots: [], reason: "Needs at least 10 published posts with numbers; there are 2 so far.", note: "n" };

beforeEach(() => {
  perms = ["social.read", "social.analytics.read"];
  api.posts.mockResolvedValue(noPosts);
  api.bestTimes.mockResolvedValue(noBest);
});
afterEach(() => { cleanup(); Object.values(api).forEach((m) => m.mockReset()); notifyMock.mockReset(); navigateMock.mockReset(); });

describe("SocialAnalyticsPage", () => {
  it("shows an empty state when nothing is connected", async () => {
    api.summary.mockResolvedValue(summary([]));
    render(<SocialAnalyticsPage />);
    expect(await screen.findByText("No social accounts connected")).toBeInTheDocument();
  });

  it("shows '—' with the reason for numbers the network did not provide (never 0), and coverage for partial periods", async () => {
    api.summary.mockResolvedValue(summary([{ ...meta(), headline: [] }]));
    api.account.mockResolvedValue(detail(meta(), [
      kpi("reach", "Reach", { current: 1200, daysWithData: 20, previous: 900, previousDaysWithData: 28, compareNote: "Not compared: 20 of 28 days have data this period and 28 of 28 in the previous period.", series: [{ date: "2026-10-06", value: 40 }, { date: "2026-10-07", value: null }] }),
      kpi("views", "Views", { unavailableReason: "Meta rejected the request (code 100)." }),
    ]));
    render(<SocialAnalyticsPage />);
    const reach = await screen.findByRole("button", { name: "Reach details" });
    expect(within(reach).getByText("1,200")).toBeInTheDocument();
    expect(within(reach).getByText("20 of 28 days have data")).toBeInTheDocument();
    expect(within(reach).queryByText(/%/)).toBeNull(); // no comparison for unequal coverage
    expect(within(reach).getByText(/Not compared: 20 of 28 days/)).toBeInTheDocument();
    const views = screen.getByRole("button", { name: "Views details" });
    expect(within(views).getByText("—")).toBeInTheDocument();
    expect(within(views).getByText("Meta rejected the request (code 100).")).toBeInTheDocument();
    expect(within(views).queryByText("0")).toBeNull();
    expect(screen.getByText(/lets this app read back at most/)).toHaveTextContent("30 days");
  });

  it("shows a period comparison only when the API provides one, and 'not available yet' for charts with no numbers", async () => {
    api.summary.mockResolvedValue(summary([{ ...meta(), headline: [] }]));
    api.account.mockResolvedValue(detail(meta(), [kpi("engagement", "Engagement", { current: 210, previous: 200, changePct: 5, daysWithData: 28, previousDaysWithData: 28, series: [{ date: "2026-10-07", value: 10 }] }), kpi("reach", "Reach")]));
    render(<SocialAnalyticsPage />);
    expect(await screen.findByLabelText("Up 5 percent versus the previous period")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reach details" }));
    const chart = screen.getByLabelText("Reach trend");
    expect(within(chart).getByText("Not available yet.")).toBeInTheDocument();
    expect(within(chart).queryByRole("img")).toBeNull(); // no empty plot
  });

  it("explains an account whose network provides no analytics (LinkedIn)", async () => {
    const li = meta({ id: "li", provider: "linkedin", displayName: "QA_TEST_2026_ LinkedIn", analytics: "unsupported", unsupportedReason: "LinkedIn only shares analytics through its Community Management API.", historyDays: null });
    api.summary.mockResolvedValue(summary([{ ...li, headline: [] }]));
    api.account.mockResolvedValue(detail(li, []));
    render(<SocialAnalyticsPage />);
    expect(await screen.findByText("No analytics for this network.")).toBeInTheDocument();
    expect(screen.getByText(/Community Management API/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CSV/ })).toBeNull();
  });

  it("lists posts with '—' for missing numbers, opens the drill-down and links back to the Composer post", async () => {
    api.summary.mockResolvedValue(summary([{ ...meta(), headline: [] }]));
    api.account.mockResolvedValue(detail(meta(), [kpi("reach", "Reach")]));
    const m = (v: number | null) => ({ value: v, status: v === null ? "UNAVAILABLE" : "OK", note: v === null ? "Meta omits the share count when it has none to report." : null });
    api.posts.mockResolvedValue({ range: { from: "a", to: "b" }, sort: "interactions", total: 2, withMetrics: 1, rows: [
      { targetId: "t1", postId: "p1", title: "Launch day", excerpt: "x", publishedAt: "2026-10-06T10:00:00Z", externalUrl: "https://www.instagram.com/p/QA/", capturedOn: "2026-10-08", metrics: { interactions: m(29), reach: m(300), views: m(null), likes: m(25), comments: m(4), shares: m(null), saves: m(null) } },
      { targetId: "t2", postId: "p2", title: "Fresh post", excerpt: "y", publishedAt: "2026-10-07T10:00:00Z", externalUrl: null, capturedOn: null, metrics: {} },
    ] });
    api.post.mockResolvedValue({ targetId: "t1", composerPostId: "p1", title: "Launch day", body: "Hello", postStatus: "PUBLISHED", account: { id: "ig", provider: "meta_instagram", displayName: "QA_TEST_2026_ IG" }, publishedAt: "2026-10-06T10:00:00Z", externalUrl: "https://www.instagram.com/p/QA/", latest: null,
      history: [{ capturedOn: "2026-10-08", metrics: { reach: m(300), likes: m(25), shares: m(null) } }] });
    perms = ["social.read", "social.analytics.read", "social.publish"];
    render(<SocialAnalyticsPage />);
    expect(await screen.findByText("2 published through this platform · 1 with numbers so far. Posts made outside Control Center are not included.")).toBeInTheDocument();
    expect(screen.getByText(/no numbers yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Launch day" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("View on Instagram")).toHaveAttribute("href", "https://www.instagram.com/p/QA/");
    fireEvent.click(within(dialog).getByRole("button", { name: "Open in Composer" }));
    expect(navigateMock).toHaveBeenCalledWith("/social/compose?post=p1");
  });

  it("shows best posting times only when there is enough of our own data; otherwise the reason", async () => {
    api.summary.mockResolvedValue(summary([{ ...meta(), headline: [] }]));
    api.account.mockResolvedValue(detail(meta(), [kpi("reach", "Reach")]));
    const first = render(<SocialAnalyticsPage />);
    expect(await screen.findByText(/Needs at least 10 published posts with numbers; there are 2 so far\./)).toBeInTheDocument();
    first.unmount();
    api.bestTimes.mockResolvedValue({ ...noBest, enough: true, reason: null, postsWithData: 14, timeZone: "Europe/London", slots: [{ weekday: "Tue", hour: 9, posts: 5, average: 24.5 }], note: "Averages of this account's own stored post numbers." });
    render(<SocialAnalyticsPage />);
    expect(await screen.findByText("Tuesday 09:00")).toBeInTheDocument();
    expect(screen.getByText("average 24.5 · 5 posts")).toBeInTheDocument();
  });

  it("hides the AI summary when no provider is configured, and labels it AI-generated when available", async () => {
    api.summary.mockResolvedValue(summary([{ ...meta(), headline: [] }], false));
    api.account.mockResolvedValue(detail(meta(), [kpi("reach", "Reach")]));
    const first = render(<SocialAnalyticsPage />);
    await screen.findByLabelText("Best posting times");
    expect(screen.queryByLabelText("What worked this period")).toBeNull();
    first.unmount();
    api.summary.mockResolvedValue(summary([{ ...meta(), headline: [] }], true));
    api.aiSummary.mockResolvedValue({ headline: "Reach was 250", bullets: ["Engagement was 21."], executionId: "e", generatedAt: "now", range: { from: "2026-10-05", to: "2026-10-07" }, aiGenerated: true });
    render(<SocialAnalyticsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Summarise with AI" }));
    expect(await screen.findByText("AI-generated")).toBeInTheDocument();
    expect(screen.getByText("Reach was 250")).toBeInTheDocument();
    expect(screen.getByText(/every figure was checked against them/)).toBeInTheDocument();
  });

  it("exports CSV for the selected period and only offers Refresh to people who can manage accounts", async () => {
    api.summary.mockResolvedValue(summary([{ ...meta(), headline: [] }]));
    api.account.mockResolvedValue(detail(meta(), [kpi("reach", "Reach")]));
    api.downloadCsv.mockResolvedValue(undefined);
    const first = render(<SocialAnalyticsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Daily metrics CSV/ }));
    expect(api.downloadCsv).toHaveBeenCalledWith("ig", "account", { from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }, expect.stringMatching(/^social-account_QA-TEST-2026-IG_.*\.csv$/));
    expect(screen.queryByRole("button", { name: /Refresh now/ })).toBeNull();
    first.unmount();
    perms = ["social.read", "social.analytics.read", "social.accounts.manage"];
    api.refresh.mockResolvedValue({ accountId: "ig", outcome: "completed", daysStored: 5, postsSnapshotted: 1, audienceStored: 0 });
    render(<SocialAnalyticsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Refresh now/ }));
    await waitFor(() => expect(api.refresh).toHaveBeenCalledWith("ig"));
    expect(notifyMock).toHaveBeenCalledWith("Analytics refreshed.", "success");
  });

  it("shows a collection error from the job", async () => {
    api.summary.mockResolvedValue(summary([{ ...meta({ sync: { ...sync, lastSuccessAt: null, lastError: "The Insights permission is missing. Reconnect the account after enabling it in the Meta app." } }), headline: [] }]));
    api.account.mockResolvedValue(detail(meta({ sync: { ...sync, lastSuccessAt: null, lastError: "The Insights permission is missing. Reconnect the account after enabling it in the Meta app." } }), [kpi("reach", "Reach")]));
    render(<SocialAnalyticsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Insights permission is missing");
    expect(screen.getByText(/No snapshot yet/)).toBeInTheDocument();
  });
});

describe("SocialAudiencePage", () => {
  const audience = (over: Record<string, unknown> = {}) => ({
    range: { from: "2026-07-10", to: "2026-10-08" }, account: meta(),
    followers: { series: [{ date: "2026-10-01", value: 1200 }, { date: "2026-10-08", value: 1234 }], current: { date: "2026-10-08", value: 1234 }, first: { date: "2026-10-01", value: 1200 },
      netChange: { value: 34, fromDate: "2026-10-01", toDate: "2026-10-08" }, newFollows: { total: 40, days: 7 }, unfollows: null, historyNote: "Follower history starts on 2026-10-01: Instagram does not provide earlier follower totals." },
    demographics: [
      { dimension: "country", label: "Countries", status: "OK", reason: null, capturedOn: "2026-10-08", buckets: [{ key: "US", value: 90 }, { key: "GB", value: 40 }] },
      { dimension: "city", label: "Cities", status: "UNAVAILABLE", reason: "Instagram does not provide audience demographics for accounts with fewer than 100 followers (this account has 42).", capturedOn: "2026-10-08", buckets: [] },
      { dimension: "locale", label: "Languages", status: "PENDING", reason: "Not collected yet: the first audience snapshot is taken by the daily job.", capturedOn: null, buckets: [] },
    ], demographicsSupported: true, demographicsReason: null, ...over,
  });

  it("shows follower totals, an honest net change and demographics only where returned", async () => {
    api.summary.mockResolvedValue(summary([{ ...meta(), headline: [] }]));
    api.audience.mockResolvedValue(audience());
    render(<SocialAudiencePage />);
    expect(await screen.findByText("Followers now")).toBeInTheDocument();
    expect(screen.getAllByText("1,234").length).toBeGreaterThan(0);
    expect(screen.getByText("+34")).toBeInTheDocument();
    expect(screen.getByText(/Instagram does not provide earlier follower totals/)).toBeInTheDocument();
    const countries = screen.getByLabelText("Countries");
    expect(within(countries).getByText("US")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Cities")).getByText("Not available yet.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Cities")).getByText(/fewer than 100 followers \(this account has 42\)/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Languages")).getByText(/Not collected yet/)).toBeInTheDocument();
  });

  it("shows '—' (not 0) with a reason when there is no follower history yet, and a reason when a network has no demographics", async () => {
    api.summary.mockResolvedValue(summary([{ ...meta({ provider: "meta_facebook", displayName: "QA_TEST_2026_ Page" }), headline: [] }]));
    api.audience.mockResolvedValue(audience({
      account: meta({ provider: "meta_facebook" }), demographics: [], demographicsSupported: false, demographicsReason: "Facebook Page demographics are not read in this release.",
      followers: { series: [], current: null, first: null, netChange: null, newFollows: null, unfollows: null, historyNote: "No follower total has been captured yet." },
    }));
    render(<SocialAudiencePage />);
    expect(await screen.findByText("Needs two daily snapshots on different days.")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/Facebook Page demographics are not read in this release/)).toBeInTheDocument();
    expect(screen.getByText("No follower total has been captured yet. The first snapshot is taken by the daily job.")).toBeInTheDocument();
  });

  it("explains a network with no audience data", async () => {
    const li = meta({ provider: "linkedin", analytics: "unsupported", unsupportedReason: "LinkedIn only shares analytics through its Community Management API." });
    api.summary.mockResolvedValue(summary([{ ...li, headline: [] }]));
    api.audience.mockResolvedValue(audience({ account: li }));
    render(<SocialAudiencePage />);
    expect(await screen.findByText("No audience data for this network.")).toBeInTheDocument();
  });
});
