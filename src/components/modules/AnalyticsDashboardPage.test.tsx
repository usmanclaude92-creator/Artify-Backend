/** Phase 15 — Analytics dashboard renders only real figures from /analytics/overview, degrades per-permission, never fabricates. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AnalyticsDashboardPage } from "./AnalyticsDashboardPage";

const overviewMock = vi.fn();

vi.mock("../../lib/api", () => ({
  analyticsApi: { overview: (...args: unknown[]) => overviewMock(...args) },
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { name: "Admin", permissions: ["analytics.read", "leads.read"] } } }),
}));

afterEach(() => {
  cleanup();
  overviewMock.mockReset();
});

describe("AnalyticsDashboardPage", () => {
  it("renders real page view and lead counts from the API", async () => {
    overviewMock.mockResolvedValue({
      range: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z", comparing: false },
      website: { configured: true, hasAnyTraffic: true, pageViews: 42, pageViewsChangePct: null, sessions: 10, sessionsChangePct: null, topPages: [], utmSources: [] },
      leads: { total: 7, changePct: null, bySource: [] },
      pipeline: { byStage: {}, wonCount: 2, wonValue: "0", lostCount: 0, lostValue: "0", wonChangePct: null },
      clients: { created: 1, changePct: null, attributedConversions: 0 },
      campaigns: [],
      forms: { submissions: 3 },
      conversionRate: 28.57,
      seo: { issueCount: 0, topIssues: [] },
      recentActivity: [],
    });
    render(<AnalyticsDashboardPage />);
    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
  });

  it("distinguishes unavailable data (—) from a real zero when a permission/configuration is missing", async () => {
    overviewMock.mockResolvedValue({
      range: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z", comparing: false },
      website: null,
      leads: { total: 0, changePct: null, bySource: [] },
      pipeline: null,
      clients: null,
      campaigns: null,
      forms: null,
      conversionRate: null,
      seo: null,
      recentActivity: null,
    });
    render(<AnalyticsDashboardPage />);
    await screen.findByText(/website & conversion/i);
    // Real zero leads renders as "0", not "—".
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    // No-permission sections render "—", never a fabricated 0.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows an error state when the overview call fails", async () => {
    overviewMock.mockRejectedValue(new Error("Unavailable"));
    render(<AnalyticsDashboardPage />);
    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
  });
});
