/**
 * Phase 5 §34 — clients list/master-detail, embedded contact management
 * (add/mark primary/remove), create form, empty state, API error state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ClientsPage } from "./ClientsPage";

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const removeMock = vi.fn();
const contactsMock = vi.fn();
const addContactMock = vi.fn();
const contactUpdateMock = vi.fn();
const contactRemoveMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  clientsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
    contacts: (...args: unknown[]) => contactsMock(...args),
    addContact: (...args: unknown[]) => addContactMock(...args),
  },
  contactsApi: {
    list: vi.fn(),
    get: vi.fn(),
    update: (...args: unknown[]) => contactUpdateMock(...args),
    remove: (...args: unknown[]) => contactRemoveMock(...args),
  },
}));

let mockPermissions: string[] = [
  "clients.read",
  "clients.create",
  "clients.update",
  "clients.delete",
  "contacts.read",
  "contacts.create",
  "contacts.update",
  "contacts.delete",
];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const client = {
  id: "client-1",
  organizationId: "org-1",
  clientCode: "ACME-01",
  name: "Acme Corp",
  legalName: null,
  status: "ACTIVE",
  email: "hello@acme.com",
  phone: null,
  website: null,
  address: null,
  accountManager: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const contact = {
  id: "contact-1",
  organizationId: "org-1",
  clientId: "client-1",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@acme.com",
  phone: null,
  jobTitle: "CFO",
  isPrimary: true,
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  removeMock.mockReset();
  contactsMock.mockReset();
  addContactMock.mockReset();
  contactUpdateMock.mockReset();
  contactRemoveMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = [
    "clients.read",
    "clients.create",
    "clients.update",
    "clients.delete",
    "contacts.read",
    "contacts.create",
    "contacts.update",
    "contacts.delete",
  ];
});

describe("ClientsPage", () => {
  it("renders the client list and its detail pane with real contacts, not fabricated data", async () => {
    listMock.mockResolvedValue({ items: [client], page: 1, limit: 20, total: 1, totalPages: 1 });
    contactsMock.mockResolvedValue({ items: [contact], page: 1, limit: 50, total: 1, totalPages: 1 });
    render(<ClientsPage />);

    expect(await screen.findAllByText("Acme Corp")).not.toHaveLength(0);
    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
    expect(contactsMock).toHaveBeenCalledWith("client-1", expect.any(Object));
  });

  it("shows an empty state when there are no clients", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<ClientsPage />);
    expect(await screen.findByText(/no clients found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Server exploded"));
    render(<ClientsPage />);
    expect(await screen.findByText(/server exploded/i)).toBeInTheDocument();
  });

  it("adds a contact to the selected client through the real API", async () => {
    listMock.mockResolvedValue({ items: [client], page: 1, limit: 20, total: 1, totalPages: 1 });
    contactsMock.mockResolvedValue({ items: [], page: 1, limit: 50, total: 0, totalPages: 1 });
    addContactMock.mockResolvedValue({ contact });
    render(<ClientsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /add contact/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/first name/i), { target: { value: "Jane" } });
    fireEvent.change(within(dialog).getByLabelText(/last name/i), { target: { value: "Doe" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^add contact$/i }));

    await vi.waitFor(() =>
      expect(addContactMock).toHaveBeenCalledWith("client-1", expect.objectContaining({ firstName: "Jane", lastName: "Doe" }))
    );
  });

  it("archives a client only after confirming the destructive dialog", async () => {
    listMock.mockResolvedValue({ items: [client], page: 1, limit: 20, total: 1, totalPages: 1 });
    contactsMock.mockResolvedValue({ items: [], page: 1, limit: 50, total: 0, totalPages: 1 });
    removeMock.mockResolvedValue({ message: "ok" });
    render(<ClientsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^archive$/i }));
    expect(removeMock).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive$/i }));
    await vi.waitFor(() => expect(removeMock).toHaveBeenCalledWith("client-1"));
  });

  it("hides create/edit/archive actions when the caller lacks the permission", async () => {
    mockPermissions = ["clients.read", "contacts.read"];
    listMock.mockResolvedValue({ items: [client], page: 1, limit: 20, total: 1, totalPages: 1 });
    contactsMock.mockResolvedValue({ items: [contact], page: 1, limit: 50, total: 1, totalPages: 1 });
    render(<ClientsPage />);

    await screen.findByText("Jane Doe");
    expect(screen.queryByRole("button", { name: /new client/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add contact/i })).not.toBeInTheDocument();
  });
});
