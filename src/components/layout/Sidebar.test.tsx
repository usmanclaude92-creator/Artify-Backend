import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

let mockPath = "/dashboard";
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: ["users.read", "roles.read", "audit.read", "cms.pages.read", "content.read", "social.read"] } } }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: mockPath, navigate: vi.fn() }) }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  mockPath = "/dashboard";
});

describe("Sidebar", () => {
  it("shows the new section order, only sections with visible items, and an accordion", async () => {
    const { Sidebar } = await import("./Sidebar");
    render(<Sidebar mobileOpen={false} onCloseMobile={() => {}} />);
    const headers = screen.getAllByRole("button", { expanded: true }).concat(screen.getAllByRole("button", { expanded: false }));
    const names = headers.map((b) => b.textContent);
    expect(names).toContain("Dashboard");
    expect(names).toContain("Social Media");
    expect(names).not.toContain("Client Portal"); // no portal.dashboard.read
    // active item's section is forced open and marks aria-current
    expect(screen.getAllByRole("button", { name: "Dashboard" }).some((b) => b.getAttribute("aria-current") === "page")).toBe(true);
  });

  it("renders group subheadings inside Administration when it is open", async () => {
    mockPath = "/users";
    const { Sidebar } = await import("./Sidebar");
    render(<Sidebar mobileOpen={false} onCloseMobile={() => {}} />);
    expect(screen.getByText("People & access")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
  });

  it("falls back to collapsed for an invalid stored section", async () => {
    localStorage.setItem("artify_cc_sidebar_expanded_section", "Workspace");
    mockPath = "/dashboard";
    const { Sidebar } = await import("./Sidebar");
    render(<Sidebar mobileOpen={false} onCloseMobile={() => {}} />);
    const social = screen.getByRole("button", { name: /Social Media/ });
    expect(social.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(social);
    expect(social.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Social Overview")).toBeInTheDocument();
  });
});

describe("Sidebar accordion", () => {
  it("keeps only one section open: opening another closes the section holding the current page", async () => {
    mockPath = "/users";
    const { Sidebar } = await import("./Sidebar");
    render(<Sidebar mobileOpen={false} onCloseMobile={() => {}} />);
    const admin = screen.getByRole("button", { name: /^Administration$/ });
    expect(admin.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Social Media/ }));
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
    expect(admin.getAttribute("aria-expanded")).toBe("false");
  });
});
