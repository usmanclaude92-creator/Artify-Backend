import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const api = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), metrics: vi.fn(), assignees: vi.fn(), draft: vi.fn(), editDraft: vi.fn(), reply: vi.fn(), note: vi.fn(), setStatus: vi.fn(), setPriority: vi.fn(), assign: vi.fn(),
  markRead: vi.fn(), hide: vi.fn(), createLead: vi.fn(), bulk: vi.fn(), settings: vi.fn(), saveSettings: vi.fn(), rules: vi.fn(), saveRule: vi.fn(), deleteRule: vi.fn(), canned: vi.fn(), saveCanned: vi.fn(), deleteCanned: vi.fn(),
}));
vi.mock("../../lib/api", () => ({ socialInboxApi: api, socialApi: { list: () => Promise.resolve({ accounts: [{ id: "a1", displayName: "Artify Official" }], providers: [] }) } }));
vi.mock("../../lib/apiClient", () => ({ ApiClientError: class extends Error {} }));
const user = vi.hoisted(() => ({ role: { key: "ADMIN", permissions: ["social.read", "social.reply", "social.accounts.manage"] } }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user }) }));
const notify = vi.fn();
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify }) }));
const workspace = { current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } };
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => workspace }));

import { SocialInboxPage } from "./SocialInboxPage";
import { formatDuration, shortAgo } from "./socialInboxShared";

const account = { id: "a1", provider: "mock", displayName: "Artify Official", handle: "@artify", accountType: "PAGE", status: "CONNECTED", avatarUrl: null };
const conv = (over: Record<string, unknown> = {}) => ({
  id: "c1", type: "COMMENT", status: "OPEN", priority: "NORMAL", intent: "question", sentiment: "neutral", needsHuman: false, tags: [], isRead: true,
  participant: { externalId: "p1", handle: "@ada", name: "Ada Lovelace" }, subjectRef: null, assigneeId: null, lastMessageAt: new Date().toISOString(), firstResponseAt: null, slaDueAt: null, overdue: false,
  leadId: null, contactId: null, account, preview: "What are your opening hours?", failedSend: false, ...over,
});
const msg = (over: Record<string, unknown> = {}) => ({ id: "m1", direction: "INBOUND", authorKind: "CUSTOMER", body: "What are your opening hours?", sendStatus: "RECEIVED", sendError: null, sentById: null, sentAt: null, hidden: false, aiConfidence: null, guardrailResult: null, autoSent: false, createdAt: new Date().toISOString(), ...over });
const detail = (c = conv(), messages = [msg()], triage: unknown = null) => ({ conversation: c, messages, triage });

beforeEach(() => {
  window.innerWidth = 1280;
  api.metrics.mockResolvedValue({ open: 4, overdue: 1, unassigned: 2, medianFirstResponseMs: 12 * 60_000, answeredLast30d: 9 });
  api.assignees.mockResolvedValue([{ id: "u1", name: "Sam Agent" }]);
  api.canned.mockResolvedValue([{ id: "k1", title: "Opening hours", body: "We open at 9.", category: null, approvedForAuto: false, matchKeywords: [] }]);
  api.list.mockResolvedValue({ conversations: [conv()], total: 1, page: 1, limit: 50 });
  api.get.mockResolvedValue(detail());
  api.markRead.mockResolvedValue({});
  api.settings.mockResolvedValue({ autoTriage: true, autoDraft: false, autoReply: false, autoLead: false, firstResponseMinutes: 60, retentionDays: 180 });
  api.rules.mockResolvedValue([]);
  user.role = { key: "ADMIN", permissions: ["social.read", "social.reply", "social.accounts.manage"] };
});
afterEach(() => { cleanup(); Object.values(api).forEach((m) => m.mockReset()); notify.mockReset(); window.history.replaceState({}, "", "/"); vi.restoreAllMocks(); });

