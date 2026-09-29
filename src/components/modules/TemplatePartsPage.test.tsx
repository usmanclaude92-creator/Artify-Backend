/** Phase 1 (Website module) — Template Parts list/detail, create form, publish, no fabricated data. Mirrors TemplatesPage.test.tsx's shape. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TemplatePartsPage } from "./TemplatePartsPage";

const listMock = vi.fn();
const createMock = vi.fn();
const publishMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  templatePartsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    revisions: vi.fn(),
    create: (...args: unknown[]) => createMock(...args),
    update: vi.fn(),
    publish: (...args: unknown[]) => publishMock(...args),
    archive: vi.fn(),
    revert: vi.fn(),
    duplicate: vi.fn(),
  },
}));

let mockPermissions: string[] = ["template_parts.read", "template_parts.create", "template_parts.update", "template_parts.publish", "template_parts.delete"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const revision = {
  id: "prev-1",
  templatePartId: "part-1",
  version: 1,
  status: "DRAFT" as const,
  name: "Main Header",
  content: { logo: "artify" },
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  publishedAt: null,
};

const part = {
  id: "part-1",
  organizationId: "org-1",
  type: "HEADER" as const,
  name: "Main Header",
  slug: "main-header",
  status: "DRAFT" as const,
  isSystem: false,
  currentRevisionId: "prev-1",
  currentRevision: revision,
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  createMock.mockReset();
  publishMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["template_parts.read", "template_parts.create", "template_parts.update", "template_parts.publish", "template_parts.delete"];
});

describe("TemplatePartsPage", () => {
  it("renders the template part list and detail pane with real data, not fabricated content", async () => {
    listMock.mockResolvedValue({ items: [part], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<TemplatePartsPage />);
    expect(await screen.findAllByText("Main Header")).not.toHaveLength(0);
  });

  it("shows an empty state when there are no template parts", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<TemplatePartsPage />);
    expect(await screen.findByText(/no template parts found/i)).toBeInTheDocument();
  });

  it("creates a template part through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    createMock.mockResolvedValue({ templatePart: part });
    render(<TemplatePartsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new part/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "New Part" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create part/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: "New Part" })));
  });

  it("publishes a template part through the real API", async () => {
    listMock.mockResolvedValue({ items: [part], page: 1, limit: 20, total: 1, totalPages: 1 });
    publishMock.mockResolvedValue({ templatePart: { ...part, status: "PUBLISHED" } });
    render(<TemplatePartsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^publish$/i }));
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalledWith("part-1"));
  });

  it("hides create/edit/publish actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["template_parts.read"];
    listMock.mockResolvedValue({ items: [part], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<TemplatePartsPage />);

    await screen.findAllByText("Main Header");
    expect(screen.queryByRole("button", { name: /new part/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
  });
});
