/** Blog comment moderation: lists by status, approve/reject through the real API, permission-gated actions. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PostCommentsPage } from "./PostCommentsPage";

const listMock = vi.fn();
const moderateMock = vi.fn();
vi.mock("../../lib/api", () => ({
  postCommentsApi: { list: (...a: unknown[]) => listMock(...a), moderate: (...a: unknown[]) => moderateMock(...a), pendingCount: vi.fn() },
}));
let mockPermissions: string[] = ["content.read", "content.update"];
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: mockPermissions } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));

const comment = {
  id: "c1", authorName: "Reader One", authorRole: "CFO", body: "Great article.", status: "PENDING",
  createdAt: "2026-10-16T10:00:00.000Z", moderatedAt: null, post: { slug: "cas", title: "CAS article" },
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  moderateMock.mockReset();
  mockPermissions = ["content.read", "content.update"];
});

describe("PostCommentsPage", () => {
  it("shows pending comments and approves one through the API", async () => {
    listMock.mockResolvedValue({ comments: [comment] });
    moderateMock.mockResolvedValue({ comment: { id: "c1", status: "APPROVED" } });
    render(<PostCommentsPage />);
    expect(await screen.findByText("Great article.")).toBeTruthy();
    expect(listMock).toHaveBeenCalledWith("PENDING");
    fireEvent.click(screen.getByLabelText("Approve comment"));
    await waitFor(() => expect(moderateMock).toHaveBeenCalledWith("c1", "APPROVED"));
  });

  it("shows an honest empty state", async () => {
    listMock.mockResolvedValue({ comments: [] });
    render(<PostCommentsPage />);
    expect(await screen.findByText("No pending comments")).toBeTruthy();
  });

  it("hides moderation actions without content.update", async () => {
    mockPermissions = ["content.read"];
    listMock.mockResolvedValue({ comments: [comment] });
    render(<PostCommentsPage />);
    await screen.findByText("Great article.");
    expect(screen.queryByLabelText("Approve comment")).toBeNull();
    expect(screen.queryByLabelText("Reject comment")).toBeNull();
  });
});