const openFirst = async () => { render(<SocialInboxPage />); fireEvent.click(await screen.findByRole("button", { name: /Ada Lovelace/ })); await screen.findByLabelText("Conversation thread"); };

describe("helpers", () => {
  it("formats durations and ages", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(30_000)).toBe("<1m");
    expect(formatDuration(25 * 60_000)).toBe("25m");
    expect(formatDuration(125 * 60_000)).toBe("2h 05m");
    expect(formatDuration(50 * 3600_000)).toBe("2d 2h");
    expect(shortAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m");
    expect(shortAgo(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe("3h");
  });
});

describe("SocialInboxPage list", () => {
  it("shows metrics, unread/overdue/unassigned/negative/needs-human/send-failed badges and an empty state", async () => {
    api.list.mockResolvedValue({ conversations: [conv({ isRead: false, overdue: true, sentiment: "negative", needsHuman: true, failedSend: true, priority: "URGENT" })], total: 1, page: 1, limit: 50 });
    render(<SocialInboxPage />);
    expect(await screen.findByText("Overdue", { selector: "span" })).toBeInTheDocument();
    for (const t of ["Unassigned", "Negative", "Needs a human", "Send failed", "Urgent"]) expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Unread", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("12m")).toBeInTheDocument(); // median first reply
    cleanup();
    api.list.mockResolvedValue({ conversations: [], total: 0, page: 1, limit: 50 });
    render(<SocialInboxPage />);
    expect(await screen.findByText("Nothing here")).toBeInTheDocument();
  });

  it("applies filters and search through the API", async () => {
    render(<SocialInboxPage />);
    await screen.findByText("Ada Lovelace");
    fireEvent.change(screen.getByLabelText("Filter by assignee"), { target: { value: "me" } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ assignee: "me", status: "OPEN" })));
    fireEvent.change(screen.getByLabelText("Filter by sentiment"), { target: { value: "negative" } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ sentiment: "negative" })));
    fireEvent.click(screen.getByLabelText("Overdue only"));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ overdue: true })));
    fireEvent.change(screen.getByLabelText("Search the inbox"), { target: { value: "hours" } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "hours" })));
  });

  it("runs bulk actions on selected conversations", async () => {
    api.bulk.mockResolvedValue({ updated: 1 });
    render(<SocialInboxPage />);
    fireEvent.click(await screen.findByLabelText("Select Ada Lovelace"));
    const bar = screen.getByRole("toolbar", { name: "Bulk actions" });
    fireEvent.click(within(bar).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(api.bulk).toHaveBeenCalledWith(["c1"], { status: "RESOLVED" }));
    expect(notify).toHaveBeenCalledWith("1 updated.", "success");
  });
});

