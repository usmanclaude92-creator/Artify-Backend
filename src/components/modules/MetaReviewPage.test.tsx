/** Step 15 UI: the demo workspace page shows the one-time password once and asks before removing. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MetaReviewPage } from "./MetaReviewPage";

const api = vi.hoisted(() => ({ status: vi.fn(), seed: vi.fn(), remove: vi.fn() }));
vi.mock("../../lib/api", () => ({ metaReviewApi: api }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));
afterEach(() => { cleanup(); Object.values(api).forEach((m) => m.mockReset()); });

describe("MetaReviewPage", () => {
  it("creates the workspace and shows the password once", async () => {
    api.status.mockResolvedValueOnce({ seeded: false }).mockResolvedValue({ seeded: true, organizationId: "o", reviewerEmail: "meta-reviewer@artifysols.com", counts: { accounts: 2, conversations: 4, posts: 2, users: 1 }, createdAt: new Date().toISOString() });
    api.seed.mockResolvedValue({ organizationId: "o", reviewerEmail: "meta-reviewer@artifysols.com", reviewerPassword: "Once-Only-Pass-123", note: "" });
    render(<MetaReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Create demo workspace" }));
    expect(await screen.findByTestId("reviewer-password")).toHaveTextContent("Once-Only-Pass-123");
    expect(await screen.findByText(/stored only as a hash/)).toBeInTheDocument();
  });
  it("asks for confirmation before removing", async () => {
    api.status.mockResolvedValue({ seeded: true, organizationId: "o", reviewerEmail: "meta-reviewer@artifysols.com", counts: { accounts: 2, conversations: 4, posts: 2, users: 1 }, createdAt: new Date().toISOString() });
    api.remove.mockResolvedValue({ removed: true });
    render(<MetaReviewPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove demo workspace" }));
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledTimes(1));
  });
});
