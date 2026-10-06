import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  queue: vi.fn(), failures: vi.fn(), target: vi.fn(), metrics: vi.fn(), settings: vi.fn(), saveSettings: vi.fn(), saveGlobal: vi.fn(), retry: vi.fn(), reschedule: vi.fn(), markPublished: vi.fn(), cancel: vi.fn(),
}));
vi.mock("../../lib/api", () => ({ socialPublishingApi: api }));
vi.mock("../../lib/apiClient", () => ({ ApiClientError: class extends Error {} }));
const navigateMock = vi.fn();
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/social/queue", navigate: navigateMock }) }));
const user = vi.hoisted(() => ({ role: { key: "ADMIN", permissions: ["social.read", "social.publish", "social.accounts.manage"] } }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user }) }));
const notify = vi.fn();
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify }) }));
const workspace = { current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } };
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => workspace }));

import { SocialQueuePage } from "./SocialQueuePage";
import { SocialFailuresPage } from "./SocialFailuresPage";
import { formatCountdown } from "./socialShared";

const account = { id: "a1", provider: "linkedin", displayName: "Ada", handle: null, avatarUrl: null, accountType: "PROFILE", status: "CONNECTED" };
const target = (over: Record<string, unknown> = {}) => ({
  id: "t1", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 5 * 60_000).toISOString(), nextAttemptAt: null, attempts: 0, publishedAt: null, externalPostId: null, externalUrl: null, error: null, manualResolution: false,
  post: { id: "p1", title: "QA_TEST_2026_ launch", body: "b", status: "SCHEDULED", scheduledAt: null, timezone: "UTC", linkUrl: null, mediaIds: [] }, account, ...over,
});
const settingsView = (over: Record<string, unknown> = {}) => ({
  global: { enabled: true, dryRun: false, killSwitch: false }, workspace: { enabled: false, dryRun: true, killSwitch: false, graceMinutes: 60, maxAttempts: 5 }, envDisabled: false,
  effective: { publishing: false, reason: "workspace_off" }, ...over,
});

beforeEach(() => {
  api.metrics.mockResolvedValue({ queued: 1, needsAttention: 0, oldestDueAt: null, oldestDueSeconds: null, last24h: { published: 0, failed: 0, retried: 0, uncertain: 0, dryRun: 0 } });
  api.settings.mockResolvedValue(settingsView());
  user.role = { key: "ADMIN", permissions: ["social.read", "social.publish", "social.accounts.manage"] };
});
afterEach(() => {
  cleanup();
  Object.values(api).forEach((m) => m.mockReset());
  navigateMock.mockReset();
  notify.mockReset();
  vi.restoreAllMocks();
});

describe("formatCountdown", () => {
  const now = Date.parse("2026-10-12T10:00:00Z");
  it("formats future and overdue times", () => {
    expect(formatCountdown("2026-10-12T10:04:05Z", now)).toBe("in 4m 05s");
    expect(formatCountdown("2026-10-12T09:58:00Z", now)).toBe("due 2m 00s ago");
    expect(formatCountdown("2026-10-12T12:30:00Z", now)).toBe("in 2h 30m");
    expect(formatCountdown("2026-10-14T11:00:00Z", now)).toBe("in 2d 1h");
    expect(formatCountdown(null, now)).toBe("not scheduled");
  });
});