describe("conversation view", () => {
  it("shows the thread, internal notes and the AI triage, marking unread items as read", async () => {
    api.get.mockResolvedValue(detail(conv({ isRead: false }), [msg(), msg({ id: "n1", direction: "OUTBOUND", authorKind: "NOTE", body: "VIP customer", sendStatus: "RECEIVED" })], { intent: "question", sentiment: "neutral", priority: "NORMAL", language: "en", spamScore: 0, category: "general", confidence: 0.91, source: "AI", flaggedForHuman: false }));
    await openFirst();
    expect(screen.getByText("Internal note — not sent")).toBeInTheDocument();
    expect(screen.getByLabelText("AI triage")).toHaveTextContent("confidence 91%");
    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith("c1", true));
  });

  it("flags AI-unavailable triage and human-review items", async () => {
    api.get.mockResolvedValue(detail(conv(), [msg()], { intent: "other", sentiment: "neutral", priority: "NORMAL", language: null, spamScore: 0, category: null, confidence: null, source: "FALLBACK", flaggedForHuman: true }));
    await openFirst();
    expect(screen.getByText("AI unavailable — review manually")).toBeInTheDocument();
    expect(screen.getAllByText("Needs a human").length).toBeGreaterThan(0);
  });

  it("generates an AI draft with confidence and guardrail result, and a person sends it", async () => {
    api.draft.mockResolvedValue({ messageId: "d1", body: "We open at 9am.", confidence: 0.92, guardrail: { passed: true, issues: [], checkedAt: "" } });
    api.editDraft.mockResolvedValue({});
    api.reply.mockResolvedValue({ id: "d1", sendStatus: "SENT", sendError: null });
    await openFirst();
    fireEvent.click(screen.getByRole("button", { name: /AI draft/ }));
    const box = await screen.findByLabelText("Reply text");
    await waitFor(() => expect(box).toHaveValue("We open at 9am."));
    expect(screen.getByText("Confidence 92%")).toBeInTheDocument();
    expect(screen.getByText("Guardrails passed")).toBeInTheDocument();
    expect(api.reply).not.toHaveBeenCalled(); // nothing is sent by generating a draft
    fireEvent.change(box, { target: { value: "We open at 9am, Monday to Friday." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.reply).toHaveBeenCalledWith("c1", { messageId: "d1", resolve: false }));
    expect(api.editDraft).toHaveBeenCalledWith("d1", "We open at 9am, Monday to Friday.");
    expect(notify).toHaveBeenCalledWith("Reply sent.", "success");
  });

  it("shows failed guardrails with their reasons", async () => {
    api.draft.mockResolvedValue({ messageId: "d1", body: "We guarantee it", confidence: 0.6, guardrail: { passed: false, issues: [{ rule: "banned_word", severity: "block", message: "contains the banned word “guarantee”." }], checkedAt: "" } });
    await openFirst();
    fireEvent.click(screen.getByRole("button", { name: /AI draft/ }));
    expect(await screen.findByText("Guardrails failed")).toBeInTheDocument();
    expect(screen.getByText(/banned word/)).toBeInTheDocument();
    expect(screen.getByText("Confidence 60%")).toBeInTheDocument();
  });

  it("sends a typed reply, send-and-resolve, and reports a failure instead of pretending it was sent", async () => {
    api.reply.mockResolvedValueOnce({ id: "x", sendStatus: "SENT", sendError: null }).mockResolvedValueOnce({ id: "y", sendStatus: "FAILED", sendError: "transient: Mock: service unavailable." });
    await openFirst();
    fireEvent.change(screen.getByLabelText("Reply text"), { target: { value: "Hello!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send & resolve" }));
    await waitFor(() => expect(api.reply).toHaveBeenCalledWith("c1", { body: "Hello!", resolve: true }));
    fireEvent.change(screen.getByLabelText("Reply text"), { target: { value: "Again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Mock: service unavailable.", "error"));
  });

  it("internal notes are added without sending anything", async () => {
    api.note.mockResolvedValue({ id: "n" });
    await openFirst();
    fireEvent.click(screen.getByLabelText("Internal note", { selector: "input" }));
    fireEvent.change(screen.getByLabelText("Internal note", { selector: "textarea" }), { target: { value: "Call them back" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(api.note).toHaveBeenCalledWith("c1", "Call them back"));
    expect(api.reply).not.toHaveBeenCalled();
  });

  it("inserts canned replies into the composer", async () => {
    await openFirst();
    fireEvent.change(screen.getByLabelText("Insert canned reply"), { target: { value: "k1" } });
    expect(screen.getByLabelText("Reply text")).toHaveValue("We open at 9.");
  });

  it("retries a failed send and requires confirmation for an unknown outcome", async () => {
    api.get.mockResolvedValue(detail(conv({ failedSend: true }), [msg(), msg({ id: "f1", direction: "OUTBOUND", authorKind: "PAGE", body: "Hi", sendStatus: "UNCERTAIN", sendError: "uncertain: no answer" })]));
    api.reply.mockResolvedValue({ id: "f1", sendStatus: "SENT", sendError: null });
    await openFirst();
    expect(screen.getByText("Unknown outcome")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry sending" }));
    await waitFor(() => expect(api.reply).toHaveBeenCalledWith("c1", { messageId: "f1", confirmNotSent: false }));
  });

  it("creates a lead and reports dedupe outcomes", async () => {
    api.createLead.mockResolvedValueOnce({ outcome: "created", leadId: "l1", contactId: null });
    await openFirst();
    fireEvent.click(screen.getByRole("button", { name: /Create lead/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Lead created.", "success"));
    api.get.mockResolvedValue(detail(conv({ leadId: "l1" })));
    cleanup();
    await openFirst();
    expect(screen.getByText("Lead linked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create lead/ })).toBeNull();
  });

  it("assigns, changes status and hides comments", async () => {
    api.assign.mockResolvedValue({}); api.setStatus.mockResolvedValue({}); api.hide.mockResolvedValue({});
    await openFirst();
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "u1" } });
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith("c1", "u1"));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "RESOLVED" } });
    await waitFor(() => expect(api.setStatus).toHaveBeenCalledWith("c1", "RESOLVED"));
    fireEvent.click(screen.getByRole("button", { name: /Hide comment/ }));
    await waitFor(() => expect(api.hide).toHaveBeenCalledWith("m1", true));
  });

  it("read-only users can read but not reply, assign or create leads", async () => {
    user.role = { key: "VIEWER", permissions: ["social.read"] };
    await openFirst();
    expect(screen.queryByLabelText("Reply text")).toBeNull();
    expect(screen.queryByLabelText("Assignee")).toBeNull();
    expect(screen.queryByRole("button", { name: /Create lead/ })).toBeNull();
    expect(screen.queryByLabelText(/Select Ada/)).toBeNull();
    expect(screen.getByText("What are your opening hours?", { selector: "p" })).toBeInTheDocument();
  });

  it("deep-links to a conversation from ?conversation=", async () => {
    window.history.replaceState({}, "", "/social/inbox?conversation=c1");
    render(<SocialInboxPage />);
    expect(await screen.findByLabelText("Conversation thread")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith("c1");
  });

  it("is a single column on phones with a back button", async () => {
    window.innerWidth = 390;
    render(<SocialInboxPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));
    await screen.findByLabelText("Conversation thread");
    expect(screen.queryByLabelText("Conversations")).toBeNull(); // list hidden while a thread is open
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    expect(await screen.findByLabelText("Conversations")).toBeInTheDocument();
  });
});

describe("inbox settings", () => {
  it("auto-reply is off by default and turning it on asks for confirmation", async () => {
    api.saveSettings.mockImplementation(async (v) => ({ autoTriage: true, autoDraft: false, autoReply: false, autoLead: false, firstResponseMinutes: 60, retentionDays: 180, ...v }));
    render(<SocialInboxPage />);
    await screen.findByText("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    const auto = await screen.findByLabelText("Auto-reply (low-risk only)");
    expect(auto).not.toBeChecked();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(auto);
    expect(api.saveSettings).not.toHaveBeenCalled();
    fireEvent.click(auto);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ autoReply: true }));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("saves SLA and retention, and is read-only for non-admins", async () => {
    api.saveSettings.mockResolvedValue({ autoTriage: true, autoDraft: false, autoReply: false, autoLead: false, firstResponseMinutes: 30, retentionDays: 90 });
    render(<SocialInboxPage />);
    await screen.findByText("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    fireEvent.change(await screen.findByLabelText("First-response target in minutes"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Retention in days"), { target: { value: "90" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]!);
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ firstResponseMinutes: 30, retentionDays: 90 }));
    cleanup();
    user.role = { key: "MANAGER", permissions: ["social.read", "social.reply"] };
    render(<SocialInboxPage />);
    await screen.findByText("Ada Lovelace");
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(await screen.findByLabelText("Auto-triage")).toBeDisabled();
    expect(screen.getByText(/Only workspace administrators/)).toBeInTheDocument();
  });
});
