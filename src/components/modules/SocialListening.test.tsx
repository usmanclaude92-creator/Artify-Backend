import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const listening = vi.hoisted(() => ({ list: vi.fn(), topics: vi.fn(), summary: vi.fn() }));
const reviews = vi.hoisted(() => ({ list: vi.fn(), overview: vi.fn(), draft: vi.fn(), reply: vi.fn() }));
const inbox = vi.hoisted(() => ({ get: vi.fn(), markRead: vi.fn(), assignees: vi.fn(), canned: vi.fn(), draft: vi.fn(), reply: vi.fn(), editDraft: vi.fn(), setStatus: vi.fn(), setPriority: vi.fn(), assign: vi.fn(), createLead: vi.fn(), note: vi.fn(), hide: vi.fn() }));
vi.mock("../../lib/api", () => ({
  socialListeningApi: listening, socialReviewsApi: reviews, socialInboxApi: inbox,
  socialApi: { list: () => Promise.resolve({ accounts: [{ id: "ig", displayName: "QA_TEST_2026_ IG" }], providers: [] }) },
}));
vi.mock("../../lib/apiClient", () => ({ ApiClientError: class extends Error {} }));
const user = vi.hoisted(() => ({ role: { key: "ADMIN", permissions: ["social.read", "social.reply", "social.listening.read", "social.reviews.respond"] as string[] } }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } }) }));

import { SocialListeningPage } from "./SocialListeningPage";
import { SocialReviewsPage } from "./SocialReviewsPage";

const account = { id: "ig", provider: "meta_instagram", displayName: "QA_TEST_2026_ IG", handle: "@qa", accountType: "BUSINESS", status: "CONNECTED", avatarUrl: null };
const item = (over: Record<string, unknown> = {}) => ({
  id: "c1", type: "MENTION", status: "OPEN", priority: "NORMAL", sentiment: "neutral", intent: "praise", topic: null, crisis: false, needsHuman: false, tags: [], isRead: true, assigneeId: null, leadId: null, contactId: null,
  participant: { handle: "qa_fan", name: "QA Fan" }, account: { id: "ig", provider: "meta_instagram", displayName: "QA_TEST_2026_ IG", handle: "@qa" }, subjectRef: "m1",
  preview: "Loving the new look @artifysols", permalink: "https://www.instagram.com/p/QA_TEST_1/", replyMode: "api", lastMessageAt: new Date().toISOString(), triaged: true, ...over,
});
const summary = { mentionsOpen: 3, negativeOpen: 1, crisisOpen: 1, unassigned: 2, mentionsLast7d: 5, reviewsOpen: 0 };
const msg = (over: Record<string, unknown> = {}) => ({ id: "m1", direction: "INBOUND", authorKind: "CUSTOMER", body: "Loving the new look @artifysols", sendStatus: "RECEIVED", sendError: null, sentById: null, sentAt: null, hidden: false, aiConfidence: null, guardrailResult: null, autoSent: false, createdAt: new Date().toISOString(), ...over });
const detail = (reply: { mode: "api" | "platform"; reason: string | null }, type = "MENTION") => ({
  conversation: { ...item(), type, overdue: false, failedSend: false, firstResponseAt: null, slaDueAt: null, lastMessageAt: new Date().toISOString(), participant: { externalId: null, handle: "qa_fan", name: "QA Fan" }, account },
  messages: [msg()], triage: null, permalink: "https://www.instagram.com/p/QA_TEST_1/", reply,
});

beforeEach(() => {
  window.innerWidth = 1280;
  user.role = { key: "ADMIN", permissions: ["social.read", "social.reply", "social.listening.read", "social.reviews.respond"] };
  listening.list.mockResolvedValue({ items: [item()], total: 1, page: 1, limit: 50 });
  listening.topics.mockResolvedValue([{ topic: "service", count: 2 }]);
  listening.summary.mockResolvedValue(summary);
  inbox.assignees.mockResolvedValue([{ id: "u1", name: "Sam Agent" }]);
  inbox.canned.mockResolvedValue([]);
  inbox.markRead.mockResolvedValue({});
  inbox.get.mockResolvedValue(detail({ mode: "api", reason: null }));
});
afterEach(() => { cleanup(); for (const m of [listening, reviews, inbox]) Object.values(m).forEach((f) => f.mockReset()); vi.restoreAllMocks(); });

