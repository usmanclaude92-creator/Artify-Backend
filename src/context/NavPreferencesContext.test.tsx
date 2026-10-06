import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

const getMock = vi.fn();
const updateMock = vi.fn();
vi.mock("../lib/api", () => ({ navPreferencesApi: { get: () => getMock(), update: (p: unknown) => updateMock(p) } }));
vi.mock("./AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", organizationId: "o1" } }) }));

import { NavPreferencesProvider, useNavPreferences } from "./NavPreferencesContext";

let api: ReturnType<typeof useNavPreferences>;
const Probe = () => {
  api = useNavPreferences();
  return (
    <p>
      rail:{String(api.railCollapsed)} pins:{api.pinned.join(",")}
    </p>
  );
};
const mount = () =>
  render(
    <NavPreferencesProvider>
      <Probe />
    </NavPreferencesProvider>
  );

beforeEach(() => {
  localStorage.clear();
  getMock.mockResolvedValue({ railCollapsed: false, pinned: [] });
  updateMock.mockImplementation(async (p: object) => p);
});
afterEach(() => {
  cleanup();
  getMock.mockReset();
  updateMock.mockReset();
});

describe("NavPreferencesProvider", () => {
  it("loads saved preferences from the server", async () => {
    getMock.mockResolvedValue({ railCollapsed: true, pinned: ["approvals", "my-work"] });
    mount();
    expect(await screen.findByText("rail:true pins:approvals,my-work")).toBeInTheDocument();
  });

  it("toggles the rail, persisting server-side and mirroring to localStorage; rolls back if the save fails", async () => {
    mount();
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    act(() => api.toggleRail());
    expect(await screen.findByText(/rail:true/)).toBeInTheDocument();
    expect(updateMock).toHaveBeenCalledWith({ railCollapsed: true });
    expect(localStorage.getItem("artify_cc_rail_collapsed")).toBe("1");

    updateMock.mockRejectedValueOnce(new Error("offline"));
    act(() => api.toggleRail());
    await waitFor(() => expect(screen.getByText(/rail:true/)).toBeInTheDocument()); // rolled back to true
  });

  it("pins, unpins, enforces the 8-item limit and reorders", async () => {
    mount();
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    const ids = Array.from({ length: 8 }, (_, i) => `item-${i}`);
    for (const id of ids) act(() => void api.togglePin(id));
    expect(screen.getByText(`rail:false pins:${ids.join(",")}`)).toBeInTheDocument();
    let accepted = true;
    act(() => {
      accepted = api.togglePin("item-9");
    });
    expect(accepted).toBe(false);
    expect(api.pinned).toHaveLength(8);

    act(() => void api.togglePin("item-3")); // unpin
    expect(api.pinned).not.toContain("item-3");
    expect(updateMock).toHaveBeenLastCalledWith({ pinned: api.pinned });

    act(() => api.movePin("item-0", 2));
    expect(api.pinned.slice(0, 3)).toEqual(["item-1", "item-2", "item-0"]);
    act(() => api.movePin("item-1", -1)); // already first: no-op
    expect(api.pinned[0]).toBe("item-1");
    act(() => api.reorderPin(0, 1));
    expect(api.pinned.slice(0, 2)).toEqual(["item-2", "item-1"]);
  });

  it("reloads (pins are per workspace) — inert defaults without a provider", () => {
    cleanup();
    const Bare = () => <p>pins:{useNavPreferences().pinned.length}</p>;
    render(<Bare />);
    expect(screen.getByText("pins:0")).toBeInTheDocument();
  });
});
