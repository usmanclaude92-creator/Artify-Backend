/** Step 12 — landing pages list/editor: honest states, permission-gated actions, placeholder gate, no raw HTML field. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LandingPagesPage } from "./LandingPagesPage";
import { LandingEditor } from "./LandingEditor";
import { BLOCK_SPECS, cleanProps } from "../../lib/landingBlocks";

const perms = { current: ["marketing.landing.read", "marketing.landing.edit"] as string[] };
const api = vi.hoisted(() => ({
  list: vi.fn(), templates: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), stats: vi.fn(), revisions: vi.fn(),
  submitForApproval: vi.fn(), withdraw: vi.fn(), unpublish: vi.fn(), archive: vi.fn(), unarchive: vi.fn(), preview: vi.fn(), revokePreviews: vi.fn(), restore: vi.fn(), live: vi.fn(), utmLink: vi.fn(),
}));
vi.mock("../../lib/api", () => ({ landingApi: api }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: { role: { permissions: perms.current } } }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: vi.fn() }) }));
vi.mock("../common/MediaPickerModal", () => ({ MediaPickerModal: () => null }));

const view = (over: Record<string, unknown> = {}) => ({
  id: "p1", title: "Spring page", slug: "spring", status: "DRAFT", templateKey: "lead-gen", version: 1, updatedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z", publishedAt: null, unpublishedAt: null,
  live: null, hasUnpublishedChanges: false, pendingApproval: null, canPublishNow: false, path: "/lp/spring", publicUrl: null,
  seo: { metaTitle: "", metaDescription: "", noindex: false, ogImageMediaId: null },
  document: { version: 1, blocks: [{ id: "hero", type: "lp_hero", placeholder: true, props: { headline: "[[Replace: headline]]", primaryCta: { label: "Go", href: "#contact" } } }] },
  publishIssues: [{ blockId: "hero", message: "The hero block still holds placeholder content. Replace it with real content, then confirm it." }],
  ...over,
});

afterEach(() => { cleanup(); Object.values(api).forEach((m) => m.mockReset()); perms.current = ["marketing.landing.read", "marketing.landing.edit"]; window.history.replaceState({}, "", "/"); });

describe("LandingPagesPage", () => {
  it("shows an honest empty state and hides create without edit permission", async () => {
    api.list.mockResolvedValue({ items: [], totalPages: 1 });
    perms.current = ["marketing.landing.read"];
    render(<LandingPagesPage />);
    expect(await screen.findByText("No landing pages yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new landing page/i })).toBeNull();
  });

  it("lists pages with status and flags, and creates from a template", async () => {
    api.list.mockResolvedValue({ items: [{ id: "p1", title: "Spring page", slug: "spring", status: "PUBLISHED", path: "/lp/spring", hasUnpublishedChanges: true, pendingApproval: false, noindex: true, updatedAt: "2026-10-01T00:00:00Z" }], totalPages: 1 });
    api.templates.mockResolvedValue({ templates: [{ key: "lead-gen", name: "Lead generation", description: "d" }, { key: "consultation", name: "Consultation", description: "d" }] });
    api.create.mockResolvedValue({ page: view() });
    api.get.mockResolvedValue({ page: view() });
    render(<LandingPagesPage />);
    expect(await screen.findByText("Spring page")).toBeInTheDocument();
    expect(screen.getAllByText("Published").length).toBeGreaterThan(1); // filter option + row badge
    expect(screen.getByText("Unpublished changes")).toBeInTheDocument();
    expect(screen.getByText("noindex")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /new landing page/i }));
    fireEvent.change(await screen.findByLabelText(/page name/i), { target: { value: "My page" } });
    fireEvent.click(await screen.findByLabelText(/consultation/i));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ title: "My page", templateKey: "consultation" }));
  });
});

describe("LandingEditor", () => {
  it("blocks submission while the checklist has issues and offers the placeholder confirmation", async () => {
    api.get.mockResolvedValue({ page: view() });
    render(<LandingEditor id="p1" canEdit canPublish={false} onBack={() => undefined} />);
    expect(await screen.findByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit for approval/i })).toBeDisabled();
    expect(screen.getByText(/placeholder content/i, { selector: "span" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1\. Hero/ }));
    expect(screen.getByRole("button", { name: /i replaced the placeholder content/i })).toBeInTheDocument();
    expect(screen.queryByText(/unpublish/i, { selector: "button" })).toBeNull();
  });

  it("locks editing while approval is pending and lets the author withdraw", async () => {
    api.get.mockResolvedValue({ page: view({ status: "IN_REVIEW", pendingApproval: { id: "a1", requestedAt: "2026-10-01T00:00:00Z" } }) });
    render(<LandingEditor id="p1" canEdit canPublish={false} onBack={() => undefined} />);
    expect(await screen.findByText("Pending approval")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /withdraw request/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /submit for approval/i })).toBeNull();
    expect(screen.queryByText("Add a block")).toBeNull();
  });

  it("shows Unpublish only with publish permission on a live page, and honest empty performance", async () => {
    api.get.mockResolvedValue({ page: view({ status: "PUBLISHED", live: { revisionId: "r", version: 1, publishedAt: null }, canPublishNow: true, publishIssues: [] }) });
    api.stats.mockResolvedValue({ stats: { days: 30, path: "/lp/spring", views: 0, uniqueSessions: 0, submissions: 0, conversionRate: null, topSources: [], daily: [], hasData: false, note: "n" } });
    render(<LandingEditor id="p1" canEdit canPublish onBack={() => undefined} />);
    expect(await screen.findByRole("button", { name: /unpublish/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /performance/i }));
    expect(await screen.findByText(/no visits or form submissions recorded/i)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

describe("block specs", () => {
  it("offers no HTML/script field anywhere and covers all nine blocks", () => {
    expect(BLOCK_SPECS.map((s) => s.type).sort()).toEqual(["lp_benefits", "lp_cta", "lp_faq", "lp_features", "lp_footer", "lp_form", "lp_hero", "lp_pricing", "lp_testimonials"]);
    const kinds = new Set<string>();
    const walk = (f: { kind: string; itemFields?: unknown[] }) => { kinds.add(f.kind); (f.itemFields as typeof f[] | undefined)?.forEach(walk); };
    BLOCK_SPECS.forEach((s) => s.fields.forEach(walk));
    expect([...kinds].every((k) => ["text", "textarea", "cta", "image", "bool", "list", "strings", "formFields", "consent"].includes(k))).toBe(true);
  });
  it("cleanProps drops empty optional values but keeps false", () => {
    expect(cleanProps({ a: "", b: "x", c: false, d: [{ e: "", f: "y" }], g: null })).toEqual({ b: "x", c: false, d: [{ f: "y" }] });
  });
});