describe("SocialListeningPage", () => {
  it("shows the summary, badges (crisis, negative, topic, unassigned, reply on the platform) and says what Listening is NOT", async () => {
    listening.list.mockResolvedValue({ items: [item({ crisis: true, sentiment: "negative", topic: "service", priority: "URGENT", replyMode: "platform", triaged: false })], total: 1, page: 1, limit: 50 });
    render(<SocialListeningPage />);
    const row = await screen.findByRole("button", { name: /QA Fan/ });
    for (const t of ["Crisis words", "Negative", "service", "Urgent", "Unassigned", "Reply on the platform", "Not analysed yet"]) expect(within(row).getByText(t)).toBeInTheDocument();
    expect(screen.getByText(/not a search over public posts/i)).toBeInTheDocument();
    const stats = screen.getByLabelText("Listening summary");
    expect(within(stats).getByText("Last 7 days")).toBeInTheDocument();
    expect(within(stats).getByText("5")).toBeInTheDocument();
  });

  it("passes the filters to the API (sentiment, topic, crisis words only, assignee)", async () => {
    render(<SocialListeningPage />);
    await screen.findByRole("button", { name: /QA Fan/ });
    fireEvent.change(screen.getByLabelText("Filter by sentiment"), { target: { value: "negative" } });
    fireEvent.change(await screen.findByLabelText("Filter by topic"), { target: { value: "service" } });
    fireEvent.click(screen.getByLabelText("Crisis words only"));
    await waitFor(() => expect(listening.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: "OPEN", sentiment: "negative", topic: "service", crisis: true })));
  });

  it("explains an empty stream honestly (webhook-only mentions, no stories, no private accounts)", async () => {
    listening.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
    render(<SocialListeningPage />);
    expect(await screen.findByText("No mentions yet")).toBeInTheDocument();
    expect(screen.getByText(/Stories mentions and mentions on private accounts are never sent/)).toBeInTheDocument();
  });

  it("shows an error state when the stream cannot be loaded", async () => {
    listening.list.mockRejectedValue(new Error("Permission denied. Required privilege: \"social.listening.read\""));
    render(<SocialListeningPage />);
    expect(await screen.findByText(/social\.listening\.read/)).toBeInTheDocument();
  });

  it("opens an item with a reply box when the network allows replies, and links to it", async () => {
    render(<SocialListeningPage />);
    fireEvent.click(await screen.findByRole("button", { name: /QA Fan/ }));
    expect(await screen.findByLabelText("Reply")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open on Instagram" })).toHaveAttribute("href", "https://www.instagram.com/p/QA_TEST_1/");
    expect(screen.queryByLabelText("Reply on the platform")).toBeNull();
  });

  it("shows 'Reply on the platform' with a deep link instead of a composer when the API cannot reply", async () => {
    inbox.get.mockResolvedValue(detail({ mode: "platform", reason: "Instagram does not let apps reply to a photo you were tagged in. Reply on Instagram." }));
    render(<SocialListeningPage />);
    fireEvent.click(await screen.findByRole("button", { name: /QA Fan/ }));
    const card = await screen.findByLabelText("Reply on the platform");
    expect(within(card).getByText(/photo you were tagged in/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Open on Instagram to reply/ })).toHaveAttribute("href", "https://www.instagram.com/p/QA_TEST_1/");
    expect(screen.queryByLabelText("Reply")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Send/ })).toBeNull();
  });

  it("is read-only without social.reply: no assign, status, lead or reply controls", async () => {
    user.role = { key: "VIEWER", permissions: ["social.read", "social.listening.read"] };
    render(<SocialListeningPage />);
    fireEvent.click(await screen.findByRole("button", { name: /QA Fan/ }));
    await screen.findByLabelText("Conversation thread");
    expect(screen.queryByLabelText("Reply")).toBeNull();
    expect(screen.queryByLabelText("Assignee")).toBeNull();
    expect(screen.queryByRole("button", { name: /Create lead/ })).toBeNull();
    expect(inbox.assignees).not.toHaveBeenCalled();
  });
});

const overview = (over: Record<string, unknown> = {}) => ({
  days: 90,
  accounts: [
    { id: "fb", provider: "meta_facebook", displayName: "QA_TEST_2026_ Page", handle: null, reviewsAvailable: false, reviewsReason: "Facebook no longer provides Page reviews or recommendations to apps (removed from the Graph API in v22.0). Read and answer them on Facebook.", series: [], latest: null },
  ],
  google: { connected: false, reason: "Google Business Profile reviews need Google's API access approval (a verified profile active for 60+ days, then a request reviewed in about 14 days). Not connected." },
  ...over,
});

