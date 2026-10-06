import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

let mockPath = "/dashboard";
let mockPerms: string[] = ["users.read", "roles.read", "audit.read", "approvals.read", "automation.read", "social.read", "ai.approvals.read"];
const navigateMock = vi.fn();
const prefs = {
  railCollapsed: false,
  toggleRail: vi.fn(),
  pinned: [] as string[],
  isPinned: (id: string) => prefs.pinned.includes(id),
  togglePin: vi.fn(() => true),
  movePin: vi.fn(),
  reorderPin: vi.fn(),
  maxPins: 8,
};
let mockBadges: Record<string, number> | null = null;

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPerms } }, organizations: [] }) }));
vi.mock("../../context/NavPreferencesContext", () => ({ useNavPreferences: () => prefs }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ workspaces: [], current: null, canSwitch: false, switching: false, switchTo: vi.fn() }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: mockPath, navigate: navigateMock }) }));
vi.mock("../../lib/useNavBadges", () => ({ useNavBadges: () => mockBadges }));

import { Sidebar } from "./Sidebar";

afterEach(() => {
  cleanup();
  localStorage.clear();
  mockPath = "/dashboard";
  mockBadges = null;
  prefs.railCollapsed = false;
  prefs.pinned = [];
  prefs.togglePin.mockClear();
  prefs.movePin.mockClear();
  prefs.toggleRail.mockClear();
  prefs.reorderPin.mockClear();
  navigateMock.mockClear();
  mockPerms = ["users.read", "roles.read", "audit.read", "approvals.read", "automation.read", "social.read", "ai.approvals.read"];
});

const mount = () => render(<Sidebar mobileOpen={false} onCloseMobile={() => {}} />);

describe("rail mode", () => {
  it("collapse toggle in the expanded sidebar asks to toggle the rail (aria-expanded=true)", () => {
    mount();
    const toggle = screen.getByRole("button", { name: "Collapse sidebar to icons" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(prefs.toggleRail).toHaveBeenCalled();
  });

  it("renders one icon per visible section only, and an expand button", () => {
    prefs.railCollapsed = true;
    mount();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const labels = within(nav).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(expect.arrayContaining(["Dashboard", "Social Media", "Automation & AI", "Administration"]));
    expect(labels).not.toContain("Client Portal"); // no portal permission
    expect(labels).not.toContain("Catalog"); // no catalog permission
    expect(document.querySelector("aside")?.getAttribute("data-rail")).toBe("true");
  });

  it("opens a flyout with the section's items and subheadings; Esc closes it and returns focus to the icon", () => {
    prefs.railCollapsed = true;
    mount();
    const icon = screen.getByRole("button", { name: "Administration" });
    fireEvent.click(icon);
    expect(icon.getAttribute("aria-expanded")).toBe("true");
    const flyout = screen.getByRole("dialog", { name: "Administration" });
    expect(within(flyout).getByText("People & access")).toBeInTheDocument();
    expect(within(flyout).getByText("Security")).toBeInTheDocument();
    expect(within(flyout).getByRole("button", { name: "Users" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(icon);
  });

  it("navigates from the flyout and closes it", () => {
    prefs.railCollapsed = true;
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Administration" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Users" }));
    expect(navigateMock).toHaveBeenCalledWith("/users");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("highlights the section of the active page and shows summed badge counts on section icons", () => {
    prefs.railCollapsed = true;
    mockPath = "/users";
    mockBadges = { approvals: 3, notifications: 2 };
    mount();
    expect(screen.getByRole("button", { name: "Administration" }).getAttribute("aria-current")).toBe("true");
    const dashboard = screen.getByRole("button", { name: "Dashboard, 5 items need attention" });
    expect(dashboard).toHaveTextContent("5");
  });

  it("arrow keys move between flyout items", () => {
    prefs.railCollapsed = true;
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Administration" }));
    const flyout = screen.getByRole("dialog");
    const items = within(flyout).getAllByRole("button").filter((b) => b.hasAttribute("data-nav-item"));
    items[0]!.focus();
    fireEvent.keyDown(flyout, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
  });
});

describe("pinned favourites", () => {
  it("shows a Pinned group on top with only items the user can still access, in saved order", () => {
    prefs.pinned = ["audit-log", "client-portal", "approvals", "does-not-exist"]; // client-portal: no permission; last: unknown
    mount();
    const group = screen.getByTestId("pinned-group");
    const names = within(group).getAllByRole("button").filter((b) => b.hasAttribute("data-nav-item")).map((b) => b.getAttribute("data-nav-item"));
    expect(names).toEqual(["audit-log", "approvals"]);
    expect(group.compareDocumentPosition(document.querySelector(".cc-section-head")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has no Pinned group when nothing valid is pinned", () => {
    prefs.pinned = ["client-portal"];
    mount();
    expect(screen.queryByTestId("pinned-group")).toBeNull();
  });

  it("pin buttons toggle pins with accessible state; at the limit unpinned items can't be pinned", () => {
    prefs.pinned = ["approvals"];
    mockPath = "/users";
    mount();
    const unpin = within(screen.getByTestId("pinned-group")).getByRole("button", { name: "Unpin Approvals" });
    expect(unpin.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(unpin);
    expect(prefs.togglePin).toHaveBeenCalledWith("approvals");
    const pin = screen.getByRole("button", { name: "Pin Users" });
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(pin);
    expect(prefs.togglePin).toHaveBeenCalledWith("users");

    cleanup();
    prefs.pinned = ["approvals", "my-work", "audit-log", "notification-center", "dashboard", "social-overview", "roles", "automation"];
    mockPath = "/users";
    mount();
    expect(screen.getByRole("button", { name: "Pin Users" })).toBeDisabled();
  });

  it("reorders with Alt+Arrow keys and announces the move", () => {
    prefs.pinned = ["approvals", "my-work", "audit-log"];
    mount();
    const group = screen.getByTestId("pinned-group");
    const second = group.querySelector<HTMLElement>('[data-nav-item="my-work"]')!;
    fireEvent.keyDown(second, { key: "ArrowUp", altKey: true });
    expect(prefs.movePin).toHaveBeenCalledWith("my-work", -1);
    expect(group).toHaveTextContent("My Work moved to position 1 of 3");
    const first = group.querySelector<HTMLElement>('[data-nav-item="approvals"]')!;
    prefs.movePin.mockClear();
    fireEvent.keyDown(first, { key: "ArrowUp", altKey: true }); // already first: ignored
    expect(prefs.movePin).not.toHaveBeenCalled();
  });

  it("reorders by drag and drop", () => {
    prefs.pinned = ["approvals", "my-work", "audit-log"];
    mount();
    const rows = within(screen.getByTestId("pinned-group")).getAllByRole("button").filter((b) => b.hasAttribute("data-nav-item")).map((b) => b.closest(".cc-nav-row")!);
    fireEvent.dragStart(rows[0]!, { dataTransfer: { effectAllowed: "" } });
    fireEvent.drop(rows[2]!);
    expect(prefs.reorderPin).toHaveBeenCalledWith(0, 2);
  });

  it("shows pinned items in the rail flyout too", () => {
    prefs.railCollapsed = true;
    prefs.pinned = ["approvals"];
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Pinned" }));
    expect(within(screen.getByRole("dialog", { name: "Pinned pages" })).getByRole("button", { name: "Approvals" })).toBeInTheDocument();
  });
});
