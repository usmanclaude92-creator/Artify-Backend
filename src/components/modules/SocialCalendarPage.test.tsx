import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ socialApi: { list: vi.fn() }, socialContentApi: { calendar: vi.fn(), reschedule: vi.fn() }, notify: vi.fn(), navigate: vi.fn() }));
let perms = ["social.read", "social.publish"];
vi.mock("../../lib/api", () => ({ socialApi: h.socialApi, socialContentApi: h.socialContentApi }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: perms } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: h.notify }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/social/calendar", navigate: h.navigate }) }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ current: { organizationId: "o1", organizationName: "Org" } }) }));

import { SocialCalendarPage, visibleRange } from "./SocialCalendarPage";

const localNoon = (offsetDays = 0) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
};
const post = (id: string, title: string, status: string, at: Date) => ({ id, title, status, scheduledAt: at.toISOString(), targets: [], body: "", mediaIds: [], timezone: "UTC" });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

beforeEach(() => {
  perms = ["social.read", "social.publish"];
  h.socialApi.list.mockResolvedValue({ accounts: [{ id: "a1", displayName: "Acme" }], providers: [] });
});
afterEach(() => {
  cleanup();
  h.socialApi.list.mockReset();
  Object.values(h.socialContentApi).forEach((m) => m.mockReset());
  h.notify.mockReset();
  h.navigate.mockReset();
});

describe("visibleRange", () => {
  it("month view covers 6 Monday-based weeks; week view 7 days", () => {
    const m = visibleRange(new Date(2031, 4, 14), "month");
    expect(m.days).toBe(42);
    expect(m.start.getDay()).toBe(1);
    expect(visibleRange(new Date(2031, 4, 14), "week")).toMatchObject({ days: 7 });
  });
});

describe("SocialCalendarPage", () => {
  it("shows posts on their day with status, opens a post on click, and offers new-post on a day", async () => {
    const day = localNoon(0);
    h.socialContentApi.calendar.mockResolvedValue({ days: { x: [post("p1", "Spring launch", "SCHEDULED", day)] }, total: 1 });
    render(<SocialCalendarPage />);
    const chip = await screen.findByRole("button", { name: /Spring launch, Scheduled/ });
    expect(chip.closest("[data-day]")?.getAttribute("data-day")).toBe(ymd(day));
    fireEvent.click(chip);
    expect(h.navigate).toHaveBeenCalledWith("/social/compose?post=p1");
    fireEvent.click(screen.getByRole("button", { name: `New post on ${ymd(day)}` }));
    expect(h.navigate).toHaveBeenCalledWith(`/social/compose?date=${ymd(day)}`);
  });

  it("drag to another day reschedules keeping the time of day", async () => {
    const day = localNoon(0);
    const target = localNoon(1);
    h.socialContentApi.calendar.mockResolvedValue({ days: { x: [post("p1", "Movable", "APPROVED", day)] }, total: 1 });
    h.socialContentApi.reschedule.mockResolvedValue({});
    const { container } = render(<SocialCalendarPage />);
    const chip = await screen.findByRole("button", { name: /Movable/ });
    expect(chip).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(chip);
    fireEvent.drop(container.querySelector(`[data-day="${ymd(target)}"]`)!);
    await waitFor(() => expect(h.socialContentApi.reschedule).toHaveBeenCalled());
    const [id, iso] = h.socialContentApi.reschedule.mock.calls[0]!;
    expect(id).toBe("p1");
    const moved = new Date(iso as string);
    expect(ymd(moved)).toBe(ymd(target));
    expect(moved.getHours()).toBe(12);
  });

  it("published/pending posts and read-only users cannot be dragged", async () => {
    h.socialContentApi.calendar.mockResolvedValue({ days: { x: [post("p1", "Locked", "PENDING_APPROVAL", localNoon(0))] }, total: 1 });
    const first = render(<SocialCalendarPage />);
    expect(await screen.findByRole("button", { name: /Locked/ })).toHaveAttribute("draggable", "false");
    first.unmount();
    perms = ["social.read"];
    h.socialContentApi.calendar.mockResolvedValue({ days: { x: [post("p2", "ReadOnly", "APPROVED", localNoon(0))] }, total: 1 });
    render(<SocialCalendarPage />);
    expect(await screen.findByRole("button", { name: /ReadOnly/ })).toHaveAttribute("draggable", "false");
    expect(screen.queryByRole("button", { name: /New post on/ })).toBeNull();
  });

  it("filters by account and status and switches to week view", async () => {
    h.socialContentApi.calendar.mockResolvedValue({ days: {}, total: 0 });
    render(<SocialCalendarPage />);
    await waitFor(() => expect(h.socialContentApi.calendar).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Account"), { target: { value: "a1" } });
    await waitFor(() => expect(h.socialContentApi.calendar).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: "a1" })));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "DRAFT" } });
    await waitFor(() => expect(h.socialContentApi.calendar).toHaveBeenLastCalledWith(expect.objectContaining({ status: "DRAFT" })));
    fireEvent.change(screen.getByLabelText("View"), { target: { value: "week" } });
    await waitFor(() => expect(document.querySelectorAll("[data-day]").length).toBe(7));
  });

  it("shows an error state and a colour legend", async () => {
    h.socialContentApi.calendar.mockRejectedValue(new Error("calendar down"));
    render(<SocialCalendarPage />);
    expect(await screen.findByText("calendar down")).toBeInTheDocument();
    expect(screen.getByLabelText("Status colours")).toBeInTheDocument();
  });

  it("uses a readable agenda list on narrow screens", async () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    h.socialContentApi.calendar.mockResolvedValue({ days: { x: [post("p1", "Phone post", "SCHEDULED", localNoon(0))] }, total: 1 });
    render(<SocialCalendarPage />);
    const item = await screen.findByRole("button", { name: /Phone post, Scheduled/ });
    expect(screen.getByLabelText("Agenda")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
    fireEvent.click(item);
    expect(h.navigate).toHaveBeenCalledWith("/social/compose?post=p1");
    Object.defineProperty(window, "innerWidth", { value: original, configurable: true });
  });
});