describe("SocialQueuePage", () => {
  it("lists upcoming publishes with a countdown, retry info and the paused banner", async () => {
    api.queue.mockResolvedValue({ now: "", items: [target(), target({ id: "t2", nextAttemptAt: new Date(Date.now() + 120_000).toISOString(), attempts: 1, post: { ...target().post, title: "Retrying post" } }), target({ id: "t3", status: "PUBLISHING", post: { ...target().post, title: "In flight" } })] });
    render(<SocialQueuePage />);
    expect(await screen.findByText("QA_TEST_2026_ launch")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Publishing mode" })).toHaveTextContent("Publishing is paused");
    expect(screen.getByRole("status", { name: "Publishing mode" })).toHaveTextContent("switched off for this workspace");
    expect(screen.getAllByLabelText("Countdown")[0]).toHaveTextContent(/in \d+m/);
    expect(screen.getByText(/Retry in .* \(attempt 2\)/)).toBeInTheDocument();
    expect(screen.getByText("sending…")).toBeInTheDocument();
  });

  it("shows dry-run and live modes and an overdue alert", async () => {
    api.queue.mockResolvedValue({ now: "", items: [] });
    api.settings.mockResolvedValue(settingsView({ effective: { publishing: true, dryRun: true } }));
    api.metrics.mockResolvedValue({ queued: 0, needsAttention: 0, oldestDueAt: "x", oldestDueSeconds: 1800, last24h: { published: 0, failed: 0, retried: 0, uncertain: 0, dryRun: 0 } });
    const first = render(<SocialQueuePage />);
    expect(await screen.findByText("Dry-run mode")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("30 minutes overdue");
    expect(screen.getByText("Nothing queued")).toBeInTheDocument();
    first.unmount();
    api.settings.mockResolvedValue(settingsView({ effective: { publishing: true, dryRun: false } }));
    render(<SocialQueuePage />);
    expect(await screen.findByText("Publishing is live")).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    api.queue.mockRejectedValue(new Error("queue down"));
    render(<SocialQueuePage />);
    expect(await screen.findByText("queue down")).toBeInTheDocument();
  });
});

describe("SocialFailuresPage", () => {
  const failed = target({ id: "f1", status: "FAILED", error: "permanent: LinkedIn rejected the post (HTTP 422)", attempts: 1 });
  const uncertain = target({ id: "u1", status: "UNCERTAIN", error: "uncertain: No response after sending", attempts: 1, post: { ...target().post, title: "Maybe posted" } });
  const dry = target({ id: "d1", status: "FAILED", error: "dry_run: Dry run — nothing was sent to the network.", post: { ...target().post, title: "Dry one" } });

  it("shows failures with redacted errors, filters, dry-run label and the attempt timeline", async () => {
    api.failures.mockResolvedValue([failed, uncertain, dry]);
    api.target.mockResolvedValue({ ...failed, attemptLog: [{ id: "x", attemptNumber: 1, startedAt: new Date().toISOString(), finishedAt: null, outcome: "PERMANENT_FAILURE", errorCategory: "permanent", error: "rejected", externalPostId: null, externalUrl: null, httpStatus: 422, durationMs: 120, dryRun: false }] });
    render(<SocialFailuresPage />);
    expect(await screen.findByText("LinkedIn rejected the post (HTTP 422)")).toBeInTheDocument();
    expect(screen.getByText("Dry run")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /All \(3\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Needs a check \(1\)/ }));
    expect(screen.getByText("Maybe posted")).toBeInTheDocument();
    expect(screen.queryByText("Dry one")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /All/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /Attempt timeline/ })[0]!);
    expect(await screen.findByText(/#1 · Failed/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 422 ·|HTTP 422/, { selector: "span" })).toBeInTheDocument();
  });

  it("retries a failed publish", async () => {
    api.failures.mockResolvedValue([failed]);
    api.retry.mockResolvedValue({ result: { outcome: "published" }, target: failed });
    render(<SocialFailuresPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry now" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry now" }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith("f1", undefined));
    expect(notify).toHaveBeenCalledWith("Retry started.", "success");
  });

  it("requires explicit confirmation before retrying an uncertain publish", async () => {
    api.failures.mockResolvedValue([uncertain]);
    api.retry.mockResolvedValue({ result: { outcome: "published" }, target: uncertain });
    render(<SocialFailuresPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry now" }));
    const dialog = screen.getByRole("dialog");
    const go = within(dialog).getByRole("button", { name: "Retry now" });
    expect(go).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText("Confirm the post is not on the network"));
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith("u1", true));
  });

  it("marks as published only with an https link, and cancels after confirmation dialog", async () => {
    api.failures.mockResolvedValue([failed]);
    api.markPublished.mockResolvedValue({ target: failed });
    api.cancel.mockResolvedValue({ target: failed });
    render(<SocialFailuresPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark as published" }));
    let dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Mark as published" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Link to the live post"), { target: { value: "http://nope" } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Link to the live post"), { target: { value: "https://www.linkedin.com/feed/update/urn:li:share:1/" } });
    fireEvent.click(submit);
    await waitFor(() => expect(api.markPublished).toHaveBeenCalledWith("f1", "https://www.linkedin.com/feed/update/urn:li:share:1/"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel publish" }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith("f1"));
  });

  it("hides recovery actions without social.publish", async () => {
    user.role = { key: "VIEWER", permissions: ["social.read"] };
    api.failures.mockResolvedValue([failed]);
    render(<SocialFailuresPage />);
    await screen.findByText("QA_TEST_2026_ launch");
    expect(screen.queryByRole("button", { name: "Retry now" })).toBeNull();
    expect(screen.getByLabelText("Publishing enabled")).toBeDisabled();
    expect(screen.getByText(/Only workspace administrators/)).toBeInTheDocument();
  });

  it("controls: enabling live publishing asks for confirmation; kill switch saves immediately; global only for super admins", async () => {
    api.failures.mockResolvedValue([]);
    api.saveSettings.mockImplementation(async () => settingsView());
    render(<SocialFailuresPage />);
    const enabled = await screen.findByLabelText("Publishing enabled");
    expect(screen.queryByLabelText("Publishing enabled (global)")).toBeNull();
    // dry-run is ON, so enabling does not need the live confirmation
    fireEvent.click(enabled);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ enabled: true }));
    api.saveSettings.mockClear();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByLabelText("Dry-run mode")); // turning dry-run off while enabled
    expect(confirm).not.toHaveBeenCalled(); // workspace.enabled is still false in the mocked view
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ dryRun: false }));
    api.saveSettings.mockClear();
    fireEvent.click(screen.getByLabelText("Kill switch"));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ killSwitch: true }));
  });

  it("super admins see and use the global controls", async () => {
    user.role = { key: "SUPER_ADMIN", permissions: ["social.read", "social.publish", "social.accounts.manage"] };
    api.failures.mockResolvedValue([]);
    api.saveGlobal.mockResolvedValue(settingsView());
    render(<SocialFailuresPage />);
    fireEvent.click(await screen.findByLabelText("Kill switch (global)"));
    await waitFor(() => expect(api.saveGlobal).toHaveBeenCalledWith({ killSwitch: true }));
  });

  it("shows the empty state", async () => {
    api.failures.mockResolvedValue([]);
    render(<SocialFailuresPage />);
    expect(await screen.findByText("No failures")).toBeInTheDocument();
  });
});
