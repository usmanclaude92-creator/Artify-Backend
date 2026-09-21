/** Phase 12 — AI Tools page: renders the governed tool catalog, gates the enable/disable toggle by ai.tools.manage. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AiToolsPage } from "./AiToolsPage";

const listMock = vi.fn();
const updateSettingMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../../lib/aiApi", () => ({
  aiToolsApi: {
    list: (...args: unknown[]) => listMock(...args),
    updateSetting: (...args: unknown[]) => updateSettingMock(...args),
  },
}));
vi.mock("../../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

let permissions: string[] = [];
vi.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { name: "Admin", permissions } } }),
}));

const TOOLS = [
  {
    code: "leads.list",
    name: "List leads",
    description: "Search and list CRM leads.",
    requiredPermission: "leads.read",
    riskLevel: "READ_ONLY",
    isMutating: false,
    requiresApproval: false,
    status: "ENABLED",
    orgEnabled: true,
    requireApprovalOverride: null,
  },
  {
    code: "invoices.issue",
    name: "Issue invoice",
    description: "Issue a draft invoice.",
    requiredPermission: "invoices.issue",
    riskLevel: "HIGH",
    isMutating: true,
    requiresApproval: true,
    status: "ENABLED",
    orgEnabled: true,
    requireApprovalOverride: null,
  },
];

afterEach(() => {
  cleanup();
  listMock.mockReset();
  updateSettingMock.mockReset();
  notifyMock.mockReset();
  permissions = [];
});

describe("AiToolsPage", () => {
  it("renders the tool catalog with risk-level and approval badges", async () => {
    permissions = ["ai.tools.read"];
    listMock.mockResolvedValue({ tools: TOOLS });
    render(<AiToolsPage />);
    expect(await screen.findByText("List leads")).toBeInTheDocument();
    expect(screen.getByText("Issue invoice")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("Requires approval")).toBeInTheDocument();
  });

  it("hides the enable/disable toggle from a caller without ai.tools.manage", async () => {
    permissions = ["ai.tools.read"];
    listMock.mockResolvedValue({ tools: TOOLS });
    render(<AiToolsPage />);
    await screen.findByText("List leads");
    expect(screen.queryByLabelText(/disable list leads/i)).not.toBeInTheDocument();
  });

  it("lets a caller with ai.tools.manage toggle a tool off", async () => {
    permissions = ["ai.tools.read", "ai.tools.manage"];
    listMock.mockResolvedValue({ tools: TOOLS });
    updateSettingMock.mockResolvedValue({ setting: { enabled: false } });
    render(<AiToolsPage />);
    const toggle = await screen.findByLabelText(/disable list leads/i);
    fireEvent.click(toggle);
    await waitFor(() => expect(updateSettingMock).toHaveBeenCalledWith("leads.list", { enabled: false }));
  });
});
