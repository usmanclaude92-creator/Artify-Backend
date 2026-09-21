/** Phase 12 — AI Overview page: renders only real data for sections the caller has permission for, never a fabricated metric (same convention as CrmDashboardPage). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AiOverviewPage } from "./AiOverviewPage";

const listExecutionsMock = vi.fn();
const listApprovalsMock = vi.fn();
const summaryMock = vi.fn();

vi.mock("../../../lib/aiApi", () => ({
  aiExecutionsApi: { list: (...args: unknown[]) => listExecutionsMock(...args) },
  aiApprovalsApi: { list: (...args: unknown[]) => listApprovalsMock(...args) },
  aiUsageApi: { summary: (...args: unknown[]) => summaryMock(...args) },
}));

let permissions: string[] = [];
vi.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { name: "Admin", permissions } } }),
}));

afterEach(() => {
  cleanup();
  listExecutionsMock.mockReset();
  listApprovalsMock.mockReset();
  summaryMock.mockReset();
  permissions = [];
});

describe("AiOverviewPage", () => {
  it("shows pending-approvals and execution stats when the caller holds both permissions", async () => {
    permissions = ["ai.executions.read", "ai.approvals.read", "ai.usage.read"];
    listExecutionsMock.mockResolvedValue({ items: [{ id: "e1", kind: "TOOL_CALL", toolCode: "leads.list", status: "COMPLETED" }] });
    listApprovalsMock.mockResolvedValue({ items: [{ id: "a1", action: "invoices.issue", status: "PENDING" }] });
    summaryMock.mockResolvedValue({ summary: { totals: { _count: 3, _sum: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: "0.01" } }, byModel: [] } });

    render(<AiOverviewPage />);
    expect(await screen.findByText("Pending approvals")).toBeInTheDocument();
    expect(screen.getByText("Recent executions")).toBeInTheDocument();
    expect(screen.getByText("Total AI requests")).toBeInTheDocument();
  });

  it("degrades gracefully when the caller lacks ai.approvals.read, never fabricating a pending-approvals count", async () => {
    permissions = ["ai.executions.read"];
    listExecutionsMock.mockResolvedValue({ items: [] });

    render(<AiOverviewPage />);
    await screen.findByText("Recent executions");
    expect(screen.queryByText("Pending approvals")).not.toBeInTheDocument();
    expect(listApprovalsMock).not.toHaveBeenCalled();
  });
});
