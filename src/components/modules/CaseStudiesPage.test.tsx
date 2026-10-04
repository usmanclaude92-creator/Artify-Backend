/** Phase 11 — Case Studies list/detail, create form with relationship pickers, workflow actions, revisions/revert, trash/bulk, permission-gated actions, no fabricated data. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CaseStudiesPage } from "./CaseStudiesPage";

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const submitForReviewMock = vi.fn();
const publishMock = vi.fn();
const scheduleMock = vi.fn();
const archiveMock = vi.fn();
const revertMock = vi.fn();
const revisionsMock = vi.fn();
const trashMock = vi.fn();
const restoreMock = vi.fn();
const bulkArchiveMock = vi.fn();
const bulkTrashMock = vi.fn();
const bulkRestoreMock = vi.fn();
const notifyMock = vi.fn();

const productsListMock = vi.fn();
const pagesListMock = vi.fn();
const postsListMock = vi.fn();
const formsListMock = vi.fn();
const industriesListMock = vi.fn();

vi.mock("../../lib/api", () => ({
  caseStudiesApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    revisions: (...args: unknown[]) => revisionsMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    submitForReview: (...args: unknown[]) => submitForReviewMock(...args),
    publish: (...args: unknown[]) => publishMock(...args),
    schedule: (...args: unknown[]) => scheduleMock(...args),
    archive: (...args: unknown[]) => archiveMock(...args),
    revert: (...args: unknown[]) => revertMock(...args),
    trash: (...args: unknown[]) => trashMock(...args),
    restore: (...args: unknown[]) => restoreMock(...args),
    bulkArchive: (...args: unknown[]) => bulkArchiveMock(...args),
    bulkTrash: (...args: unknown[]) => bulkTrashMock(...args),
    bulkRestore: (...args: unknown[]) => bulkRestoreMock(...args),
  },
  productsApi: { list: (...args: unknown[]) => productsListMock(...args) },
  pagesApi: { list: (...args: unknown[]) => pagesListMock(...args) },
  postsApi: { list: (...args: unknown[]) => postsListMock(...args) },
  formsApi: { list: (...args: unknown[]) => formsListMock(...args) },
  industriesApi: { list: (...args: unknown[]) => industriesListMock(...args) },
  mediaApi: { get: vi.fn(), getReadUrl: vi.fn() },
}));

let mockPermissions: string[] = ["content.read", "content.create", "content.update", "content.publish", "content.delete"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const navigateMock = vi.fn();
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/cms/case-studies", navigate: navigateMock }) }));

const revision = {
  id: "rev-1",
  pageId: null,
  postId: null,
  caseStudyId: "cs-1",
  version: 1,
  status: "DRAFT" as const,
  title: "Acme Zero-Touch Close",
  body: "How Acme closed the books in 1 day.",
  metadata: { challenge: "Manual close took 10 days." },
  editorBlocks: null,
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  publishedAt: null,
};

const caseStudy = {
  id: "cs-1",
  organizationId: "org-1",
  slug: "acme-zero-touch-close",
  title: "Acme Zero-Touch Close",
  status: "DRAFT" as const,
  clientName: "Acme Corp",
  industryId: null,
  currentRevisionId: "rev-1",
  currentRevision: revision,
  featuredMediaId: null,
  industry: null,
  products: [],
  relatedPages: [],
  relatedPosts: [],
  createdById: null,
  publishedAt: null,
  scheduledAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

beforeEach(() => {
  productsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
  pagesListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
  postsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
  formsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
  industriesListMock.mockResolvedValue({ industries: [] });
  trashMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
});

afterEach(() => {
  cleanup();
  for (const m of [
    listMock, createMock, updateMock, submitForReviewMock, publishMock, scheduleMock, archiveMock, revertMock, revisionsMock,
    trashMock, restoreMock, bulkArchiveMock, bulkTrashMock, bulkRestoreMock, notifyMock, navigateMock,
    productsListMock, pagesListMock, postsListMock, formsListMock, industriesListMock,
  ]) {
    m.mockReset();
  }
  mockPermissions = ["content.read", "content.create", "content.update", "content.publish", "content.delete"];
});

describe("CaseStudiesPage", () => {
  it("renders the case study list and detail pane with real data, not fabricated content", async () => {
    listMock.mockResolvedValue({ items: [caseStudy], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<CaseStudiesPage />);
    expect(await screen.findAllByText("Acme Zero-Touch Close")).not.toHaveLength(0);
    expect(await screen.findByText("How Acme closed the books in 1 day.")).toBeInTheDocument();
    expect(screen.getByText(/client: acme corp/i)).toBeInTheDocument();
  });

  it("navigates to the Site Editor with the case study's id when 'Open Site Editor' is clicked", async () => {
    listMock.mockResolvedValue({ items: [caseStudy], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<CaseStudiesPage />);
    const button = await screen.findByRole("button", { name: /open site editor/i });
    fireEvent.click(button);
    expect(navigateMock).toHaveBeenCalledWith("/website/site-editor?caseStudyId=cs-1");
  });

  it("shows an empty state when there are no case studies", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<CaseStudiesPage />);
    expect(await screen.findByText(/no case studies found/i)).toBeInTheDocument();
  });

  it("creates a case study with relationship picks through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    productsListMock.mockResolvedValue({ items: [{ id: "prod-1", name: "Zero-Touch Close", type: "SOLUTION" }], page: 1, limit: 100, total: 1, totalPages: 1 });
    industriesListMock.mockResolvedValue({ industries: [{ id: "ind-1", slug: "finance", name: "Finance", description: null, displayOrder: 0 }] });
    createMock.mockResolvedValue({ caseStudy });
    render(<CaseStudiesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new case study/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^title$/i), { target: { value: "Acme Zero-Touch Close" } });
    fireEvent.change(within(dialog).getByLabelText(/^client \/ company$/i), { target: { value: "Acme Corp" } });
    fireEvent.change(within(dialog).getByLabelText(/^industry$/i), { target: { value: "ind-1" } });
    fireEvent.click(within(dialog).getByLabelText(/zero-touch close/i));
    fireEvent.click(within(dialog).getByRole("button", { name: /create case study/i }));

    await vi.waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Acme Zero-Touch Close", clientName: "Acme Corp", industryId: "ind-1", productIds: ["prod-1"] })
      )
    );
  });

  it("publishes a case study through the real API", async () => {
    listMock.mockResolvedValue({ items: [caseStudy], page: 1, limit: 20, total: 1, totalPages: 1 });
    publishMock.mockResolvedValue({ caseStudy: { ...caseStudy, status: "PUBLISHED" } });
    render(<CaseStudiesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^publish$/i }));
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalledWith("cs-1"));
  });

  it("archives a case study only after confirming the destructive dialog", async () => {
    listMock.mockResolvedValue({ items: [caseStudy], page: 1, limit: 20, total: 1, totalPages: 1 });
    archiveMock.mockResolvedValue({ caseStudy: { ...caseStudy, status: "ARCHIVED" } });
    render(<CaseStudiesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^archive$/i }));
    expect(archiveMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await vi.waitFor(() => expect(archiveMock).toHaveBeenCalledWith("cs-1"));
  });

  it("shows revision history and reverts to a prior revision through the real API", async () => {
    listMock.mockResolvedValue({ items: [caseStudy], page: 1, limit: 20, total: 1, totalPages: 1 });
    revisionsMock.mockResolvedValue({ revisions: [revision, { ...revision, id: "rev-2", version: 2, status: "PUBLISHED" }] });
    revertMock.mockResolvedValue({ caseStudy });
    render(<CaseStudiesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /revisions/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/v2/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /revert to this/i }));
    await vi.waitFor(() => expect(revertMock).toHaveBeenCalledWith("cs-1", "rev-2"));
  });

  it("hides create/publish/archive actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["content.read"];
    listMock.mockResolvedValue({ items: [caseStudy], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<CaseStudiesPage />);

    await screen.findByText(/How Acme closed the books/i);
    expect(screen.queryByRole("button", { name: /new case study/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
  });

  it("filters by status, sending the filter to the real API", async () => {
    listMock.mockResolvedValue({ items: [caseStudy], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<CaseStudiesPage />);
    await screen.findByText(/How Acme closed the books/i);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "PUBLISHED" } });
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: "PUBLISHED" })));
  });

  describe("Trash view, bulk actions", () => {
    it("switches to the Trash tab, calling the real trash API", async () => {
      listMock.mockResolvedValue({ items: [caseStudy], page: 1, limit: 20, total: 1, totalPages: 1 });
      trashMock.mockResolvedValue({ items: [{ ...caseStudy, title: "Trashed Case Study" }], page: 1, limit: 20, total: 1, totalPages: 1 });
      render(<CaseStudiesPage />);
      await screen.findByText(/How Acme closed the books/i);

      fireEvent.click(screen.getByRole("button", { name: /^trash$/i }));
      expect(await screen.findByText("Trashed Case Study")).toBeInTheDocument();
      expect(trashMock).toHaveBeenCalled();
    });

    it("bulk-archives selected case studies only after confirming, through the real API", async () => {
      listMock.mockResolvedValue({ items: [caseStudy], page: 1, limit: 20, total: 1, totalPages: 1 });
      bulkArchiveMock.mockResolvedValue({ succeeded: ["cs-1"], failed: [] });
      render(<CaseStudiesPage />);
      await screen.findByText(/How Acme closed the books/i);

      fireEvent.click(screen.getByLabelText(/select acme zero-touch close/i));
      fireEvent.click(screen.getByRole("button", { name: /archive selected/i }));
      expect(bulkArchiveMock).not.toHaveBeenCalled();

      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
      await vi.waitFor(() => expect(bulkArchiveMock).toHaveBeenCalledWith(["cs-1"]));
    });
  });
});
