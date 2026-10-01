/** Phase 2 (Site Editor) — page picker, loading/error states, block add/save/publish workflow, permission gating, no fabricated content. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SiteEditorPage } from "./SiteEditorPage";

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const publishMock = vi.fn();
const revisionsMock = vi.fn();
const templatePartsListMock = vi.fn();
const notifyMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../lib/api", () => ({
  pagesApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    publish: (...args: unknown[]) => publishMock(...args),
    revisions: (...args: unknown[]) => revisionsMock(...args),
  },
  templatesApi: {
    get: vi.fn().mockResolvedValue({ template: null }),
  },
  templatePartsApi: {
    list: (...args: unknown[]) => templatePartsListMock(...args),
    get: vi.fn(),
  },
  mediaApi: {
    getReadUrl: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/x.jpg", expiresAt: "2026-01-01" }),
  },
}));

let mockPermissions: string[] = ["content.read", "content.create", "content.update", "content.publish"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/website/site-editor", navigate: navigateMock }) }));

const emptyDoc = { version: 1 as const, blocks: [] };

const page = {
  id: "page-1",
  organizationId: "org-1",
  slug: "about-us",
  title: "About Us",
  status: "DRAFT" as const,
  currentRevisionId: "rev-1",
  currentRevision: {
    id: "rev-1",
    pageId: "page-1",
    postId: null,
    version: 1,
    status: "DRAFT" as const,
    title: "About Us",
    body: "",
    metadata: {},
    editorBlocks: emptyDoc,
    createdById: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
  },
  featuredMediaId: null,
  createdById: null,
  publishedAt: null,
  scheduledAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  templateId: null,
  pageType: "STANDARD" as const,
  isHomepage: false,
};

function setUrl(search: string) {
  window.history.pushState({}, "", `/website/site-editor${search}`);
}

beforeEach(() => {
  templatePartsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
});

afterEach(() => {
  cleanup();
  listMock.mockReset();
  getMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  publishMock.mockReset();
  revisionsMock.mockReset();
  templatePartsListMock.mockReset();
  notifyMock.mockReset();
  navigateMock.mockReset();
  mockPermissions = ["content.read", "content.create", "content.update", "content.publish"];
  setUrl("");
});

describe("SiteEditorPage", () => {
  it("shows a page picker (real data, not a dynamic route) when opened without ?pageId=", async () => {
    listMock.mockResolvedValue({ items: [page], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<SiteEditorPage />);
    expect(await screen.findByText("About Us")).toBeInTheDocument();
    expect(screen.getByText(/pick a page to edit visually/i)).toBeInTheDocument();
  });

  it("shows an empty state in the picker when there are no pages", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<SiteEditorPage />);
    expect(await screen.findByText(/no pages yet/i)).toBeInTheDocument();
  });

  it("loads the page named by ?pageId= and renders its toolbar", async () => {
    setUrl("?pageId=page-1");
    getMock.mockResolvedValue({ page });
    render(<SiteEditorPage />);
    expect(await screen.findByText("About Us")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("page-1");
    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled();
  });

  it("shows an error state when the page fails to load", async () => {
    setUrl("?pageId=page-1");
    getMock.mockRejectedValue(new Error("Page unavailable"));
    render(<SiteEditorPage />);
    expect(await screen.findByText(/failed to load page/i)).toBeInTheDocument();
  });

  it("adding a block makes 'Save draft' enabled (dirty tracking) and the block appears in Layers", async () => {
    setUrl("?pageId=page-1");
    getMock.mockResolvedValue({ page });
    render(<SiteEditorPage />);
    await screen.findByText("About Us");

    fireEvent.click(screen.getByRole("button", { name: /add block/i }));
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));

    expect(screen.getByRole("button", { name: /save draft/i })).toBeEnabled();
    expect(screen.getByText("Layers")).toBeInTheDocument();
  });

  it("saves a draft through the real API with both editorBlocks and a flattened body fallback", async () => {
    setUrl("?pageId=page-1");
    getMock.mockResolvedValue({ page });
    updateMock.mockResolvedValue({ page });
    render(<SiteEditorPage />);
    await screen.findByText("About Us");

    fireEvent.click(screen.getByRole("button", { name: /add block/i }));
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    fireEvent.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    const [id, payload] = updateMock.mock.calls[0] as [string, { editorBlocks: { blocks: unknown[] }; body: string }];
    expect(id).toBe("page-1");
    expect(payload.editorBlocks.blocks).toHaveLength(1);
    expect(payload.body).toContain("<h2>");
    expect(notifyMock).toHaveBeenCalledWith("Draft saved.", "success");
  });

  it("publish saves first when dirty, then publishes", async () => {
    setUrl("?pageId=page-1");
    getMock.mockResolvedValue({ page });
    updateMock.mockResolvedValue({ page });
    publishMock.mockResolvedValue({ page: { ...page, status: "PUBLISHED" } });
    render(<SiteEditorPage />);
    await screen.findByText("About Us");

    fireEvent.click(screen.getByRole("button", { name: /add block/i }));
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    await waitFor(() => expect(publishMock).toHaveBeenCalledWith("page-1"));
    expect(updateMock).toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith("Page published.", "success");
  });

  it("hides Save draft/Publish when the caller lacks the relevant permission", async () => {
    mockPermissions = ["content.read"];
    setUrl("?pageId=page-1");
    getMock.mockResolvedValue({ page });
    render(<SiteEditorPage />);
    await screen.findByText("About Us");
    expect(screen.queryByRole("button", { name: /save draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
  });

  it("'Back' navigates straight to Pages when there are no unsaved changes", async () => {
    setUrl("?pageId=page-1");
    getMock.mockResolvedValue({ page });
    render(<SiteEditorPage />);
    await screen.findByText("About Us");
    fireEvent.click(screen.getByRole("button", { name: /pages/i }));
    expect(navigateMock).toHaveBeenCalledWith("/cms/pages");
  });

  it("'Back' asks for confirmation when there are unsaved changes, and only navigates after confirming", async () => {
    setUrl("?pageId=page-1");
    getMock.mockResolvedValue({ page });
    render(<SiteEditorPage />);
    await screen.findByText("About Us");

    fireEvent.click(screen.getByRole("button", { name: /add block/i }));
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    fireEvent.click(screen.getByRole("button", { name: /pages/i }));

    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByText(/leave without saving/i)).toBeInTheDocument();

    const dialog = screen.getByText(/leave without saving/i).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole("button", { name: /discard & leave/i }));
    expect(navigateMock).toHaveBeenCalledWith("/cms/pages");
  });

  it("creating a new page from the picker calls the real API and opens it in the editor", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    createMock.mockResolvedValue({ page });
    render(<SiteEditorPage />);
    await screen.findByText(/no pages yet/i);

    fireEvent.change(screen.getByPlaceholderText(/about us/i), { target: { value: "New Landing Page" } });
    fireEvent.click(screen.getByRole("button", { name: /create & edit/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ title: "New Landing Page" })));
    expect(navigateMock).toHaveBeenCalledWith("/website/site-editor?pageId=page-1");
  });
});
