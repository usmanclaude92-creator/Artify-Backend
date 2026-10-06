import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

const badgesMock = vi.fn();
vi.mock("./api", () => ({ navApi: { badges: () => badgesMock() } }));

import { useNavBadges, NAV_BADGE_POLL_MS } from "./useNavBadges";

const Probe = () => {
  const b = useNavBadges();
  return <p>approvals:{b?.approvals ?? "none"}</p>;
};

beforeEach(() => {
  vi.useFakeTimers();
  badgesMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useNavBadges", () => {
  it("loads on mount, polls every 60s and refreshes on window focus", async () => {
    badgesMock.mockResolvedValue({ approvals: 1, notifications: 0 });
    render(<Probe />);
    await act(async () => {});
    expect(screen.getByText("approvals:1")).toBeInTheDocument();
    expect(badgesMock).toHaveBeenCalledTimes(1);

    badgesMock.mockResolvedValue({ approvals: 4, notifications: 0 });
    await act(async () => {
      vi.advanceTimersByTime(NAV_BADGE_POLL_MS);
    });
    expect(screen.getByText("approvals:4")).toBeInTheDocument();
    expect(badgesMock).toHaveBeenCalledTimes(2);

    badgesMock.mockResolvedValue({ approvals: 5, notifications: 0 });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByText("approvals:5")).toBeInTheDocument();
  });

  it("keeps the last value when a refresh fails", async () => {
    badgesMock.mockResolvedValueOnce({ approvals: 2, notifications: 0 }).mockRejectedValue(new Error("offline"));
    render(<Probe />);
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(NAV_BADGE_POLL_MS);
    });
    expect(screen.getByText("approvals:2")).toBeInTheDocument();
  });
});
