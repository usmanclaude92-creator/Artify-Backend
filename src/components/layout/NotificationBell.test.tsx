/** The bell dropdown links each notification to its page, marks it read, and respects page permissions. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotificationBell } from "./NotificationBell";

const navigateMock = vi.fn();
const markReadMock = vi.fn();
let mockPermissions: string[] = ["content.read"];

vi.mock("../../lib/api", () => ({
  notificationsApi: {
    unreadCount: () => Promise.resolve({ count: 1 }),
    list: () =>
      Promise.resolve({
        items: [
          { id: "n1", organizationId: "o", userId: "u", type: "post_comment_pending", title: "New blog comment awaiting review", message: "Reader One commented.", status: "UNREAD", entityType: "post_comment", entityId: "c1", readAt: null, createdAt: new Date().toISOString() },
          { id: "n2", organizationId: "o", userId: "u", type: "something_new", title: "Unmapped", message: "No destination.", status: "READ", entityType: null, entityId: null, readAt: null, createdAt: new Date().toISOString() },
        ],
      }),
    markRead: (...a: unknown[]) => markReadMock(...a),
    markAllRead: vi.fn(),
  },
}));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPermissions } } }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/", navigate: navigateMock }) }));

afterEach(() => {
  cleanup();
  navigateMock.mockReset();
  markReadMock.mockReset();
  mockPermissions = ["content.read"];
});

describe("NotificationBell jump links", () => {
  it("opens the related page and marks the notification read", async () => {
    markReadMock.mockResolvedValue({});
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    fireEvent.click(await screen.findByLabelText("Open Blog Comments"));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/cms/comments"));
    expect(markReadMock).toHaveBeenCalledWith("n1");
  });

  it("shows a link only where there is a destination the person may open", async () => {
    mockPermissions = [];
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await screen.findByText("Unmapped");
    expect(screen.queryByLabelText("Open Blog Comments")).toBeNull();
    mockPermissions = ["content.read"];
  });

  it("an unmapped notification has no link even with full access", async () => {
    render(<NotificationBell />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await screen.findByText("Unmapped");
    expect(screen.getAllByLabelText(/^Open /)).toHaveLength(1);
  });
});
