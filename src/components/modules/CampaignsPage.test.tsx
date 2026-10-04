/**
 * Phase 14 — campaigns list, create form, lifecycle actions,
 * permission-gating, empty/error states. All data comes from mocked
 * `campaignsApi` calls; nothing here is rendered from fabricated/local data.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CampaignsPage } from "./CampaignsPage";

const listMock = vi.fn();
const getMock = vi.fn();
const createMock = vi.fn();
const activateMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  campaignsApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: vi.fn(),
    duplicate: vi.fn(),
    activate: (...args: unknown[]) => activateMock(...args),
    pause: vi.fn(),
    publish: vi.fn(),
    archive: vi.fn(),
    preview: vi.fn().mockResolvedValue({ preview: { landingPageUrl: null, landingPageStatus: null, configured: false } }),
    activity: vi.fn().mockResolvedValue({ activity: [] }),
  },
  pagesApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
  formsApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
  usersApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
  productsApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
}));

let mockPermissions: string[] = ["campaigns.read", "campaigns.create", "campaigns.update", "campaigns.publish", "campaigns.archive"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const campaign = {
  id: "campaign-1",
  organizationId: "org-1",
  name: "Spring Launch",
  description: null,
  status: "DRAFT",
  channel: "EMAIL",
  startDate: null,
  endDate: null,
  ownerId: null,
  owner: null,
  budget: null,
  currency: null,
  landingPageId: null,
  landingPage: null,
  formId: null,
  form: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: "spring-launch",
  utmTerm: null,
  utmContent: null,
  targetAudience: null,
  notes: null,
  createdById: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  products: [],
  _count: { leads: 0, formSubmissions: 0, opportunities: 0, clients: 0 },
};

afterEach(() => {
  cleanup();
  listMock.mockReset();
  getMock.mockReset();
  createMock.mockReset();
  activateMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["campaigns.read", "campaigns.create", "campaigns.update", "campaigns.publish", "campaigns.archive"];
});

describe("CampaignsPage", () => {
  it("renders campaigns returned by the real API, not fabricated data", async () => {
    listMock.mockResolvedValue({ items: [campaign], page: 1, limit: 20, total: 1, totalPages: 1 });
    getMock.mockResolvedValue({ campaign });
    render(<CampaignsPage />);
    expect(await screen.findByText("Spring Launch")).toBeInTheDocument();
    expect(listMock).toHaveBeenCalled();
  });

  it("shows an empty state when there are no campaigns", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    render(<CampaignsPage />);
    expect(await screen.findByText(/no campaigns found/i)).toBeInTheDocument();
  });

  it("shows an error state when the API call fails", async () => {
    listMock.mockRejectedValue(new Error("Network unreachable"));
    render(<CampaignsPage />);
    expect(await screen.findByText(/network unreachable/i)).toBeInTheDocument();
  });

  it("hides the New campaign button when the caller lacks campaigns.create", async () => {
    mockPermissions = ["campaigns.read"];
    listMock.mockResolvedValue({ items: [campaign], page: 1, limit: 20, total: 1, totalPages: 1 });
    getMock.mockResolvedValue({ campaign });
    render(<CampaignsPage />);
    await screen.findByText("Spring Launch");
    expect(screen.queryByRole("button", { name: /new campaign/i })).not.toBeInTheDocument();
  });

  it("creates a campaign through the real API when the form is submitted", async () => {
    listMock.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0, totalPages: 1 });
    createMock.mockResolvedValue({ campaign });
    render(<CampaignsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /new campaign/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "New Campaign" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /create campaign/i }));

    await vi.waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: "New Campaign" })));
  });

  it("activates a DRAFT campaign through the real API", async () => {
    listMock.mockResolvedValue({ items: [campaign], page: 1, limit: 20, total: 1, totalPages: 1 });
    getMock.mockResolvedValue({ campaign });
    activateMock.mockResolvedValue({ campaign: { ...campaign, status: "ACTIVE" } });
    render(<CampaignsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^activate$/i }));
    await vi.waitFor(() => expect(activateMock).toHaveBeenCalledWith("campaign-1"));
  });
});
