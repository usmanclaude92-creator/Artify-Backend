import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  socialApi: { list: vi.fn() },
  socialContentApi: { constraints: vi.fn(), getPost: vi.fn(), createPost: vi.fn(), updatePost: vi.fn(), action: vi.fn(), aiDraft: vi.fn(), aiRewrite: vi.fn(), contentSources: vi.fn(), reschedule: vi.fn() },
  mediaApi: { list: vi.fn(), get: vi.fn(), getReadUrl: vi.fn() },
  notify: vi.fn(),
  navigate: vi.fn(),
}));
let perms = ["social.read", "social.publish"];
vi.mock("../../lib/api", () => ({ socialApi: h.socialApi, socialContentApi: h.socialContentApi, mediaApi: h.mediaApi }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: perms } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: h.notify }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/social/compose", navigate: h.navigate }) }));

import { SocialComposerPage } from "./SocialComposerPage";

const acct = (id: string, name: string) => ({ id, provider: "mock", externalAccountId: id, displayName: name, handle: `@${id}`, avatarUrl: null, accountType: "PAGE", status: "CONNECTED", scopes: [], tokenExpiresAt: null, lastSyncAt: null, lastError: null, createdAt: "", updatedAt: "" });
const cons = { maxChars: 20, maxHashtags: 1, maxMedia: 2, requiresMedia: false, allowedMediaTypes: [], supportsLink: true, hashtagPrefix: "#", mentionPrefix: "@" };
const post = (over: Record<string, unknown> = {}) => ({
  id: "p1", title: "Launch", body: "Hello", mediaIds: [], linkUrl: null, status: "DRAFT", scheduledAt: null, timezone: "UTC", aiGenerated: false, aiExecutionId: null,
  sourceContentType: null, sourceContentId: null, planId: null, rejectionReason: null, decidedAt: null, guardrailResult: { passed: true, issues: [], checkedAt: "" }, createdAt: "", updatedAt: "",
  createdBy: { id: "u", name: "QA" }, targets: [{ id: "t1", accountId: "a1", bodyOverride: null, status: "PENDING", scheduledAt: null, account: { id: "a1", provider: "mock", displayName: "Acme", handle: "@a1", accountType: "PAGE", status: "CONNECTED", avatarUrl: null } }], ...over,
});

beforeEach(() => {
  perms = ["social.read", "social.publish"];
  h.socialApi.list.mockResolvedValue({ accounts: [acct("a1", "Acme"), acct("a2", "Acme Two")], providers: [] });
  h.socialContentApi.constraints.mockResolvedValue({ a1: cons, a2: { ...cons, maxChars: 100 } });
  window.history.replaceState({}, "", "/social/compose");
  h.mediaApi.getReadUrl.mockResolvedValue({ url: "https://x/y.png" });
});
afterEach(() => {
  cleanup();
  Object.values(h.socialContentApi).forEach((m) => m.mockReset());
  Object.values(h.mediaApi).forEach((m) => m.mockReset());
  h.socialApi.list.mockReset();
  h.notify.mockReset();
  h.navigate.mockReset();
});

const open = async () => {
  render(<SocialComposerPage />);
  await screen.findByLabelText("Internal name");
};
const pick = (name: string) => fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(name) }));

