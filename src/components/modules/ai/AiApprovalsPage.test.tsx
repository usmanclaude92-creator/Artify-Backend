/** Phase 12 — AI Approvals page: renders pending approval requests, gates the approve/reject actions by ai.approvals.decide. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AiApprovalsPage } from "./AiApprovalsPage";

const listMock = vi.fn();
const decideMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../../lib/aiApi", () => ({
  aiApprovalsApi: {
    list: (...args: unknown[]) => listMock(...args),
    decide: (...args: unknown[]) => decideMock(...args),
  },
}));
vi.mock("../../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

let permissions: string[] = [];
vi.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { name: "Admin", permissions } } }),
}));

const APPROVAL = {
  id: "appr-1",
  organizationId: "org-1",
  executionId: "exec-1",
  toolExecutionId: "te-1",
  requestedById: "user-1",
  requestedBy: { id: "user-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
  action: "invoices.issue",
  resourceType: "invoices",
  resourceId: null,
  payload: { invoiceId: "inv-1" },
  status: "PENDING",
  approvedById: null,
  approvedAt: null,
  rejectionReason: null,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  createdAt: new Date().toISOString(),
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  decideMock.mockReset();
  notifyMock.mockReset();
  permissions = [];
});

describe("AiApprovalsPage", () => {
  it("renders a pending approval request", async () => {
    permissions = ["ai.approvals.read"];
    listMock.mockResolvedValue({ items: [APPROVAL], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<AiApprovalsPage />);
    expect(await screen.findByText("invoices.issue")).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
  });

  it("hides Approve/Reject from a caller without ai.approvals.decide", async () => {
    permissions = ["ai.approvals.read"];
    listMock.mockResolvedValue({ items: [APPROVAL], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<AiApprovalsPage />);
    await screen.findByText("invoices.issue");
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.queryByText("Reject")).not.toBeInTheDocument();
  });

  it("lets a caller with ai.approvals.decide approve a pending request", async () => {
    permissions = ["ai.approvals.read", "ai.approvals.decide"];
    listMock.mockResolvedValue({ items: [APPROVAL], page: 1, limit: 20, total: 1, totalPages: 1 });
    decideMock.mockResolvedValue({ approval: { ...APPROVAL, status: "APPROVED" } });
    render(<AiApprovalsPage />);
    const approveButton = await screen.findByText("Approve");
    fireEvent.click(approveButton);
    await waitFor(() => expect(decideMock).toHaveBeenCalledWith("appr-1", "APPROVE"));
  });
});
