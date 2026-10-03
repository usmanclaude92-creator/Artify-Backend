/** Phase 3 (Global Styles) — load/error states, draft save/publish/revert, section navigation, permission gating, no fabricated content. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { GlobalStylesPage } from "./GlobalStylesPage";

const getGlobalStylesMock = vi.fn();
const saveGlobalStylesDraftMock = vi.fn();
const publishGlobalStylesMock = vi.fn();
const revertGlobalStylesMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("../../lib/api", () => ({
  siteSettingsApi: {
    getGlobalStyles: (...args: unknown[]) => getGlobalStylesMock(...args),
    saveGlobalStylesDraft: (...args: unknown[]) => saveGlobalStylesDraftMock(...args),
    publishGlobalStyles: (...args: unknown[]) => publishGlobalStylesMock(...args),
    revertGlobalStyles: (...args: unknown[]) => revertGlobalStylesMock(...args),
  },
}));

let mockPermissions: string[] = ["settings.read", "settings.manage"];
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: { permissions: mockPermissions } } }),
}));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ notify: notifyMock }) }));

const globalStyles = {
  colors: {
    primary: "#7C3AED",
    primaryHover: "#6D28D9",
    primaryForeground: "#FFFFFF",
    secondary: "#F1F5F9",
    secondaryForeground: "#0F172A",
    background: "#050505",
    surface: "#0C0C10",
    textPrimary: "#F5F5F5",
    textSecondary: "#A1A1AA",
    link: "#A78BFA",
    linkHover: "#C4B5FD",
    border: "#27272A",
  },
  typography: {
    fontFamilyBase: "'Plus Jakarta Sans', sans-serif",
    fontFamilyHeading: "'Plus Jakarta Sans', sans-serif",
    fontSizeBase: "1rem",
    headingScale: { h1: "3rem", h2: "2.25rem", h3: "1.875rem", h4: "1.5rem", h5: "1.25rem", h6: "1rem" },
    lineHeightBase: 1.5,
    lineHeightHeading: 1.2,
    fontWeightBase: 400 as const,
    fontWeightHeading: 700 as const,
    fontWeightBold: 700 as const,
  },
  layout: {
    containerMaxWidth: "1280px",
    spacingScale: { xs: "0.25rem", sm: "0.5rem", md: "1rem", lg: "1.5rem", xl: "2rem" },
    borderRadius: { sm: "0.25rem", md: "0.5rem", lg: "1rem", full: "9999px" },
  },
  effects: { borderColor: "#27272A", borderWidth: "1px", shadowSm: "0 1px 2px rgba(0,0,0,0.3)", shadowMd: "0 4px 6px rgba(0,0,0,0.3)", shadowLg: "0 10px 15px rgba(0,0,0,0.3)" },
  buttons: {
    radius: "0.5rem",
    paddingX: "1rem",
    paddingY: "0.5rem",
    fontWeight: 600 as const,
    primaryBg: "#7C3AED",
    primaryText: "#FFFFFF",
    primaryHoverBg: "#6D28D9",
    secondaryBg: "transparent",
    secondaryText: "#F5F5F5",
    secondaryBorder: "#27272A",
  },
  forms: { radius: "0.5rem", borderColor: "#27272A", focusColor: "#7C3AED", background: "#0C0C10", text: "#F5F5F5" },
  responsive: { tablet: {}, mobile: {} },
};

function groupState(overrides: Partial<typeof globalStyles> = {}) {
  const draft = { ...globalStyles, ...overrides };
  return { draft, published: globalStyles, isDirty: JSON.stringify(draft) !== JSON.stringify(globalStyles), updatedAt: null, publishedAt: null };
}

/** ColorField renders both a native color-swatch input and a text input sharing the same value — this picks the text one. */
function getColorTextInput(value: string): HTMLInputElement {
  const matches = screen.getAllByDisplayValue(value) as HTMLInputElement[];
  const textInput = matches.find((el) => el.type !== "color");
  if (!textInput) throw new Error(`No text input found with value ${value}`);
  return textInput;
}

afterEach(() => {
  cleanup();
  getGlobalStylesMock.mockReset();
  saveGlobalStylesDraftMock.mockReset();
  publishGlobalStylesMock.mockReset();
  revertGlobalStylesMock.mockReset();
  notifyMock.mockReset();
  mockPermissions = ["settings.read", "settings.manage"];
});

