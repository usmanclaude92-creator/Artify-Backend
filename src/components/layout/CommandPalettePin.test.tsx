import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

let mockPath = "/approvals";
const prefs = { pinned: [] as string[], maxPins: 8, isPinned: (id: string) => prefs.pinned.includes(id), togglePin: vi.fn(() => true) };
const user = { role: { permissions: ["approvals.read"] } }; // stable reference: the palette keys effects on it
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("../../context/NavPreferencesContext", () => ({ useNavPreferences: () => prefs }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: mockPath, navigate: vi.fn() }) }));

import { CommandPalette } from "./CommandPalette";

afterEach(() => {
  cleanup();
  prefs.pinned = [];
  prefs.togglePin.mockClear();
  mockPath = "/approvals";
});

describe("command palette: pin current page", () => {
  it("offers 'Pin current page' for a visible page and toggles the pin", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    fireEvent.click(screen.getByText("Pin current page"));
    expect(prefs.togglePin).toHaveBeenCalledWith("approvals");
    expect(onClose).toHaveBeenCalled();
  });

  it("offers 'Unpin current page' when already pinned", () => {
    prefs.pinned = ["approvals"];
    render(<CommandPalette open onClose={() => {}} />);
    expect(screen.getByText("Unpin current page")).toBeInTheDocument();
  });

  it("is absent on a page that isn't a sidebar item, and when the pin limit is reached", () => {
    mockPath = "/not-a-page";
    const first = render(<CommandPalette open onClose={() => {}} />);
    expect(screen.queryByText(/current page/)).toBeNull();
    first.unmount();
    mockPath = "/approvals";
    prefs.pinned = ["a", "b", "c", "d", "e", "f", "g", "h"];
    render(<CommandPalette open onClose={() => {}} />);
    expect(screen.queryByText("Pin current page")).toBeNull();
  });

  it("is findable by typing 'pin'", () => {
    render(<CommandPalette open onClose={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pin" } });
    expect(screen.getByText("Pin current page")).toBeInTheDocument();
  });
});
