import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

let mockPath = "/dashboard";
let mockBadges: Record<string, number> | null = null;
vi.mock("../../lib/useNavBadges", () => ({ useNavBadges: () => mockBadges }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: ["users.read", "roles.read", "audit.read", "cms.pages.read", "content.read", "social.read", "approvals.read", "automation.read"] } } }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: mockPath, navigate: vi.fn() }) }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  mockPath = "/dashboard";
  mockBadges = null;
});

describe("Sidebar", () => {
  it("shows the new section order, only sections with visible items, and an accordion", async () => {
    const { Sidebar } = await import("./Sidebar");
    render(<Sidebar mobileOpen={false} onCloseMobile={() => {}} />);
    const headers = screen.getAllByRole("button", { expanded: true }).concat(screen.getAllByRole("button", { expanded: false })).filter((b) => b.classList.contains("cc-section-head"));
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
    expect(screen.getAllByRole("button", { expanded: true }).filter((b) => b.classList.contains("cc-section-head"))).toHaveLength(1);
    expect(admin.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Sidebar live badges", () => {
  it("shows count pills with screen-reader labels next to Approvals, Notifications and My Work", async () => {
    mockBadges = { approvals: 3, notifications: 120, myWork: 2 };
    mockPath = "/dashboard";
    const { Sidebar } = await import("./Sidebar");
    render(<Sidebar mobileOpen={false} onCloseMobile={() => {}} />);
    expect(screen.getByRole("button", { name: "Approvals, 3 pending" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notifications, 120 unread" })).toHaveTextContent("99+");
    expect(screen.getByRole("button", { name: "My Work, 2 open" })).toBeInTheDocument();
  });

  it("shows no pill for a zero or missing count", async () => {
    mockBadges = { approvals: 0, notifications: 0 };
    const { Sidebar } = await import("./Sidebar");
    render(<Sidebar mobileOpen={false} onCloseMobile={() => {}} />);
    expect(screen.getByRole("button", { name: "Approvals" })).toBeInTheDocument();
    expect(document.querySelector(".cc-badge")).toBeNull();
  });

  it("marks a collapsed section header with a dot (and sr text) when a child has a count", async () => {
    mockBadges = { approvals: 1, notifications: 0 };
    mockPath = "/users"; // Administration open, so Dashboard is collapsed
    const { Sidebar } = await import("./Sidebar");
    render(<Sidebar mobileOpen={false} onCloseMobile={() => {}} />);
    const dashboard = screen.getByRole("button", { name: /^Dashboard/ });
    expect(dashboard.getAttribute("aria-expanded")).toBe("false");
    expect(dashboard.querySelector(".cc-dot")).not.toBeNull();
    expect(dashboard).toHaveTextContent(/needing attention/i);
    const admin = screen.getByRole("button", { name: /^Administration$/ });
    expect(admin.querySelector(".cc-dot")).toBeNull();
  });
});