describe("SocialReviewsPage", () => {
  beforeEach(() => {
    reviews.overview.mockResolvedValue(overview());
    reviews.list.mockResolvedValue({ items: [], total: 0, page: 1, limit: 50 });
  });

  it("says plainly why there are no reviews: Facebook removed them, Google is not connected", async () => {
    render(<SocialReviewsPage />);
    const fb = await screen.findByLabelText("QA_TEST_2026_ Page rating");
    expect(within(fb).getByText("No review feed")).toBeInTheDocument();
    expect(within(fb).getByText(/removed from the Graph API in v22\.0/)).toBeInTheDocument();
    expect(within(fb).getByText(/No rating has been captured yet/)).toBeInTheDocument();
    const g = screen.getByLabelText("Google Business Profile");
    expect(within(g).getByText("Not connected")).toBeInTheDocument();
    expect(within(g).getByText(/API access approval/)).toBeInTheDocument();
    expect(await screen.findByText("No reviews")).toBeInTheDocument();
    expect(screen.queryByText("0.0")).toBeNull();
  });

  it("shows a reported rating with its date, and '—' with the reason when the network returned none (never 0)", async () => {
    reviews.overview.mockResolvedValue(overview({
      accounts: [
        { id: "a", provider: "mock", displayName: "QA_TEST_2026_ With rating", handle: null, reviewsAvailable: true, reviewsReason: "Demo provider.", series: [{ date: "2026-10-01", averageRating: 4.5, reviewCount: 12, status: "OK", note: null }, { date: "2026-10-02", averageRating: 4.6, reviewCount: 14, status: "OK", note: null }], latest: { date: "2026-10-02", averageRating: 4.6, reviewCount: 14, status: "OK", note: null } },
        { id: "b", provider: "meta_facebook", displayName: "QA_TEST_2026_ No rating", handle: null, reviewsAvailable: false, reviewsReason: "no feed", series: [{ date: "2026-10-02", averageRating: null, reviewCount: null, status: "UNAVAILABLE", note: "Facebook returned no rating for this Page." }], latest: { date: "2026-10-02", averageRating: null, reviewCount: null, status: "UNAVAILABLE", note: "Facebook returned no rating for this Page." } },
      ],
    }));
    render(<SocialReviewsPage />);
    const a = await screen.findByLabelText("QA_TEST_2026_ With rating rating");
    expect(within(a).getByText(/average from/).textContent).toMatch(/^4\.6 average from 14 reviews \(as of 2026-10-02/);
    expect(within(a).getByText(/as of 2026-10-02/)).toBeInTheDocument();
    expect(within(a).getByLabelText(/average rating: 2 of 2 days have data/)).toBeInTheDocument();
    const b = screen.getByLabelText("QA_TEST_2026_ No rating rating");
    expect(within(b).getByText(/No rating on 2026-10-02: Facebook returned no rating for this Page\./)).toBeInTheDocument();
    expect(within(b).getByText("Not available yet.")).toBeInTheDocument();
    expect(within(b).queryByText("0.0")).toBeNull();
  });

  it("lets someone with social.reviews.respond draft and send through the REVIEWS endpoints (a person sends every reply)", async () => {
    reviews.list.mockResolvedValue({ items: [item({ id: "r1", type: "REVIEW", preview: "Decent but slow shipping", participant: { handle: null, name: "Pat Reviewer" } })], total: 1, page: 1, limit: 50 });
    inbox.get.mockResolvedValue(detail({ mode: "api", reason: null }, "REVIEW"));
    reviews.draft.mockResolvedValue({ messageId: "d1", body: "Thank you for the feedback.", confidence: 0.9, guardrail: { passed: true, issues: [] } });
    inbox.editDraft.mockResolvedValue({ id: "d1", body: "Thank you for the feedback.", guardrailResult: { passed: true, issues: [] } });
    reviews.reply.mockResolvedValue({ id: "d1", sendStatus: "SENT", sendError: null });
    render(<SocialReviewsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Pat Reviewer/ }));
    fireEvent.click(await screen.findByRole("button", { name: /AI draft/ }));
    await waitFor(() => expect(reviews.draft).toHaveBeenCalledWith("r1"));
    expect(inbox.draft).not.toHaveBeenCalled();
    expect(await screen.findByText(/a person must send it/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => expect(reviews.reply).toHaveBeenCalledWith("r1", expect.objectContaining({ messageId: "d1" })));
    expect(inbox.reply).not.toHaveBeenCalled();
  });

  it("hides the reply box without social.reviews.respond", async () => {
    user.role = { key: "MANAGER", permissions: ["social.read", "social.reply", "social.listening.read"] };
    reviews.list.mockResolvedValue({ items: [item({ id: "r1", type: "REVIEW", preview: "Nice", participant: { handle: null, name: "Pat Reviewer" } })], total: 1, page: 1, limit: 50 });
    inbox.get.mockResolvedValue(detail({ mode: "api", reason: null }, "REVIEW"));
    render(<SocialReviewsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Pat Reviewer/ }));
    await screen.findByLabelText("Conversation thread");
    expect(screen.queryByLabelText("Reply")).toBeNull();
  });
});
