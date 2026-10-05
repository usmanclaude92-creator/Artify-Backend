/** Phase 14 — automation overview + workflows tab render real data from the automation API, never fabricated. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AutomationPage } from "./AutomationPage";

const dashboardMock = vi.fn();
const listWorkflowsMock = vi.fn();

vi.mock("../../lib/api", () => ({
  automationApi: {
    dashboard: (...args: unknown[]) => dashboardMock(...args),
    listWorkflows: (...args: unknown[]) => listWorkflowsMock(...args),
    getWorkflow: vi.fn(),
    createWorkflow: vi.fn(),
    updateWorkflow: vi.fn(),
    publishWorkflow: vi.fn(),
    triggerWorkflow: vi.fn(),
    listExecutions: vi.fn().mockResolvedValue({ rows: [], total: 0, page: 1, limit: 20 }),
    getExecution: vi.fn(),
    retryExecution: vi.fn(),
    cancelExecution: vi.fn(),
    listApprovals: vi.fn().mockResolvedValue({ rows: [], total: 0, page: 1, limit: 20 }),
    decideApproval: vi.fn(),
    listTasks: vi.fn().mockResolvedValue({ rows: [], total: 0, page: 1, limit: 20 }),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    listActions: vi.fn(),
    listEventTypes: vi.fn(),
  },
}));

let mockPermissions: string[] = ["automation.read", "automation.create", "automation.publish", "automation.execute", "automation.approve", "automation.manage"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));

afterEach(() => {
  cleanup();
  dashboardMock.mockReset();
  listWorkflowsMock.mockReset();
  mockPermissions = ["automation.read", "automation.create", "automation.publish", "automation.execute", "automation.approve", "automation.manage"];
});

describe("AutomationPage", () => {
  it("renders real dashboard metrics on the Overview tab", async () => {
    dashboardMock.mockResolvedValue({
      metrics: {
        totalWorkflows: 3,
        activeWorkflows: 2,
        totalExecutions: 10,
        completedExecutions: 8,
        failedExecutions: 1,
        runningExecutions: 1,
        pendingApprovals: 0,
        activeTasks: 2,
        successRate: 80,
      },
      recentExecutions: [],
    });
    render(<AutomationPage />);
    expect(await screen.findByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("switches to the Workflows tab and renders real workflows from the API", async () => {
    dashboardMock.mockResolvedValue({
      metrics: { totalWorkflows: 0, activeWorkflows: 0, totalExecutions: 0, completedExecutions: 0, failedExecutions: 0, runningExecutions: 0, pendingApprovals: 0, activeTasks: 0, successRate: 100 },
      recentExecutions: [],
    });
    listWorkflowsMock.mockResolvedValue({
      rows: [
        {
          id: "wf-1",
          organizationId: "org-1",
          name: "Lead Follow-up",
          description: null,
          category: "GENERAL",
          status: "ACTIVE",
          currentVersion: 1,
          publishedVersion: 1,
          triggerType: "EVENT",
          triggerConfig: { eventType: "lead.created" },
          conditions: [],
          steps: [],
          retryPolicy: {},
          limits: {},
          createdById: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          _count: { executions: 5, schedules: 0 },
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    render(<AutomationPage />);
    fireEvent.click(await screen.findByRole("button", { name: /^workflows$/i }));
    expect(await screen.findByText("Lead Follow-up")).toBeInTheDocument();
    expect(listWorkflowsMock).toHaveBeenCalled();
  });
});
