/** Phase 1 (Website module) — Templates list/detail, create form, publish/archive/duplicate/revert, permission-gated actions, no fabricated data. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TemplatesPage } from "./TemplatesPage";

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const publishMock = vi.fn();
const archiveMock = vi.fn();
const revertMock = vi.fn();
const duplicateMock = vi.fn();
const revisionsMock = vi.fn();
const usageMock = vi.fn();
const previewMock = vi.fn();
const removeMock = vi.fn();
const notifyMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../lib/api", () => ({
  templatesApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    revisions: (...args: unknown[]) => revisionsMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    publish: (...args: unknown[]) => publishMock(...args),
    archive: (...args: unknown[]) => archiveMock(...args),
    revert: (...args: unknown[]) => revertMock(...args),
    duplicate: (...args: unknown[]) => duplicateMock(...args),
    usage: (...args: unknown[]) => usageMock(...args),
    preview: (...args: unknown[]) => previewMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
}));

let mockPermissions: string[] = ["templates.read", "templates.create", "templates.update", "templates.publish", "templates.delete"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/website/templates", navigate: navigateMock }) }));

const revision = {
  id: "rev-1",
  templateId: "template-1",
  version: 1,
  status: "DRAFT" as const,
  name: "Standard Page",
  structure: { regions: ["header", "content", "footer"] },
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  publishedAt: null,
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
  currentRevisionId: "rev-1",
  currentRevision: revision,
  _count: { pages: 0 },
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

beforeEach(() => {
  usageMock.mockResolvedValue({ pages: [] });
});

afterEach(() => {
  cleanup();
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  publishMock.mockReset();
  archiveMock.mockReset();
  revertMock.mockReset();
  duplicateMock.mockReset();
  revisionsMock.mockReset();
  usageMock.mockReset();
  previewMock.mockReset();
  removeMock.mockReset();
  notifyMock.mockReset();
  navigateMock.mockReset();
  mockPermissions = ["templates.read", "templates.create", "templates.update", "templates.publish", "templates.delete"];
});

describe("TemplatesPage", () => {
  it("renders the template list and detail pane with real data, not fabricated content", async () => {
    listMock.mockResolvedValue({ items: [template], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<TemplatesPage />);
    expect(await screen.findAllByText("Standard Page")).not.toHaveLength(0);
    expect(await screen.findByText(/no pages are assigned to this template/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no templates", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<TemplatesPage />);
    expect(await screen.findByText(/no templates found/i)).toBeInTheDocument();
  });

  it("creates a template through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    createMock.mockResolvedValue({ template });
    render(<TemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new template/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "New Template" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create template/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: "New Template" })));
  });

  it("publishes a template through the real API", async () => {
    listMock.mockResolvedValue({ items: [template], page: 1, limit: 20, total: 1, totalPages: 1 });
    publishMock.mockResolvedValue({ template: { ...template, status: "PUBLISHED" } });
    render(<TemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^publish$/i }));
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalledWith("template-1"));
  });

  it("duplicates a template through the real API", async () => {
    listMock.mockResolvedValue({ items: [template], page: 1, limit: 20, total: 1, totalPages: 1 });
    duplicateMock.mockResolvedValue({ template: { ...template, id: "template-2", name: "Standard Page (Copy)" } });
    render(<TemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /duplicate/i }));
    await vi.waitFor(() => expect(duplicateMock).toHaveBeenCalledWith("template-1"));
  });

  it("archives a template only after confirming the destructive dialog", async () => {
    const publishedTemplate = { ...template, status: "PUBLISHED" as const };
    listMock.mockResolvedValue({ items: [publishedTemplate], page: 1, limit: 20, total: 1, totalPages: 1 });
    archiveMock.mockResolvedValue({ template: { ...publishedTemplate, status: "ARCHIVED" } });
    render(<TemplatesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^archive$/i }));
    expect(archiveMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await vi.waitFor(() => expect(archiveMock).toHaveBeenCalledWith("template-1"));
  });

  it("hides create/edit/publish/archive actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["templates.read"];
    listMock.mockResolvedValue({ items: [template], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<TemplatesPage />);

    await screen.findAllByText("Standard Page");
    expect(screen.queryByRole("button", { name: /new template/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit regions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /duplicate/i })).not.toBeInTheDocument();
  });

  it("hides edit/publish/archive for a protected system template but still allows duplicate", async () => {
    mockPermissions = ["templates.read", "templates.create", "templates.update", "templates.publish", "templates.delete"];
    const systemTemplate = { ...template, isSystem: true };
    listMock.mockResolvedValue({ items: [systemTemplate], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<TemplatesPage />);

    await screen.findAllByText("Standard Page");
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit regions/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /duplicate/i })).toBeInTheDocument();
  });

  it("shows real pages using the template and navigates to the region editor", async () => {
    usageMock.mockResolvedValue({ pages: [{ id: "page-9", title: "About Us", status: "PUBLISHED" }] });
    listMock.mockResolvedValue({ items: [template], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<TemplatesPage />);
    await screen.findAllByText("Standard Page");

    expect(await screen.findByText("About Us")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /edit regions/i }));
    expect(navigateMock).toHaveBeenCalledWith("/website/site-editor?templateId=template-1");
  });

  it("deletes a template through the real API only after confirming", async () => {
    listMock.mockResolvedValue({ items: [template], page: 1, limit: 20, total: 1, totalPages: 1 });
    removeMock.mockResolvedValue({ message: "Template deleted." });
    render(<TemplatesPage />);
    await screen.findAllByText("Standard Page");

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(removeMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await vi.waitFor(() => expect(removeMock).toHaveBeenCalledWith("template-1"));
    expect(notifyMock).toHaveBeenCalledWith("Template deleted.", "success");
  });

  it("surfaces the backend's in-use error when deleting a template still assigned to pages", async () => {
    listMock.mockResolvedValue({ items: [template], page: 1, limit: 20, total: 1, totalPages: 1 });
    removeMock.mockRejectedValue(new Error("This template is still assigned to one or more pages."));
    render(<TemplatesPage />);
    await screen.findAllByText("Standard Page");

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await vi.waitFor(() => expect(notifyMock).toHaveBeenCalledWith("Could not delete template.", "error"));
  });

  it("filters by type, sending the filter to the real API", async () => {
    listMock.mockResolvedValue({ items: [template], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<TemplatesPage />);
    await screen.findAllByText("Standard Page");

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "HOMEPAGE" } });
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ type: "HOMEPAGE" })));
  });
});
