import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const listMock = vi.fn();
const decideMock = vi.fn();
const notifyMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../lib/api", () => ({ approvalsApi: { list: (...a: unknown[]) => listMock(...a), decide: (...a: unknown[]) => decideMock(...a) } }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/approvals", navigate: navigateMock }) }));

import { ApprovalsPage } from "./ApprovalsPage";

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "a1",
  source: "ai",
  title: "create_invoice",
  summary: "invoice 42",
  requestedBy: { id: "u1", name: "Sam Lee" },
  requestedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  status: "pending",
  dueAt: null,
  link: "/ai/approvals",
  decidedBy: null,
  decidedAt: null,
  decisionComment: null,
  canDecide: true,
  ...over,
});
const page = (items: unknown[]) => ({ items, sources: ["ai", "automation", "content"], total: items.length, page: 1, totalPages: 1 });

afterEach(() => {
  cleanup();
  listMock.mockReset();
  decideMock.mockReset();
  notifyMock.mockReset();
  navigateMock.mockReset();
});

describe("ApprovalsPage", () => {
  it("lists pending approvals with source badge, title, requester and age; defaults to the Pending tab", async () => {
    listMock.mockResolvedValue(page([row()]));
    render(<ApprovalsPage />);
    expect(await screen.findByText("create_invoice")).toBeInTheDocument();
    expect(screen.getAllByText("AI").some((el) => el.tagName === "SPAN")).toBe(true);
    expect(screen.getByText(/Sam Lee · 2h ago/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Pending", selected: true })).toBeInTheDocument();
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", assignee: "all" }));
  });

  it("switches tabs and source filter, sending them to the API", async () => {
    listMock.mockResolvedValue(page([row()]));
    render(<ApprovalsPage />);
    await screen.findByText("create_invoice");
    fireEvent.click(screen.getByRole("tab", { name: "Rejected" }));
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: "rejected" })));
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "content" } });
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ source: "content" })));
  });

  it("shows empty and error states", async () => {
    listMock.mockResolvedValueOnce(page([]));
    const { unmount } = render(<ApprovalsPage />);
    expect(await screen.findByText("Nothing waiting on you")).toBeInTheDocument();
    unmount();
    listMock.mockRejectedValueOnce(new Error("boom"));
    render(<ApprovalsPage />);
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("opens a drawer; reject needs a comment, approve calls the center API and refreshes", async () => {
    listMock.mockResolvedValue(page([row()]));
    decideMock.mockResolvedValue({});
    render(<ApprovalsPage />);
    fireEvent.click(await screen.findByText("create_invoice"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("invoice 42");

    const reject = screen.getByRole("button", { name: /Reject/ });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Comment/), { target: { value: "too risky" } });
    expect(reject).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(decideMock).toHaveBeenCalledWith("ai", "a1", "approve", "too risky"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("rejects with the comment", async () => {
    listMock.mockResolvedValue(page([row()]));
    decideMock.mockResolvedValue({});
    render(<ApprovalsPage />);
    fireEvent.click(await screen.findByText("create_invoice"));
    fireEvent.change(await screen.findByLabelText(/Comment/), { target: { value: "no" } });
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    await waitFor(() => expect(decideMock).toHaveBeenCalledWith("ai", "a1", "reject", "no"));
  });

  it("hides decision controls when the caller cannot decide, and closes on Escape; deep link navigates", async () => {
    listMock.mockResolvedValue(page([row({ canDecide: false })]));
    render(<ApprovalsPage />);
    fireEvent.click(await screen.findByText("create_invoice"));
    expect(await screen.findByText(/do not have permission to decide/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open source item/ }));
    expect(navigateMock).toHaveBeenCalledWith("/ai/approvals");

    fireEvent.click(await screen.findByText("create_invoice"));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
