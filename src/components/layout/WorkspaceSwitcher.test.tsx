import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

let orgs: Array<{ organizationId: string; organizationName: string; roleName: string; isCurrent: boolean }> = [];
const switchMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ organizations: orgs, switchOrganization: switchMock }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));

import { ActiveWorkspaceProvider, useActiveWorkspace } from "../../context/ActiveWorkspaceContext";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const make = (n: number) => Array.from({ length: n }, (_, i) => ({ organizationId: `o${i}`, organizationName: `QA_TEST_2026_ Workspace ${i}`, roleName: "Admin", isCurrent: i === 0 }));
const mount = () =>
  render(
    <ActiveWorkspaceProvider>
      <WorkspaceSwitcher />
    </ActiveWorkspaceProvider>
  );

afterEach(() => {
  cleanup();
  switchMock.mockClear();
});

describe("WorkspaceSwitcher", () => {
  it("is hidden when the user belongs to no workspace or just one", () => {
    orgs = [];
    const { container, unmount } = mount();
    expect(container).toBeEmptyDOMElement();
    unmount();
    orgs = make(1);
    const second = mount();
    expect(second.container).toBeEmptyDOMElement();
  });

  it("shows the current workspace and lists the others without search for a few workspaces", () => {
    orgs = make(3);
    mount();
    const trigger = screen.getByRole("button", { name: /Workspace: QA_TEST_2026_ Workspace 0/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.queryByLabelText("Search workspaces")).toBeNull();
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent("Workspace 0");
  });

  it("adds search when there are many workspaces, filters, and switches on click", async () => {
    orgs = make(9);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Switch workspace/ }));
    const search = screen.getByLabelText("Search workspaces");
    fireEvent.change(search, { target: { value: "workspace 7" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    fireEvent.click(options[0]!);
    await waitFor(() => expect(switchMock).toHaveBeenCalledWith("o7"));
  });

  it("supports the keyboard: arrows + Enter choose, Escape closes and returns focus to the trigger", async () => {
    orgs = make(4);
    mount();
    const trigger = screen.getByRole("button", { name: /Switch workspace/ });
    fireEvent.click(trigger);
    const panel = screen.getByRole("listbox").parentElement!;
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    fireEvent.keyDown(panel, { key: "Enter" });
    await waitFor(() => expect(switchMock).toHaveBeenCalledWith("o1"));

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("listbox").parentElement!, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("exposes the active workspace through useActiveWorkspace", () => {
    orgs = make(2);
    const Probe = () => {
      const w = useActiveWorkspace();
      return <p>{`${w.current?.organizationName}|${w.canSwitch}`}</p>;
    };
    render(
      <ActiveWorkspaceProvider>
        <Probe />
      </ActiveWorkspaceProvider>
    );
    expect(screen.getByText("QA_TEST_2026_ Workspace 0|true")).toBeInTheDocument();
  });
});
