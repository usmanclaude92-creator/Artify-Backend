/** Phase 16 — My Work renders only real tasks/approvals/activity from /automation/my-work, and completes/decides through the real API. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MyWorkPage } from "./MyWorkPage";

const myWorkMock = vi.fn();
const updateTaskMock = vi.fn();
const decideApprovalMock = vi.fn();

vi.mock("../../lib/api", () => ({
  automationApi: {
    myWork: (...args: unknown[]) => myWorkMock(...args),
    updateTask: (...args: unknown[]) => updateTaskMock(...args),
    decideApproval: (...args: unknown[]) => decideApprovalMock(...args),
  },
}));
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { name: "Admin", permissions: ["automation.read"] } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));

const task = {
  id: "task-1",
  organizationId: "org-1",
  title: "Follow up with lead",
  description: null,
  assignedUserId: "user-1",
  assignedRole: null,
  priority: "HIGH",
  status: "PENDING",
  dueDate: "2026-01-01T00:00:00.000Z",
  sourceWorkflowId: null,
  sourceEntityType: "lead",
  sourceEntityId: "lead-1",
  isAiGenerated: false,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const approval = {
  id: "approval-1",
  organizationId: "org-1",
  executionId: "exec-1",
  workflowId: "wf-1",
  stepId: "step-1",
  action: "publish_page",
  description: "Publish \"Homepage\"",
  entityType: "page",
  entityId: "page-1",
  status: "PENDING",
  requesterId: "user-2",
  approverId: null,
  decisionReason: null,
  requestedAt: "2026-01-01T00:00:00.000Z",
  decidedAt: null,
  workflow: { id: "wf-1", name: "Content Approval", category: "CONTENT_APPROVAL" },
};

afterEach(() => {
  cleanup();
  myWorkMock.mockReset();
  updateTaskMock.mockReset();
  decideApprovalMock.mockReset();
});

describe("MyWorkPage", () => {
  it("renders real overdue/upcoming tasks and pending approvals from the API", async () => {
    myWorkMock.mockResolvedValue({
      tasks: { overdue: [task], upcoming: [], assigned: [] },
      pendingApprovals: [approval],
      recentActivity: { executions: [], completedTasks: [] },
    });
    render(<MyWorkPage />);
    expect(await screen.findByText("Follow up with lead")).toBeInTheDocument();
    expect(screen.getByText(/publish_page/)).toBeInTheDocument();
  });

  it("shows empty states when nothing is assigned", async () => {
    myWorkMock.mockResolvedValue({
      tasks: { overdue: [], upcoming: [], assigned: [] },
      pendingApprovals: [],
      recentActivity: { executions: [], completedTasks: [] },
    });
    render(<MyWorkPage />);
    expect(await screen.findByText(/you're all caught up/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing to approve/i)).toBeInTheDocument();
  });

  it("completes a task through the real API", async () => {
    myWorkMock.mockResolvedValue({
      tasks: { overdue: [], upcoming: [task], assigned: [task] },
      pendingApprovals: [],
      recentActivity: { executions: [], completedTasks: [] },
    });
    updateTaskMock.mockResolvedValue({ task: { ...task, status: "COMPLETED" } });
    render(<MyWorkPage />);
    const doneButtons = await screen.findAllByRole("button", { name: /done/i });
    fireEvent.click(doneButtons[0]!);
    await vi.waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith("task-1", { status: "COMPLETED" }));
  });

  it("decides a pending approval through the real API", async () => {
    myWorkMock.mockResolvedValue({
      tasks: { overdue: [], upcoming: [], assigned: [] },
      pendingApprovals: [approval],
      recentActivity: { executions: [], completedTasks: [] },
    });
    decideApprovalMock.mockResolvedValue({ approvalId: "approval-1", decision: "APPROVED" });
    render(<MyWorkPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^approve$/i }));
    await vi.waitFor(() => expect(decideApprovalMock).toHaveBeenCalledWith("approval-1", "APPROVED"));
  });
});
