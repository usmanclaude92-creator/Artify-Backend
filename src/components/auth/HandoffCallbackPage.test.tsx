import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HandoffCallbackPage } from "./HandoffCallbackPage";

const exchangeMock = vi.fn();
const setSessionMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../lib/api", () => ({ authApi: { exchangeHandoff: (...a: unknown[]) => exchangeMock(...a) } }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ setSessionFromAcceptedInvitation: setSessionMock }) }));
vi.mock("../../lib/router", () => ({ useRouter: () => ({ path: "/auth/callback", navigate: navigateMock }) }));

afterEach(() => {
  cleanup();
  exchangeMock.mockReset();
  setSessionMock.mockReset();
  navigateMock.mockReset();
});

describe("HandoffCallbackPage", () => {
  it("exchanges the code, strips it from the URL, starts the session and opens the dashboard", async () => {
    window.history.pushState({}, "", "/auth/callback?code=abc");
    exchangeMock.mockResolvedValue({ session: { token: "t", expiresAt: "x" }, user: { id: "1" } });
    render(<HandoffCallbackPage />);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/dashboard"));
    expect(exchangeMock).toHaveBeenCalledWith("abc");
    expect(setSessionMock).toHaveBeenCalledWith("t", { id: "1" });
    expect(window.location.search).toBe("");
  });

  it("shows an error and a way back to sign-in when the code is rejected", async () => {
    window.history.pushState({}, "", "/auth/callback?code=bad");
    const { ApiClientError } = await import("../../lib/apiClient");
    exchangeMock.mockRejectedValue(new ApiClientError("This sign-in link is invalid or has expired. Please sign in again.", { code: "UNAUTHORIZED", status: 401 }));
    render(<HandoffCallbackPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/i);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it("errors without calling the API when no code is present", async () => {
    window.history.pushState({}, "", "/auth/callback");
    render(<HandoffCallbackPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/missing its code/i);
    expect(exchangeMock).not.toHaveBeenCalled();
  });
});
