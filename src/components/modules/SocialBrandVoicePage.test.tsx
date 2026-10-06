import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ api: { brandVoice: vi.fn(), settings: vi.fn(), saveBrandVoice: vi.fn(), saveSettings: vi.fn() }, notify: vi.fn() }));
let user = { role: { key: "ADMIN", permissions: ["social.read", "social.accounts.manage"] } };
vi.mock("../../lib/api", () => ({ socialContentApi: h.api }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: h.notify }) }));
vi.mock("../../context/ActiveWorkspaceContext", () => ({ useActiveWorkspace: () => ({ current: { organizationId: "o1", organizationName: "QA_TEST_2026_ Org" } }) }));

import { SocialBrandVoicePage } from "./SocialBrandVoicePage";

const voice = { toneDescriptors: ["friendly"], audience: null, dos: [], donts: [], bannedWords: ["guarantee"], requiredDisclaimers: [], defaultHashtags: [], ctaPhrases: [], languages: ["en"] };

beforeEach(() => {
  user = { role: { key: "ADMIN", permissions: ["social.read", "social.accounts.manage"] } };
  h.api.brandVoice.mockResolvedValue(voice);
  h.api.settings.mockResolvedValue({ approvalMode: "ALWAYS_REQUIRE" });
  h.api.saveBrandVoice.mockImplementation(async (v) => v);
  h.api.saveSettings.mockResolvedValue({ approvalMode: "AUTO_IF_GUARDRAILS_PASS" });
});
afterEach(() => {
  cleanup();
  Object.values(h.api).forEach((m) => m.mockReset());
  h.notify.mockReset();
});

describe("SocialBrandVoicePage", () => {
  it("loads the workspace brand voice and saves added/removed list items", async () => {
    render(<SocialBrandVoicePage />);
    expect(await screen.findByText("friendly")).toBeInTheDocument();
    expect(screen.getByText("guarantee")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Banned words"), { target: { value: "cheap" } });
    fireEvent.keyDown(screen.getByLabelText("Banned words"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Remove friendly" }));
    fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "Operations leaders" } });
    fireEvent.click(screen.getByRole("button", { name: "Save brand voice" }));
    await waitFor(() => expect(h.api.saveBrandVoice).toHaveBeenCalled());
    expect(h.api.saveBrandVoice.mock.calls[0]![0]).toMatchObject({ bannedWords: ["guarantee", "cheap"], toneDescriptors: [], audience: "Operations leaders" });
    expect(h.notify).toHaveBeenCalledWith("Brand voice saved.", "success");
  });

  it("administrators can change the approval mode; others see it disabled", async () => {
    const first = render(<SocialBrandVoicePage />);
    fireEvent.change(await screen.findByLabelText("How posts get approved in this workspace"), { target: { value: "AUTO_IF_GUARDRAILS_PASS" } });
    await waitFor(() => expect(h.api.saveSettings).toHaveBeenCalledWith("AUTO_IF_GUARDRAILS_PASS"));
    first.unmount();
    user = { role: { key: "MANAGER", permissions: ["social.read", "social.accounts.manage"] } };
    render(<SocialBrandVoicePage />);
    expect(await screen.findByLabelText("How posts get approved in this workspace")).toBeDisabled();
    expect(screen.getByText(/Only administrators can change this setting/)).toBeInTheDocument();
  });

  it("is read-only without the manage permission", async () => {
    user = { role: { key: "VIEWER", permissions: ["social.read"] } };
    render(<SocialBrandVoicePage />);
    await screen.findByText("friendly");
    expect(screen.queryByRole("button", { name: "Save brand voice" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove friendly" })).toBeNull();
    expect(screen.getByLabelText("Audience")).toBeDisabled();
  });

  it("shows an error state", async () => {
    h.api.brandVoice.mockRejectedValue(new Error("nope"));
    render(<SocialBrandVoicePage />);
    expect(await screen.findByText("nope")).toBeInTheDocument();
  });
});
