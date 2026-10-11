import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_TOKEN_KEY, adoptStashedSession, clearStashedSession, stashSessionForOAuth } from "./oauthSessionHandoff";

const at = (path: string) => window.history.replaceState({}, "", path);

describe("OAuth session hand-off", () => {
  beforeEach(() => { sessionStorage.clear(); localStorage.clear(); at("/"); });
  afterEach(() => { sessionStorage.clear(); localStorage.clear(); at("/"); });

  it("a new tab adopts the token once on the provider return, then the slot is gone", () => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, "TOK");
    stashSessionForOAuth();
    sessionStorage.clear(); // a new tab has an empty sessionStorage
    at("/social/accounts?state=abc&code=xyz");
    expect(adoptStashedSession()).toBe("TOK");
    expect(adoptStashedSession()).toBeNull();
  });

  it("is not adopted on any other page (and the slot is still cleared)", () => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, "TOK");
    stashSessionForOAuth();
    at("/dashboard");
    expect(adoptStashedSession()).toBeNull();
    at("/social/accounts?state=abc");
    expect(adoptStashedSession()).toBeNull();
  });

  it("expires after 10 minutes", () => {
    localStorage.setItem("artify.oauthSession", JSON.stringify({ token: "TOK", at: Date.now() - 11 * 60 * 1000 }));
    at("/social/accounts?state=abc");
    expect(adoptStashedSession()).toBeNull();
  });

  it("stores nothing when signed out, and clear removes the slot", () => {
    stashSessionForOAuth();
    expect(localStorage.getItem("artify.oauthSession")).toBeNull();
    sessionStorage.setItem(SESSION_TOKEN_KEY, "TOK");
    stashSessionForOAuth();
    clearStashedSession();
    expect(localStorage.getItem("artify.oauthSession")).toBeNull();
  });
});
