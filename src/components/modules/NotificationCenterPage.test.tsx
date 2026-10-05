/** Phase 16 — Notification Center renders real notifications with filters and entity links, never fabricated. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NotificationCenterPage } from "./NotificationCenterPage";

const listMock = vi.fn();
const markReadMock = vi.fn();
const markAllReadMock = vi.fn();

vi.mock("../../lib/api", () => ({
  notificationsApi: {
    list: (...args: unknown[]) => listMock(...args),
    markRead: (...args: unknown[]) => markReadMock(...args),
    markAllRead: (...args: unknown[]) => markAllReadMock(...args),
  },
}));

const notification = {
  id: "notif-1",
  organizationId: "org-1",
  userId: "user-1",
  type: "task_assigned",
  title: "New task assigned to you",
  message: "Follow up with lead",
  status: "UNREAD" as const,
  entityType: "automation_task",
  entityId: "task-1",
  readAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  markReadMock.mockReset();
  markAllReadMock.mockReset();
});

describe("NotificationCenterPage", () => {
  it("renders real notifications from the API with an entity badge", async () => {
    listMock.mockResolvedValue({ items: [notification], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<NotificationCenterPage />);
    expect(await screen.findByText("New task assigned to you")).toBeInTheDocument();
    expect(screen.getByText(/automation task/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no notifications", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<NotificationCenterPage />);
    expect(await screen.findByText(/no notifications/i)).toBeInTheDocument();
  });

  it("marks a single notification read through the real API", async () => {
    listMock.mockResolvedValue({ items: [notification], page: 1, limit: 20, total: 1, totalPages: 1 });
    markReadMock.mockResolvedValue({ notification: { ...notification, status: "READ" } });
    render(<NotificationCenterPage />);
    fireEvent.click(await screen.findByRole("button", { name: /mark as read/i }));
    await vi.waitFor(() => expect(markReadMock).toHaveBeenCalledWith("notif-1"));
  });

  it("marks all as read through the real API", async () => {
    listMock.mockResolvedValue({ items: [notification], page: 1, limit: 20, total: 1, totalPages: 1 });
    markAllReadMock.mockResolvedValue({ count: 1 });
    render(<NotificationCenterPage />);
    fireEvent.click(await screen.findByRole("button", { name: /mark all read/i }));
    await vi.waitFor(() => expect(markAllReadMock).toHaveBeenCalled());
  });
});