describe("GlobalStylesPage", () => {
  it("loads real data and renders the Colors section by default", async () => {
    getGlobalStylesMock.mockResolvedValue(groupState());
    render(<GlobalStylesPage />);
    expect(await screen.findByRole("button", { name: "Colors" })).toBeInTheDocument();
    expect(getColorTextInput("#7C3AED")).toBeInTheDocument();
  });

  it("shows an error state when loading fails", async () => {
    getGlobalStylesMock.mockRejectedValue(new Error("boom"));
    render(<GlobalStylesPage />);
    expect(await screen.findByText("Failed to load global styles.")).toBeInTheDocument();
  });

  it("switches to the Typography section and shows its fields", async () => {
    getGlobalStylesMock.mockResolvedValue(groupState());
    render(<GlobalStylesPage />);
    await screen.findByRole("button", { name: "Colors" });
    fireEvent.click(screen.getByRole("button", { name: "Typography" }));
    expect(screen.getAllByDisplayValue("'Plus Jakarta Sans', sans-serif").length).toBeGreaterThan(0);
  });

  it("editing a color enables Save draft and saves through the real API", async () => {
    getGlobalStylesMock.mockResolvedValue(groupState());
    saveGlobalStylesDraftMock.mockResolvedValue({ draft: { ...globalStyles, colors: { ...globalStyles.colors, primary: "#FF0000" } } });
    render(<GlobalStylesPage />);
    await screen.findByRole("button", { name: "Colors" });
    const input = getColorTextInput("#7C3AED");

    expect(screen.getByRole("button", { name: /save draft/i })).toBeDisabled();
    fireEvent.change(input, { target: { value: "#FF0000" } });
    expect(screen.getByRole("button", { name: /save draft/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /save draft/i }));
    await waitFor(() =>
      expect(saveGlobalStylesDraftMock).toHaveBeenCalledWith(expect.objectContaining({ colors: expect.objectContaining({ primary: "#FF0000" }) }))
    );
    expect(notifyMock).toHaveBeenCalledWith("Draft saved.", "success");
  });

  it("publish saves first when dirty, then publishes", async () => {
    getGlobalStylesMock.mockResolvedValue(groupState());
    saveGlobalStylesDraftMock.mockResolvedValue({ draft: { ...globalStyles, colors: { ...globalStyles.colors, primary: "#FF0000" } } });
    publishGlobalStylesMock.mockResolvedValue({ published: { ...globalStyles, colors: { ...globalStyles.colors, primary: "#FF0000" } } });
    render(<GlobalStylesPage />);
    await screen.findByRole("button", { name: "Colors" });
    const input = getColorTextInput("#7C3AED");

    fireEvent.change(input, { target: { value: "#FF0000" } });
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    await waitFor(() => expect(publishGlobalStylesMock).toHaveBeenCalled());
    expect(saveGlobalStylesDraftMock).toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith("Global styles published.", "success");
  });

  it("revert asks for confirmation and resets the draft to the published value", async () => {
    getGlobalStylesMock.mockResolvedValue(groupState({ colors: { ...globalStyles.colors, primary: "#FF0000" } }));
    revertGlobalStylesMock.mockResolvedValue({ draft: globalStyles });
    render(<GlobalStylesPage />);
    await screen.findByRole("button", { name: "Colors" });
    expect(getColorTextInput("#FF0000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /revert/i }));
    const dialog = screen.getByText(/revert draft/i).closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByRole("button", { name: /^revert$/i }));

    await waitFor(() => expect(revertGlobalStylesMock).toHaveBeenCalled());
    await waitFor(() => expect(getColorTextInput("#7C3AED")).toBeInTheDocument());
  });

  it("hides Save draft/Publish/Revert and disables inputs for a caller with settings.read only", async () => {
    mockPermissions = ["settings.read"];
    getGlobalStylesMock.mockResolvedValue(groupState());
    render(<GlobalStylesPage />);
    await screen.findByRole("button", { name: "Colors" });
    const input = getColorTextInput("#7C3AED");
    expect(input).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^publish$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revert/i })).not.toBeInTheDocument();
  });
});
