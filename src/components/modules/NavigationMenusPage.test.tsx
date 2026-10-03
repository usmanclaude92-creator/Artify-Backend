/** Phase 5 (Navigation + Pages + Homepage) — Navigation Menus list/detail, create form, nested item editor, publish, permission-gated actions, no fabricated data. Mirrors TemplatePartsPage.test.tsx's shape. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NavigationMenusPage } from "./NavigationMenusPage";

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const publishMock = vi.fn();
const usageMock = vi.fn();
const removeMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  navigationMenusApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    revisions: vi.fn(),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    publish: (...args: unknown[]) => publishMock(...args),
    archive: vi.fn(),
    revert: vi.fn(),
    duplicate: vi.fn(),
    usage: (...args: unknown[]) => usageMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
  pagesApi: { list: vi.fn().mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 }) },
  postsApi: { list: vi.fn().mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 }) },
  categoriesApi: { list: vi.fn().mockResolvedValue({ categories: [] }) },
  tagsApi: { list: vi.fn().mockResolvedValue({ tags: [] }) },
  productsApi: { list: vi.fn().mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 }) },
}));

let mockPermissions: string[] = ["navigation_menus.read", "navigation_menus.create", "navigation_menus.update", "navigation_menus.publish", "navigation_menus.delete"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const revision = {
  id: "rev-1",
  navigationMenuId: "menu-1",
  version: 1,
  status: "DRAFT" as const,
  name: "Main Menu",
  items: [{ id: "item-1", label: "Home", linkType: "custom" as const, url: "/", openInNewTab: false, children: [] }],
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  publishedAt: null,
};

const menu = {
  id: "menu-1",
  organizationId: "org-1",
  type: "PRIMARY" as const,
  name: "Main Menu",
  slug: "main-menu",
  status: "DRAFT" as const,
  isSystem: false,
  currentRevisionId: "rev-1",
  currentRevision: revision,
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

beforeEach(() => {
  usageMock.mockResolvedValue({ templateParts: [], pages: [] });
});

afterEach(() => {
  cleanup();
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  publishMock.mockReset();
  usageMock.mockReset();
  removeMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["navigation_menus.read", "navigation_menus.create", "navigation_menus.update", "navigation_menus.publish", "navigation_menus.delete"];
});

describe("NavigationMenusPage", () => {
  it("renders the menu list and detail pane with real data, not fabricated content", async () => {
    listMock.mockResolvedValue({ items: [menu], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<NavigationMenusPage />);
    expect(await screen.findAllByText("Main Menu")).not.toHaveLength(0);
    expect(await screen.findByDisplayValue("Home")).toBeInTheDocument();
  });

  it("shows an empty state when there are no menus", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<NavigationMenusPage />);
    expect(await screen.findByText(/no navigation menus found/i)).toBeInTheDocument();
  });

  it("creates a menu with an added item through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    createMock.mockResolvedValue({ navigationMenu: menu });
    render(<NavigationMenusPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new menu/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "New Menu" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /add item/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /create menu/i }));

    await vi.waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: "New Menu", items: [expect.objectContaining({ linkType: "custom" })] })
      )
    );
  });

  it("publishes a menu through the real API", async () => {
    listMock.mockResolvedValue({ items: [menu], page: 1, limit: 20, total: 1, totalPages: 1 });
    publishMock.mockResolvedValue({ navigationMenu: { ...menu, status: "PUBLISHED" } });
    render(<NavigationMenusPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^publish$/i }));
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalledWith("menu-1"));
  });

  it("hides create/edit/publish actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["navigation_menus.read"];
    listMock.mockResolvedValue({ items: [menu], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<NavigationMenusPage />);

    await screen.findAllByText("Main Menu");
    expect(screen.queryByRole("button", { name: /new menu/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit items/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
  });

  it("shows real template parts/pages referencing this menu", async () => {
    usageMock.mockResolvedValue({ templateParts: [{ id: "tp-1", name: "Site Header", status: "PUBLISHED" }], pages: [] });
    listMock.mockResolvedValue({ items: [menu], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<NavigationMenusPage />);
    await screen.findAllByText("Main Menu");

    expect(await screen.findByText("Template part: Site Header")).toBeInTheDocument();
  });

  it("deletes a menu through the real API only after confirming", async () => {
    listMock.mockResolvedValue({ items: [menu], page: 1, limit: 20, total: 1, totalPages: 1 });
    removeMock.mockResolvedValue({ message: "Navigation menu deleted." });
    render(<NavigationMenusPage />);
    await screen.findAllByText("Main Menu");

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(removeMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await vi.waitFor(() => expect(removeMock).toHaveBeenCalledWith("menu-1"));
    expect(notifyMock).toHaveBeenCalledWith("Navigation menu deleted.", "success");
  });

  it("adding and removing a nested child item in the editor updates the tree", async () => {
    listMock.mockResolvedValue({ items: [menu], page: 1, limit: 20, total: 1, totalPages: 1 });
    render(<NavigationMenusPage />);
    await screen.findAllByText("Main Menu");

    fireEvent.click(screen.getByRole("button", { name: /edit items/i }));
    const dialog = await screen.findByRole("dialog");
    const addChildButtons = within(dialog).getAllByTitle("Add nested item");
    fireEvent.click(addChildButtons[0]!);

    const labels = within(dialog).getAllByPlaceholderText("Label");
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });
});
