/** Phase 14 — marketing dashboard renders only real counts from /marketing/summary, degrades per-permission, never fabricates. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarketingDashboardPage } from "./MarketingDashboardPage";

const summaryMock = vi.fn();

vi.mock("../../lib/api", () => ({
  marketingApi: { summary: (...args: unknown[]) => summaryMock(...args) },
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { name: "Admin", permissions: ["campaigns.read", "leads.read"] } } }),
}));

afterEach(() => {
  cleanup();
  summaryMock.mockReset();
});

describe("MarketingDashboardPage", () => {
  it("renders real campaign and lead counts from the API", async () => {
    summaryMock.mockResolvedValue({
      campaigns: { total: 4, draft: 1, active: 2, paused: 1, archived: 0, performance: null },
      leads: { total: 20, attributed: 12, unattributed: 8 },
      conversions: { opportunitiesWon: 3, clientsCreated: 2 },
      landingPages: null,
      forms: null,
      sources: null,
      utmCampaigns: null,
      recentCampaignActivity: null,
    });
    render(<MarketingDashboardPage />);
    expect(await screen.findByText("4")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("distinguishes unavailable data (—) from a real zero when a permission/configuration is missing", async () => {
    summaryMock.mockResolvedValue({
      campaigns: null,
      leads: { total: 0, attributed: 0, unattributed: 0 },
      conversions: null,
      landingPages: null,
      forms: null,
      sources: null,
      utmCampaigns: null,
      recentCampaignActivity: null,
    });
    render(<MarketingDashboardPage />);
    await screen.findByText(/leads & conversions/i);
    // Real zero leads renders as "0", not "—".
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    // Conversions (no permission) render as "—", never a fabricated 0.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows an error state when the summary call fails", async () => {
    summaryMock.mockRejectedValue(new Error("Unavailable"));
    render(<MarketingDashboardPage />);
    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
  });
});
