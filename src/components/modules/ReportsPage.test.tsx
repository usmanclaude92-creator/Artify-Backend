/** Phase 15 — Reports area: run a report, render real data generically, gate CSV export by reports.export. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReportsPage } from "./ReportsPage";

const getMock = vi.fn();
const downloadExportMock = vi.fn();

vi.mock("../../lib/api", () => ({
  reportsApi: {
    get: (...args: unknown[]) => getMock(...args),
    downloadExport: (...args: unknown[]) => downloadExportMock(...args),
  },
  REPORT_TYPES: [
    "executive_summary",
    "website_performance",
    "content_performance",
    "seo_report",
    "lead_generation",
    "crm_pipeline",
    "campaign_performance",
    "conversion_report",
    "client_acquisition",
  ],
  REPORT_LABELS: {
    executive_summary: "Executive Summary",
    website_performance: "Website Performance",
    content_performance: "Content Performance",
    seo_report: "SEO Report",
    lead_generation: "Lead Generation",
    crm_pipeline: "CRM Pipeline",
    campaign_performance: "Campaign Performance",
    conversion_report: "Conversion Report",
    client_acquisition: "Client Acquisition",
  },
}));

let mockPermissions: string[] = ["reports.read", "reports.export"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { name: "Admin", permissions: mockPermissions } } }),
}));

afterEach(() => {
  cleanup();
  getMock.mockReset();
  downloadExportMock.mockReset();
  mockPermissions = ["reports.read", "reports.export"];
});

describe("ReportsPage", () => {
  it("runs a report and renders real key/value data from the API", async () => {
    getMock.mockResolvedValue({ type: "lead_generation", range: { from: null, to: null }, report: { total: 12, bySource: [] } });
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole("button", { name: /run report/i }));
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalled();
  });

  it("shows an empty state when the report has no data for the caller's permissions", async () => {
    getMock.mockResolvedValue({ type: "lead_generation", range: { from: null, to: null }, report: null });
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole("button", { name: /run report/i }));
    expect(await screen.findByText(/not available/i)).toBeInTheDocument();
  });

  it("hides the Export CSV button when the caller lacks reports.export", () => {
    mockPermissions = ["reports.read"];
    render(<ReportsPage />);
    expect(screen.queryByRole("button", { name: /export csv/i })).not.toBeInTheDocument();
  });

  it("exports CSV through the real API when the caller has reports.export", async () => {
    downloadExportMock.mockResolvedValue(undefined);
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await vi.waitFor(() => expect(downloadExportMock).toHaveBeenCalled());
  });
});
