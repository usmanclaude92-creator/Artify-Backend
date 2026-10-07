import { describe, it, expect, beforeEach } from "vitest";
import { stashOAuthReturn, takeOAuthReturn, hasPendingOAuthReturn } from "./oauthReturn";

describe("oauthReturn", () => {
  beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, "", "/"); });

  it("survives a redirect to /login and is single-use", () => {
    window.history.replaceState({}, "", "/social/accounts?state=abc&code=xyz");
    stashOAuthReturn();
    window.history.replaceState({}, "", "/login");
    expect(hasPendingOAuthReturn()).toBe(true);
    expect(takeOAuthReturn()).toEqual({ state: "abc", code: "xyz", error: undefined });
    expect(takeOAuthReturn()).toBeNull();
  });

  it("ignores other paths and falls back to the live URL", () => {
    window.history.replaceState({}, "", "/other?state=a&code=b");
    stashOAuthReturn();
    expect(hasPendingOAuthReturn()).toBe(false);
    window.history.replaceState({}, "", "/social/accounts?state=s2&error=access_denied");
    expect(takeOAuthReturn()).toEqual({ state: "s2", code: undefined, error: "access_denied" });
  });
});
