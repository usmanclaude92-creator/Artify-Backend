import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PortalRegistrationsPanel } from "./PortalRegistrationsPanel";

const listMock = vi.fn();
vi.mock("../../lib/api", () => ({
  portalRegistrationsApi: { list: () => listMock(), link: vi.fn(), reject: vi.fn() },
  clientsApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
}));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: ["workspaces.read", "workspaces.update", "workspaces.suspend"] } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));

afterEach(() => {
  cleanup();
  listMock.mockReset();
});

describe("PortalRegistrationsPanel", () => {
  it("shows pending registrations with verification state and actions", async () => {
    listMock.mockResolvedValue({
      registrations: [{ organizationId: "o1", organizationName: "Acme Logistics", registeredAt: "2026-10-06T00:00:00Z", contactName: "Sam Lee", contactEmail: "sam@acme.com", emailVerified: false }],
    });
    render(<PortalRegistrationsPanel />);
    expect(await screen.findByText("Acme Logistics")).toBeInTheDocument();
    expect(screen.getByText("Email unverified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Link to client" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("renders nothing when there are no registrations or the caller isn't an operator", async () => {
    listMock.mockRejectedValue(new Error("403"));
    const { container } = render(<PortalRegistrationsPanel />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.firstChild).toBeNull();
  });
});
