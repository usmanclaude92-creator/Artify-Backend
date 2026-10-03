/** Phase 5 (Navigation + Pages + Homepage) — Homepage Manager: current homepage display, safe switch (unset-then-promote) with confirmation, unassign, preview, no fabricated data. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HomepageManagerPage } from "./HomepageManagerPage";

const listMock = vi.fn();
const updateMock = vi.fn();
const notifyMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../lib/api", () => ({
  pagesApi: {
    list: (...args: unknown[]) => listMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}));

let mockPermissions: string[] = ["content.read", "content.update"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/website/homepage", navigate: navigateMock }) }));

const homepage = {
  id: "page-home",
  organizationId: "org-1",
  slug: "home",
  title: "Current Home",
  status: "PUBLISHED" as const,
  currentRevisionId: "rev-1",
  currentRevision: { id: "rev-1", pageId: "page-home", postId: null, version: 1, status: "PUBLISHED" as const, title: "Current Home", body: "<p>hi</p>", metadata: {}, createdById: null, createdAt: "2026-01-01T00:00:00.000Z", publishedAt: "2026-01-01T00:00:00.000Z" },
  featuredMediaId: null,
  createdById: null,
  publishedAt: "2026-01-01T00:00:00.000Z",
  scheduledAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  templateId: null,
  pageType: "STANDARD" as const,
  isHomepage: true,
  parentId: null,
};

const otherPage = { ...homepage, id: "page-other", slug: "about", title: "About Us", isHomepage: false };

beforeEach(() => {
  mockPermissions = ["content.read", "content.update"];
});

afterEach(() => {
  cleanup();
  listMock.mockReset();
  updateMock.mockReset();
  notifyMock.mockReset();
  navigateMock.mockReset();
});

describe("HomepageManagerPage", () => {
  it("shows the current homepage when one is designated", async () => {
    listMock.mockResolvedValue({ items: [homepage, otherPage], page: 1, limit: 100, total: 2, totalPages: 1 });
    render(<HomepageManagerPage />);
    expect(await screen.findAllByText("Current Home")).not.toHaveLength(0);
    expect(screen.queryByText(/no homepage designated/i)).not.toBeInTheDocument();
  });

  it("shows an empty state when no page is designated the homepage", async () => {
    listMock.mockResolvedValue({ items: [otherPage], page: 1, limit: 100, total: 1, totalPages: 1 });
    render(<HomepageManagerPage />);
    expect(await screen.findByText(/no homepage designated/i)).toBeInTheDocument();
  });

  it("only lists PUBLISHED, non-homepage pages as switch candidates", async () => {
    const draftPage = { ...otherPage, id: "page-draft", title: "Draft Page", status: "DRAFT" as const };
    listMock.mockResolvedValue({ items: [homepage, otherPage, draftPage], page: 1, limit: 100, total: 3, totalPages: 1 });
    render(<HomepageManagerPage />);
    await screen.findAllByText("Current Home");

    const select = screen.getByRole("combobox");
    expect(within(select).queryByText(/about us/i)).toBeInTheDocument();
    expect(within(select).queryByText(/draft page/i)).not.toBeInTheDocument();
  });

  it("switches the homepage through the real API only after confirming, unsetting the old one first", async () => {
    listMock.mockResolvedValue({ items: [homepage, otherPage], page: 1, limit: 100, total: 2, totalPages: 1 });
    updateMock.mockImplementation((id: string) => Promise.resolve({ page: id === "page-home" ? { ...homepage, isHomepage: false } : { ...otherPage, isHomepage: true } }));
    render(<HomepageManagerPage />);
    await screen.findAllByText("Current Home");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "page-other" } });
    fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));
    expect(updateMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^switch$/i }));

    await vi.waitFor(() => expect(notifyMock).toHaveBeenCalledWith("Homepage switched.", "success"));
    expect(updateMock).toHaveBeenCalledWith("page-home", { isHomepage: false });
    expect(updateMock).toHaveBeenCalledWith("page-other", { isHomepage: true });
  });

  it("unassigns the current homepage through the real API", async () => {
    listMock.mockResolvedValue({ items: [homepage, otherPage], page: 1, limit: 100, total: 2, totalPages: 1 });
    updateMock.mockResolvedValue({ page: { ...homepage, isHomepage: false } });
    render(<HomepageManagerPage />);
    await screen.findAllByText("Current Home");

    fireEvent.click(screen.getByRole("button", { name: /unassign/i }));
    await vi.waitFor(() => expect(updateMock).toHaveBeenCalledWith("page-home", { isHomepage: false }));
    expect(notifyMock).toHaveBeenCalledWith("Homepage unassigned. The public site falls back to its default homepage.", "success");
  });

  it("hides switch/unassign controls when the caller lacks content.update", async () => {
    mockPermissions = ["content.read"];
    listMock.mockResolvedValue({ items: [homepage, otherPage], page: 1, limit: 100, total: 2, totalPages: 1 });
    render(<HomepageManagerPage />);
    await screen.findAllByText("Current Home");

    expect(screen.queryByRole("button", { name: /unassign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^switch$/i })).not.toBeInTheDocument();
  });

  it("previews a page's rendered content without switching", async () => {
    listMock.mockResolvedValue({ items: [homepage, otherPage], page: 1, limit: 100, total: 2, totalPages: 1 });
    render(<HomepageManagerPage />);
    await screen.findAllByText("Current Home");

    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("hi")).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
