/**
 * Phase 7 §50 — product catalog list/detail, module management (add/
 * activate-deactivate/archive/reorder), create/edit forms, empty/error
 * states, permission-gated actions, no fabricated products.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProductsPage } from "./ProductsPage";
import { RouterProvider } from "../../lib/router";

const renderProductsPage = () =>
  render(
    <RouterProvider>
      <ProductsPage />
    </RouterProvider>
  );

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const archiveMock = vi.fn();
const modulesMock = vi.fn();
const addModuleMock = vi.fn();
const reorderModulesMock = vi.fn();
const moduleUpdateMock = vi.fn();
const moduleArchiveMock = vi.fn();
const notifyMock = vi.fn();

const categoriesListMock = vi.fn();
const industriesListMock = vi.fn();
const formsListMock = vi.fn();

vi.mock("../../lib/api", () => ({
  productsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    archive: (...args: unknown[]) => archiveMock(...args),
    bulkArchive: vi.fn(),
    duplicate: vi.fn(),
    listRevisions: vi.fn().mockResolvedValue({ revisions: [] }),
    revert: vi.fn(),
    modules: (...args: unknown[]) => modulesMock(...args),
    addModule: (...args: unknown[]) => addModuleMock(...args),
    reorderModules: (...args: unknown[]) => reorderModulesMock(...args),
  },
  productModulesApi: {
    get: vi.fn(),
    update: (...args: unknown[]) => moduleUpdateMock(...args),
    archive: (...args: unknown[]) => moduleArchiveMock(...args),
  },
  productCategoriesApi: { list: (...args: unknown[]) => categoriesListMock(...args) },
  industriesApi: { list: (...args: unknown[]) => industriesListMock(...args) },
  formsApi: { list: (...args: unknown[]) => formsListMock(...args) },
  mediaApi: { get: vi.fn(), getReadUrl: vi.fn() },
}));

let mockPermissions: string[] = [
  "products.read",
  "products.create",
  "products.update",
  "products.archive",
  "product_modules.read",
  "product_modules.create",
  "product_modules.update",
  "product_modules.archive",
  "product_modules.reorder",
];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const product = {
  id: "product-1",
  code: "HCMS-01",
  name: "Artify HCMS",
  slug: "artify-hcms",
  type: "PRODUCT" as const,
  shortDescription: "HR & payroll suite",
  description: null,
  status: "DRAFT" as const,
  isFeatured: false,
  displayOrder: 0,
  version: "1.0.0",
  featuredMediaId: null,
  categoryId: null,
  currentRevisionId: null,
  createdById: null,
  updatedById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const moduleA = {
  id: "module-1",
  productId: "product-1",
  code: "EMPLOYEE",
  name: "Employee Management",
  slug: "employee-management",
  description: null,
  status: "ACTIVE" as const,
  displayOrder: 0,
  isCore: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const moduleB = { ...moduleA, id: "module-2", code: "PAYROLL", name: "Payroll", displayOrder: 1, isCore: false };

afterEach(() => {
  cleanup();
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  archiveMock.mockReset();
  modulesMock.mockReset();
  addModuleMock.mockReset();
  reorderModulesMock.mockReset();
  moduleUpdateMock.mockReset();
  moduleArchiveMock.mockReset();
  categoriesListMock.mockReset();
  industriesListMock.mockReset();
  formsListMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = [
    "products.read",
    "products.create",
    "products.update",
    "products.archive",
    "product_modules.read",
    "product_modules.create",
    "product_modules.update",
    "product_modules.archive",
    "product_modules.reorder",
  ];
});

beforeEach(() => {
  modulesMock.mockResolvedValue({ items: [moduleA, moduleB], page: 1, limit: 100, total: 2, totalPages: 1 });
  categoriesListMock.mockResolvedValue({ categories: [] });
  industriesListMock.mockResolvedValue({ industries: [] });
  formsListMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
});

describe("ProductsPage", () => {
  it("renders the product list and detail pane with real modules, not fabricated data", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    renderProductsPage();

    expect(await screen.findAllByText("Artify HCMS")).not.toHaveLength(0);
    expect(await screen.findByText("Employee Management")).toBeInTheDocument();
    expect(screen.getByText("Payroll")).toBeInTheDocument();
  });

  it("shows an empty state when there are no products", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    renderProductsPage();
    expect(await screen.findByText(/no products found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Catalog unavailable"));
    renderProductsPage();
    expect(await screen.findByText(/catalog unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty modules state for a product with no modules configured", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    modulesMock.mockResolvedValue({ items: [], page: 1, limit: 100, total: 0, totalPages: 1 });
    renderProductsPage();
    expect(await screen.findByText(/no modules configured/i)).toBeInTheDocument();
  });

  it("creates a product through the real API", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    createMock.mockResolvedValue({ product });
    renderProductsPage();

    fireEvent.click(await screen.findByRole("button", { name: /new product/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^code$/i), { target: { value: "hcms-02" } });
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "New Product" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create product/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ code: "hcms-02", name: "New Product" })));
  });

  it("adds a module to the selected product through the real API", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    addModuleMock.mockResolvedValue({ module: moduleA });
    renderProductsPage();

    fireEvent.click(await screen.findByRole("button", { name: /add module/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^code$/i), { target: { value: "LEAVE" } });
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "Leave Management" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^add module$/i }));

    await vi.waitFor(() => expect(addModuleMock).toHaveBeenCalledWith("product-1", expect.objectContaining({ code: "LEAVE", name: "Leave Management" })));
  });

  it("deactivates an active module through the real API", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    moduleUpdateMock.mockResolvedValue({ module: { ...moduleA, status: "INACTIVE" } });
    renderProductsPage();

    await screen.findByText("Employee Management");
    fireEvent.click(screen.getAllByRole("button", { name: /^deactivate$/i })[0]!);

    await vi.waitFor(() => expect(moduleUpdateMock).toHaveBeenCalledWith("module-1", { status: "INACTIVE" }));
  });

  it("reorders modules by moving one down, calling the real reorder API with the full new order", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    reorderModulesMock.mockResolvedValue({ message: "ok" });
    renderProductsPage();

    await screen.findByText("Employee Management");
    const moveDownButtons = screen.getAllByLabelText(/move down/i);
    fireEvent.click(moveDownButtons[0]!);

    await vi.waitFor(() => expect(reorderModulesMock).toHaveBeenCalledWith("product-1", ["module-2", "module-1"]));
  });

  it("archives a module through the real API", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    moduleArchiveMock.mockResolvedValue({ module: { ...moduleA, status: "INACTIVE" } });
    renderProductsPage();

    await screen.findByText("Employee Management");
    fireEvent.click(screen.getAllByRole("button", { name: /^archive$/i })[1]!); // [0] is the product's own archive button

    await vi.waitFor(() => expect(moduleArchiveMock).toHaveBeenCalledWith("module-1"));
  });

  it("archives a product only after confirming the destructive dialog", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    archiveMock.mockResolvedValue({ product: { ...product, status: "ARCHIVED" } });
    renderProductsPage();

    fireEvent.click(await screen.findByRole("button", { name: /^archive$/i }));
    expect(archiveMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await vi.waitFor(() => expect(archiveMock).toHaveBeenCalledWith("product-1"));
  });

  it("hides create/edit/archive/module actions when the caller lacks the relevant permission", async () => {
    mockPermissions = ["products.read", "product_modules.read"];
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    renderProductsPage();

    await screen.findByText("Employee Management");
    expect(screen.queryByRole("button", { name: /new product/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add module/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^deactivate$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/move down/i)).not.toBeInTheDocument();
  });

  it("filters by type and status, sending the filters to the real API", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    renderProductsPage();
    await screen.findByText("Employee Management");

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: "SERVICE" } });
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ type: "SERVICE" })));
  });

  // --- Phase 10 (Products + Services + Solutions) ---

  it("locks the catalog to SERVICE when reached via /services, hiding the type selector", async () => {
    window.history.pushState({}, "", "/services");
    listMock.mockResolvedValue({ items: [{ ...product, type: "SERVICE" }], page: 1, limit: 20, total: 1, totalPages: 1 });
    renderProductsPage();

    expect(await screen.findByText("Services")).toBeInTheDocument();
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ type: "SERVICE" })));
    // No type selector when the route already fixes it — only status remains.
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    window.history.pushState({}, "", "/");
  });

  it("locks the catalog to SOLUTION when reached via /solutions", async () => {
    window.history.pushState({}, "", "/solutions");
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    renderProductsPage();

    expect(await screen.findByText("Solutions")).toBeInTheDocument();
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ type: "SOLUTION" })));
    window.history.pushState({}, "", "/");
  });

  it("duplicates a product through the real API", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    const duplicated = { ...product, id: "product-2", code: "HCMS-01-COPY", slug: "artify-hcms-copy" };
    const productsApiModule = await import("../../lib/api");
    vi.mocked(productsApiModule.productsApi.duplicate).mockResolvedValue({ product: duplicated });
    renderProductsPage();

    await screen.findByText("Employee Management");
    fireEvent.click(screen.getByRole("button", { name: /duplicate/i }));
    await vi.waitFor(() => expect(productsApiModule.productsApi.duplicate).toHaveBeenCalledWith("product-1"));
  });

  it("bulk-archives selected items via the real API after confirming", async () => {
    listMock.mockResolvedValue({ items: [product, { ...product, id: "product-2", code: "HCMS-02", name: "Second" }], page: 1, limit: 20, total: 2, totalPages: 1 });
    const productsApiModule = await import("../../lib/api");
    vi.mocked(productsApiModule.productsApi.bulkArchive).mockResolvedValue({ archived: 1, skipped: [] });
    renderProductsPage();

    await screen.findByText("Employee Management");
    const checkboxes = screen.getAllByLabelText(/^select /i);
    fireEvent.click(checkboxes[0]!);

    fireEvent.click(screen.getByRole("button", { name: /archive 1 selected/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));

    await vi.waitFor(() => expect(productsApiModule.productsApi.bulkArchive).toHaveBeenCalledWith(["product-1"]));
  });

  it("opens revision history and reverts to a prior version through the real API", async () => {
    listMock.mockResolvedValue({ items: [product], page: 1, limit: 20, total: 1, totalPages: 1 });
    const productsApiModule = await import("../../lib/api");
    vi.mocked(productsApiModule.productsApi.listRevisions).mockResolvedValue({
      revisions: [
        { id: "rev-2", productId: "product-1", version: 2, name: "Artify HCMS", content: {}, createdById: null, createdAt: "2026-01-02T00:00:00.000Z" },
        { id: "rev-1", productId: "product-1", version: 1, name: "Artify HCMS", content: {}, createdById: null, createdAt: "2026-01-01T00:00:00.000Z" },
      ],
    });
    vi.mocked(productsApiModule.productsApi.revert).mockResolvedValue({ product: { ...product, currentRevisionId: "rev-3" } });
    renderProductsPage();

    await screen.findByText("Employee Management");
    fireEvent.click(screen.getByRole("button", { name: /revisions/i }));

    expect(await screen.findByText("Version 2")).toBeInTheDocument();
    expect(screen.getByText("Version 1")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /revert to this/i })[0]!);

    await vi.waitFor(() => expect(productsApiModule.productsApi.revert).toHaveBeenCalledWith("product-1", "rev-2"));
  });
});
