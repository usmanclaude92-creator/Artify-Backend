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
const revertMock = vi.fn();
const templatePartsListMock = vi.fn();
const templatePartGetMock = vi.fn();
const templatePartUpdateMock = vi.fn();
const templatePartPublishMock = vi.fn();
const templatePartRevisionsMock = vi.fn();
const templatePartRevertMock = vi.fn();
const templatePartUsageMock = vi.fn();
const templateGetMock = vi.fn();
const templateUpdateMock = vi.fn();
const templatePublishMock = vi.fn();
const templateRevisionsMock = vi.fn();
const templateRevertMock = vi.fn();
const templateUsageMock = vi.fn();
const templatePreviewMock = vi.fn();
const navigationMenusListMock = vi.fn();
const notifyMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    pagesApi: {
      list: (...args: unknown[]) => listMock(...args),
      get: (...args: unknown[]) => getMock(...args),
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      publish: (...args: unknown[]) => publishMock(...args),
      revisions: (...args: unknown[]) => revisionsMock(...args),
      revert: (...args: unknown[]) => revertMock(...args),
    },
    templatesApi: {
      get: (...args: unknown[]) => templateGetMock(...args),
      update: (...args: unknown[]) => templateUpdateMock(...args),
      publish: (...args: unknown[]) => templatePublishMock(...args),
      revisions: (...args: unknown[]) => templateRevisionsMock(...args),
      revert: (...args: unknown[]) => templateRevertMock(...args),
      usage: (...args: unknown[]) => templateUsageMock(...args),
      preview: (...args: unknown[]) => templatePreviewMock(...args),
    },
    templatePartsApi: {
      list: (...args: unknown[]) => templatePartsListMock(...args),
      get: (...args: unknown[]) => templatePartGetMock(...args),
      update: (...args: unknown[]) => templatePartUpdateMock(...args),
      publish: (...args: unknown[]) => templatePartPublishMock(...args),
      revisions: (...args: unknown[]) => templatePartRevisionsMock(...args),
      revert: (...args: unknown[]) => templatePartRevertMock(...args),
      usage: (...args: unknown[]) => templatePartUsageMock(...args),
    },
    navigationMenusApi: {
      list: (...args: unknown[]) => navigationMenusListMock(...args),
    },
    mediaApi: {
      getReadUrl: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/x.jpg", expiresAt: "2026-01-01" }),
    },
    siteSettingsApi: {
      getGlobalStyles: vi.fn().mockRejectedValue(new Error("not configured in this test")),
    },
  };
});

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

