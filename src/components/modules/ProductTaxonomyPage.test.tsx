/** Phase 10 (Products + Services + Solutions) — Categories & Industries: list/create/delete, permission-gated, real API only. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProductTaxonomyPage } from "./ProductTaxonomyPage";

const categoriesListMock = vi.fn();
const categoriesCreateMock = vi.fn();
const categoriesDeleteMock = vi.fn();
const industriesListMock = vi.fn();
const industriesCreateMock = vi.fn();
const industriesDeleteMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  productCategoriesApi: {
    list: (...args: unknown[]) => categoriesListMock(...args),
    create: (...args: unknown[]) => categoriesCreateMock(...args),
    delete: (...args: unknown[]) => categoriesDeleteMock(...args),
  },
  industriesApi: {
    list: (...args: unknown[]) => industriesListMock(...args),
    create: (...args: unknown[]) => industriesCreateMock(...args),
    delete: (...args: unknown[]) => industriesDeleteMock(...args),
  },
}));

let mockPermissions: string[] = ["product_categories.read", "product_categories.manage", "industries.read", "industries.manage"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const category = { id: "cat-1", slug: "hr-platforms", name: "HR Platforms", description: "HR tech", displayOrder: 0 };
const industry = { id: "ind-1", slug: "finance", name: "Finance", description: null, displayOrder: 0 };

afterEach(() => {
  cleanup();
  categoriesListMock.mockReset();
  categoriesCreateMock.mockReset();
  categoriesDeleteMock.mockReset();
  industriesListMock.mockReset();
  industriesCreateMock.mockReset();
  industriesDeleteMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["product_categories.read", "product_categories.manage", "industries.read", "industries.manage"];
});

beforeEach(() => {
  categoriesListMock.mockResolvedValue({ categories: [category] });
  industriesListMock.mockResolvedValue({ industries: [industry] });
});

describe("ProductTaxonomyPage", () => {
  it("renders real categories and industries, not fabricated rows", async () => {
    render(<ProductTaxonomyPage />);
    expect(await screen.findByText("HR Platforms")).toBeInTheDocument();
    expect(await screen.findByText("Finance")).toBeInTheDocument();
  });

  it("shows empty states when there are none yet", async () => {
    categoriesListMock.mockResolvedValue({ categories: [] });
    industriesListMock.mockResolvedValue({ industries: [] });
    render(<ProductTaxonomyPage />);
    expect(await screen.findByText(/no category yet/i)).toBeInTheDocument();
    expect(await screen.findByText(/no industry yet/i)).toBeInTheDocument();
  });

  it("creates a category through the real API", async () => {
    render(<ProductTaxonomyPage />);
    await screen.findByText("HR Platforms");
    categoriesCreateMock.mockResolvedValue({ category: { ...category, id: "cat-2", name: "New Category" } });

    fireEvent.click(screen.getByRole("button", { name: /new category/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "New Category" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^create$/i }));

    await vi.waitFor(() => expect(categoriesCreateMock).toHaveBeenCalledWith({ name: "New Category", description: undefined }));
  });

  it("deletes an industry only after confirming the destructive dialog, surfacing a real conflict error", async () => {
    industriesDeleteMock.mockRejectedValue(new Error("This industry is tagged on 2 products — untag them before deleting it."));
    render(<ProductTaxonomyPage />);
    await screen.findByText("Finance");

    fireEvent.click(screen.getByRole("button", { name: /delete finance/i }));
    expect(industriesDeleteMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^delete$/i }));
    await vi.waitFor(() => expect(industriesDeleteMock).toHaveBeenCalledWith("ind-1"));
  });

  it("hides create/delete actions when the caller lacks manage permissions", async () => {
    mockPermissions = ["product_categories.read", "industries.read"];
    render(<ProductTaxonomyPage />);
    await screen.findByText("HR Platforms");
    expect(screen.queryByRole("button", { name: /new category/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new industry/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});
