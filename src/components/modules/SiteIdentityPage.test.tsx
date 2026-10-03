/** Phase 3 (Site Identity) — load/error states, draft save/publish/revert, permission gating, unsaved-change protection, no fabricated content. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SiteIdentityPage } from "./SiteIdentityPage";

const getIdentityMock = vi.fn();
const saveIdentityDraftMock = vi.fn();
const publishIdentityMock = vi.fn();
const revertIdentityMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  siteSettingsApi: {
    getIdentity: (...args: unknown[]) => getIdentityMock(...args),
    saveIdentityDraft: (...args: unknown[]) => saveIdentityDraftMock(...args),
    publishIdentity: (...args: unknown[]) => publishIdentityMock(...args),
    revertIdentity: (...args: unknown[]) => revertIdentityMock(...args),
  },
  mediaApi: {
    getReadUrl: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/x.jpg", expiresAt: "2026-01-01" }),
    list: vi.fn().mockResolvedValue({ items: [], page: 1, limit: 24, total: 0, totalPages: 1 }),
  },
}));

let mockPermissions: string[] = ["settings.read", "settings.manage"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const identity = {
  siteName: "Artify Solutions",
  tagline: "AI-Native Software & Intelligent Automation",
  description: "We build AI-native software.",
  logoMediaId: null,
  logoDarkMediaId: null,
  logoMobileMediaId: null,
  faviconMediaId: null,
  socialImageMediaId: null,
  defaultMetaTitle: "Artify Solutions | Default Title",
  defaultMetaDescription: "Default description.",
  contactEmail: "",
  contactPhone: "",
  address: "",
  organizationLegalName: "",
};

function groupState(overrides: Partial<typeof identity> = {}) {
  const draft = { ...identity, ...overrides };
  return { draft, published: identity, isDirty: JSON.stringify(draft) !== JSON.stringify(identity), updatedAt: null, publishedAt: null };
}

afterEach(() => {
  cleanup();
  getIdentityMock.mockReset();
  saveIdentityDraftMock.mockReset();
  publishIdentityMock.mockReset();
  revertIdentityMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["settings.read", "settings.manage"];
});

describe("SiteIdentityPage", () => {
  it("loads real data and renders the identity form", async () => {
    getIdentityMock.mockResolvedValue(groupState());
    render(<SiteIdentityPage />);
    expect(await screen.findByDisplayValue("Artify Solutions")).toBeInTheDocument();
    expect(screen.getByDisplayValue("AI-Native Software & Intelligent Automation")).toBeInTheDocument();
  });

  it("shows an error state when loading fails", async () => {
    getIdentityMock.mockRejectedValue(new Error("boom"));
    render(<SiteIdentityPage />);
    expect(await screen.findByText("Failed to load site identity.")).toBeInTheDocument();
  });

  it("editing a field enables Save draft (dirty tracking) and saves through the real API", async () => {
    getIdentityMock.mockResolvedValue(groupState());
    saveIdentityDraftMock.mockResolvedValue({ draft: { ...identity, siteName: "New Name" } });
    render(<SiteIdentityPage />);
    const input = await screen.findByDisplayValue("Artify Solutions");

    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: "New Name" } });
    expect(screen.getByRole("button", { name: /save draft/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() => expect(saveIdentityDraftMock).toHaveBeenCalledWith(expect.objectContaining({ siteName: "New Name" })));
    expect(notifyMock).toHaveBeenCalledWith("Draft saved.", "success");
  });

  it("publish saves first when dirty, then publishes", async () => {
    getIdentityMock.mockResolvedValue(groupState());
    saveIdentityDraftMock.mockResolvedValue({ draft: { ...identity, siteName: "New Name" } });
    publishIdentityMock.mockResolvedValue({ published: { ...identity, siteName: "New Name" } });
    render(<SiteIdentityPage />);
    const input = await screen.findByDisplayValue("Artify Solutions");

    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    await waitFor(() => expect(publishIdentityMock).toHaveBeenCalled());
    expect(saveIdentityDraftMock).toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith("Site identity published.", "success");
  });

  it("revert asks for confirmation and resets the draft to the published value", async () => {
    getIdentityMock.mockResolvedValue(groupState({ siteName: "Unsaved Draft" }));
    revertIdentityMock.mockResolvedValue({ draft: identity });
    render(<SiteIdentityPage />);
    await screen.findByDisplayValue("Unsaved Draft");

    fireEvent.click(screen.getByRole("button", { name: /revert/i }));
    const dialog = screen.getByText(/revert draft/i).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole("button", { name: /^revert$/i }));

    await waitFor(() => expect(revertIdentityMock).toHaveBeenCalled());
    expect(await screen.findByDisplayValue("Artify Solutions")).toBeInTheDocument();
  });

  it("hides Save draft/Publish/Revert and disables inputs for a caller with settings.read only", async () => {
    mockPermissions = ["settings.read"];
    getIdentityMock.mockResolvedValue(groupState());
    render(<SiteIdentityPage />);
    const input = await screen.findByDisplayValue("Artify Solutions");
    expect(input).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revert/i })).not.toBeInTheDocument();
  });
});
