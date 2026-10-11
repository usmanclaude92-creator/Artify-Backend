import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageErrorBoundary, isChunkLoadError } from "./PageErrorBoundary";

const reload = vi.fn();
beforeEach(() => {
  sessionStorage.clear();
  reload.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.defineProperty(window, "location", { value: { ...window.location, reload }, writable: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const Boom: React.FC<{ msg: string }> = ({ msg }) => { throw new Error(msg); };

describe("PageErrorBoundary", () => {
  it("shows a message with a reload button instead of a blank page", () => {
    render(<PageErrorBoundary><Boom msg="x is undefined" /></PageErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be shown");
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
  });

  it("reloads once for a failed chunk, then shows the message instead of looping", () => {
    const msg = "Failed to fetch dynamically imported module: https://x/assets/PostsPage-abc.js";
    expect(isChunkLoadError(new Error(msg))).toBe(true);
    render(<PageErrorBoundary><Boom msg={msg} /></PageErrorBoundary>);
    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();
    render(<PageErrorBoundary><Boom msg={msg} /></PageErrorBoundary>);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("updated while this tab was open");
  });
});