describe("SocialComposerPage", () => {
  it("shows Instagram's media requirements and warns when media is missing", async () => {
    h.socialContentApi.constraints.mockResolvedValue({ a1: { ...cons, maxChars: 2200, requiresMedia: true, allowedMediaTypes: ["image/jpeg"], supportsLink: false, mediaLimits: { imageMaxBytes: 8 * 1048576 }, notes: ["Instagram needs at least one image: text-only posts are rejected.", "JPEG only, up to 8 MB each."] }, a2: cons });
    await open();
    pick("^Acme$");
    const hint = await screen.findByLabelText("Acme media requirements");
    expect(within(hint).getByText(/text-only posts are rejected/)).toBeInTheDocument();
    expect(within(hint).getByText(/JPEG only/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "Caption" } });
    expect(within(screen.getByLabelText("Guardrails")).getByText(/Acme: needs an image or video/)).toBeInTheDocument();
    cleanup();
    await open();
    pick("Acme Two");
    expect(screen.queryByLabelText(/media requirements/)).toBeNull(); // networks without notes show nothing extra
  });

  it("shows per-account tabs, live counters against the network limit and a preview", async () => {
    await open();
    pick("^Acme$");
    pick("Acme Two");
    expect(screen.getByRole("tab", { name: "Shared text" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Acme Two" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "This text is definitely longer than twenty characters #a #b" } });
    expect(screen.getByText(/characters · 2 hashtags/)).toHaveTextContent("/ 20");
    expect(screen.getByText("Over the limit")).toBeInTheDocument();
    const guard = screen.getByLabelText("Guardrails");
    expect(within(guard).getByText(/Acme: .*\/20 characters/)).toBeInTheDocument();
    expect(within(guard).getAllByText(/more than 1 hashtags/).length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText("Preview")).getByText(/definitely longer/)).toBeInTheDocument();

    // a per-account override replaces the shared text for that account only
    fireEvent.click(screen.getByRole("tab", { name: "Acme Two" }));
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "Short for two" } });
    expect(within(screen.getByLabelText("Preview")).getByText("Short for two")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Guardrails")).queryByText(/Acme Two: .*characters/)).toBeNull();
  });

  it("saves a draft with accounts and overrides, then keeps the saved post", async () => {
    h.socialContentApi.createPost.mockImplementation(async (input) => post({ title: input.title, body: input.body, targets: post().targets }));
    await open();
    fireEvent.change(screen.getByLabelText("Internal name"), { target: { value: "Spring" } });
    pick("^Acme$");
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "Hi all" } });
    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(h.socialContentApi.createPost).toHaveBeenCalled());
    expect(h.socialContentApi.createPost.mock.calls[0]![0]).toMatchObject({ title: "Spring", body: "Hi all", accountIds: ["a1"], bodyOverrides: {}, mediaIds: [], linkUrl: null });
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith("Draft saved.", "success"));
    expect(window.location.search).toBe("?post=p1");
  });

  it("submit saves first, then asks for approval; blocking guardrail issues from the server are shown", async () => {
    h.socialContentApi.createPost.mockResolvedValue(post());
    h.socialContentApi.action.mockRejectedValue(new (await import("../../lib/apiClient")).ApiClientError("Fix the blocking guardrail issues before continuing.", { code: "VALIDATION_ERROR", status: 400 }));
    h.socialContentApi.getPost.mockResolvedValue(post({ guardrailResult: { passed: false, issues: [{ rule: "banned_word", severity: "block", message: "Acme: contains the banned word “guarantee”." }], checkedAt: "" } }));
    await open();
    pick("^Acme$");
    fireEvent.change(screen.getByLabelText("Post text"), { target: { value: "We guarantee" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit for approval/ }));
    await waitFor(() => expect(h.socialContentApi.action).toHaveBeenCalledWith("p1", "submit", {}));
    await waitFor(() => expect(h.notify).toHaveBeenCalledWith("Fix the blocking guardrail issues before continuing.", "error"));
    expect(await screen.findByText(/banned word/)).toBeInTheDocument();
  });

  it("locks editing while awaiting approval; approvers can approve or reject with a comment", async () => {
    perms = ["social.read", "social.approve"];
    window.history.replaceState({}, "", "/social/compose?post=p1");
    h.socialContentApi.getPost.mockResolvedValue(post({ status: "PENDING_APPROVAL" }));
    h.socialContentApi.action.mockResolvedValue(post({ status: "REJECTED", rejectionReason: "Tone" }));
    render(<SocialComposerPage />);
    expect(await screen.findByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.getByLabelText("Post text")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Save draft/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Comment"), { target: { value: "Tone" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(h.socialContentApi.action).toHaveBeenCalledWith("p1", "reject", { comment: "Tone" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Rejected: Tone");
  });

  it("publishers cannot approve; an approved post can be scheduled with a timezone-correct UTC time", async () => {
    window.history.replaceState({}, "", "/social/compose?post=p1");
    h.socialContentApi.getPost.mockResolvedValue(post({ status: "APPROVED", timezone: "America/New_York" }));
    h.socialContentApi.action.mockResolvedValue(post({ status: "SCHEDULED" }));
    render(<SocialComposerPage />);
    await screen.findByText("Approved");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Date and time"), { target: { value: "2031-07-15T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: /^Schedule$/ }));
    await waitFor(() => expect(h.socialContentApi.action).toHaveBeenCalledWith("p1", "schedule", { scheduledAt: "2031-07-15T13:00:00.000Z", timezone: "America/New_York" }));
  });

  it("AI assist drafts from a brief and rewrites with undo", async () => {
    h.socialContentApi.aiDraft.mockResolvedValue({ post: post({ aiGenerated: true, body: "AI wrote this" }), executionId: "e1" });
    h.socialContentApi.aiRewrite.mockResolvedValue({ post: post({ aiGenerated: true, body: "Shorter" }), previousBody: "AI wrote this", executionId: "e2" });
    h.socialContentApi.updatePost.mockResolvedValue(post({ body: "AI wrote this" }));
    await open();
    pick("^Acme$");
    fireEvent.change(screen.getByLabelText("What should this post say?"), { target: { value: "Announce spring" } });
    fireEvent.click(screen.getByRole("button", { name: /Draft with AI/ }));
    await waitFor(() => expect(h.socialContentApi.aiDraft).toHaveBeenCalledWith({ instruction: "Announce spring", accountIds: ["a1"] }));
    expect(await screen.findByText("AI draft")).toBeInTheDocument();
    expect(screen.getByLabelText("Post text")).toHaveValue("AI wrote this");

    fireEvent.click(screen.getByRole("button", { name: "Shorten" }));
    await waitFor(() => expect(h.socialContentApi.aiRewrite).toHaveBeenCalledWith("p1", { action: "shorten" }));
    await waitFor(() => expect(screen.getByLabelText("Post text")).toHaveValue("Shorter"));
    fireEvent.click(screen.getByRole("button", { name: /Undo AI change/ }));
    await waitFor(() => expect(h.socialContentApi.updatePost).toHaveBeenCalledWith("p1", { body: "AI wrote this" }));
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(h.notify).toHaveBeenCalledWith("Enter a language to translate into.", "error");
  });

  it("shares existing content: fills title, text, link and records the source", async () => {
    h.socialContentApi.contentSources.mockResolvedValue([{ type: "post", id: "c1", title: "Big Launch", excerpt: "All about it.", url: "https://artifysols.com/blog/big-launch", featuredMediaId: null }]);
    h.socialContentApi.createPost.mockResolvedValue(post());
    await open();
    pick("^Acme$");
    fireEvent.click(screen.getByRole("button", { name: /Share a blog post/ }));
    fireEvent.click(await screen.findByText("Big Launch"));
    expect(screen.getByLabelText("Internal name")).toHaveValue("Big Launch");
    expect(screen.getByLabelText("Link (optional)")).toHaveValue("https://artifysols.com/blog/big-launch");
    expect(screen.getByLabelText("Post text")).toHaveValue("Big Launch\n\nAll about it.\n\nhttps://artifysols.com/blog/big-launch");
    fireEvent.click(screen.getByRole("button", { name: /Save draft/ }));
    await waitFor(() => expect(h.socialContentApi.createPost.mock.calls[0]![0].sourceContent).toEqual({ type: "post", id: "c1" }));
  });

  it("explains when there are no connected accounts", async () => {
    h.socialApi.list.mockResolvedValue({ accounts: [], providers: [] });
    await open();
    expect(screen.getByText(/No connected accounts yet/)).toBeInTheDocument();
  });
});