const templatePart = {
  id: "part-1",
  organizationId: "org-1",
  type: "HEADER" as const,
  name: "Main Header",
  slug: "main-header",
  status: "DRAFT" as const,
  isSystem: false,
  currentRevisionId: "prev-1",
  currentRevision: {
    id: "prev-1",
    templatePartId: "part-1",
    version: 1,
    status: "DRAFT" as const,
    name: "Main Header",
    content: emptyDoc,
    createdById: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
  },
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const template = {
  id: "template-1",
  organizationId: "org-1",
  type: "STANDARD_PAGE" as const,
  name: "Standard Page",
  slug: "standard-page",
  description: "A basic page layout",
  status: "DRAFT" as const,
  isSystem: false,
  currentRevisionId: "rev-t1",
  currentRevision: {
    id: "rev-t1",
    templateId: "template-1",
    version: 1,
    status: "DRAFT" as const,
    name: "Standard Page",
    structure: { regions: [{ key: "header", templatePartId: "part-1" }] },
    createdById: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    publishedAt: null,
  },
  _count: { pages: 0 },
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

function setUrl(search: string) {
  window.history.pushState({}, "", `/website/site-editor${search}`);
}

beforeEach(() => {
  templatePartsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
  navigationMenusListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
  templateGetMock.mockResolvedValue({ template: null });
  templateUsageMock.mockResolvedValue({ pages: [] });
  templatePartUsageMock.mockResolvedValue({ templates: [], pages: [] });
});

afterEach(() => {
  cleanup();
  listMock.mockReset();
  getMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  publishMock.mockReset();
  revisionsMock.mockReset();
  revertMock.mockReset();
  templatePartsListMock.mockReset();
  navigationMenusListMock.mockReset();
  templatePartGetMock.mockReset();
  templatePartUpdateMock.mockReset();
  templatePartPublishMock.mockReset();
  templatePartRevisionsMock.mockReset();
  templatePartRevertMock.mockReset();
  templatePartUsageMock.mockReset();
  templateGetMock.mockReset();
  templateUpdateMock.mockReset();
  templatePublishMock.mockReset();
  templateRevisionsMock.mockReset();
  templateRevertMock.mockReset();
  templateUsageMock.mockReset();
  templatePreviewMock.mockReset();
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

  describe("?templatePartId= mode (editing a Template Part's content)", () => {
    beforeEach(() => {
      mockPermissions = ["template_parts.read", "template_parts.create", "template_parts.update", "template_parts.publish"];
    });

    it("loads the part named by ?templatePartId= and renders its toolbar", async () => {
      setUrl("?templatePartId=part-1");
      templatePartGetMock.mockResolvedValue({ templatePart });
      render(<SiteEditorPage />);
      expect(await screen.findByText("Main Header")).toBeInTheDocument();
      expect(templatePartGetMock).toHaveBeenCalledWith("part-1");
      expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled();
    });

    it("saves a draft through templatePartsApi.update, not pagesApi", async () => {
      setUrl("?templatePartId=part-1");
      templatePartGetMock.mockResolvedValue({ templatePart });
      templatePartUpdateMock.mockResolvedValue({ templatePart });
      render(<SiteEditorPage />);
      await screen.findByText("Main Header");

      fireEvent.click(screen.getByRole("button", { name: /add block/i }));
      fireEvent.click(screen.getByRole("button", { name: "Heading" }));
      fireEvent.click(screen.getByRole("button", { name: /save draft/i }));

      await waitFor(() => expect(templatePartUpdateMock).toHaveBeenCalledTimes(1));
      const [id, payload] = templatePartUpdateMock.mock.calls[0] as [string, { content: { blocks: unknown[] } }];
      expect(id).toBe("part-1");
      expect(payload.content.blocks).toHaveLength(1);
      expect(updateMock).not.toHaveBeenCalled();
      expect(notifyMock).toHaveBeenCalledWith("Draft saved.", "success");
    });

    it("publish saves first when dirty, then publishes through templatePartsApi", async () => {
      setUrl("?templatePartId=part-1");
      templatePartGetMock.mockResolvedValue({ templatePart });
      templatePartUpdateMock.mockResolvedValue({ templatePart });
      templatePartPublishMock.mockResolvedValue({ templatePart: { ...templatePart, status: "PUBLISHED" } });
      render(<SiteEditorPage />);
      await screen.findByText("Main Header");

      fireEvent.click(screen.getByRole("button", { name: /add block/i }));
      fireEvent.click(screen.getByRole("button", { name: "Heading" }));
      fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

      await waitFor(() => expect(templatePartPublishMock).toHaveBeenCalledWith("part-1"));
      expect(templatePartUpdateMock).toHaveBeenCalled();
      expect(publishMock).not.toHaveBeenCalled();
      expect(notifyMock).toHaveBeenCalledWith("Template part published.", "success");
    });

    it("hides Save draft/Publish when the caller lacks template_parts permissions", async () => {
      mockPermissions = ["template_parts.read"];
      setUrl("?templatePartId=part-1");
      templatePartGetMock.mockResolvedValue({ templatePart });
      render(<SiteEditorPage />);
      await screen.findByText("Main Header");
      expect(screen.queryByRole("button", { name: /save draft/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
    });

    it("shows real templates/pages referencing this part in the 'Used by' panel", async () => {
      setUrl("?templatePartId=part-1");
      templatePartGetMock.mockResolvedValue({ templatePart });
      templatePartUsageMock.mockResolvedValue({ templates: [{ id: "template-1", name: "Standard Page", status: "DRAFT" }], pages: [] });
      render(<SiteEditorPage />);
      await screen.findByText("Main Header");
      expect(await screen.findByText("Template: Standard Page")).toBeInTheDocument();
    });

    it("'Back' navigates to Template Parts, not Pages", async () => {
      setUrl("?templatePartId=part-1");
      templatePartGetMock.mockResolvedValue({ templatePart });
      render(<SiteEditorPage />);
      await screen.findByText("Main Header");
      fireEvent.click(screen.getByRole("button", { name: /template parts/i }));
      expect(navigateMock).toHaveBeenCalledWith("/website/template-parts");
    });
  });

  describe("?templateId= mode (editing a Template's region structure)", () => {
    beforeEach(() => {
      mockPermissions = ["templates.read", "templates.create", "templates.update", "templates.publish"];
    });

    it("renders the TemplateStructureEditor with the template's regions", async () => {
      setUrl("?templateId=template-1");
      templateGetMock.mockResolvedValue({ template });
      render(<SiteEditorPage />);
      expect(await screen.findByText("Standard Page")).toBeInTheDocument();
      expect(templateGetMock).toHaveBeenCalledWith("template-1");
      expect(screen.getByDisplayValue("header")).toBeInTheDocument();
    });

    it("adding a region makes 'Save draft' enabled", async () => {
      setUrl("?templateId=template-1");
      templateGetMock.mockResolvedValue({ template });
      render(<SiteEditorPage />);
      await screen.findByText("Standard Page");

      fireEvent.click(screen.getByRole("button", { name: /add region/i }));
      expect(screen.getByRole("button", { name: /save draft/i })).toBeEnabled();
    });

    it("saves region changes through templatesApi.update with the ordered-array structure shape", async () => {
      setUrl("?templateId=template-1");
      templateGetMock.mockResolvedValue({ template });
      templateUpdateMock.mockResolvedValue({ template });
      render(<SiteEditorPage />);
      await screen.findByText("Standard Page");

      fireEvent.click(screen.getByRole("button", { name: /add region/i }));
      fireEvent.click(screen.getByRole("button", { name: /save draft/i }));

      await waitFor(() => expect(templateUpdateMock).toHaveBeenCalledTimes(1));
      const [id, payload] = templateUpdateMock.mock.calls[0] as [string, { structure: { regions: { key: string; templatePartId: string | null }[] } }];
      expect(id).toBe("template-1");
      expect(payload.structure.regions).toEqual([{ key: "header", templatePartId: "part-1" }, { key: "", templatePartId: null }]);
      expect(notifyMock).toHaveBeenCalledWith("Draft saved.", "success");
    });

    it("publishes the template through templatesApi.publish", async () => {
      setUrl("?templateId=template-1");
      templateGetMock.mockResolvedValue({ template });
      templatePublishMock.mockResolvedValue({ template: { ...template, status: "PUBLISHED" } });
      render(<SiteEditorPage />);
      await screen.findByText("Standard Page");

      fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
      await waitFor(() => expect(templatePublishMock).toHaveBeenCalledWith("template-1"));
      expect(notifyMock).toHaveBeenCalledWith("Template published.", "success");
    });

    it("navigates to the assigned part's content editor via 'Edit part'", async () => {
      setUrl("?templateId=template-1");
      templateGetMock.mockResolvedValue({ template });
      render(<SiteEditorPage />);
      await screen.findByText("Standard Page");

      fireEvent.click(screen.getByRole("button", { name: /edit part/i }));
      expect(navigateMock).toHaveBeenCalledWith("/website/site-editor?templatePartId=part-1");
    });

    it("shows real pages using the template", async () => {
      setUrl("?templateId=template-1");
      templateGetMock.mockResolvedValue({ template });
      templateUsageMock.mockResolvedValue({ pages: [{ id: "page-9", title: "About Us", status: "PUBLISHED" }] });
      render(<SiteEditorPage />);
      await screen.findByText("Standard Page");
      expect(await screen.findByText("About Us")).toBeInTheDocument();
    });

    it("hides Save draft/Add region/Publish when the caller lacks templates permissions", async () => {
      mockPermissions = ["templates.read"];
      setUrl("?templateId=template-1");
      templateGetMock.mockResolvedValue({ template });
      render(<SiteEditorPage />);
      await screen.findByText("Standard Page");
      expect(screen.queryByRole("button", { name: /add region/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /save draft/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
    });
  });
});
