import { afterEach, describe, expect, it, vi } from "vitest";

// The real config is frozen; give this suite a mutable copy so key rings / flags can be varied.
vi.mock("../../server/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/config/env")>();
  return { ...actual, config: { ...actual.config } };
});
import { config } from "../../server/config/env";
import { connectorRegistry } from "../../server/services/social/connectors/registry";
import { mockProvider } from "../../server/services/social/connectors/mockProvider";
import { ConnectorNotImplementedError } from "../../server/services/social/connectors/types";
import { linkedinProvider, metaProvider } from "../../server/services/social/connectors/stubProviders";

const mutable = config as unknown as Record<string, unknown>;
afterEach(() => {
  mutable.socialMockProviderEnabled = true;
  mutable.metaAppId = "";
  mutable.metaAppSecret = "";
});

describe("connector registry", () => {
  it("registers meta, linkedin and (in dev/test) mock; meta/linkedin are 'not configured'", () => {
    const list = connectorRegistry.list();
    expect(list.map((p) => p.key).sort()).toEqual(["linkedin", "meta", "mock"]);
    expect(list.find((p) => p.key === "meta")).toMatchObject({ configured: false, available: false });
    expect(list.find((p) => p.key === "mock")).toMatchObject({ configured: true, available: true });
    expect(connectorRegistry.getAvailable("meta")).toBeUndefined();
    expect(connectorRegistry.getAvailable("nope")).toBeUndefined();
  });

  it("hides the mock provider when disabled (production default)", () => {
    mutable.socialMockProviderEnabled = false;
    expect(connectorRegistry.list().map((p) => p.key)).not.toContain("mock");
    expect(connectorRegistry.getAvailable("mock")).toBeUndefined();
  });

  it("a provider with credentials but no connector code is configured yet still unavailable", () => {
    mutable.metaAppId = "id";
    mutable.metaAppSecret = "secret";
    expect(connectorRegistry.list().find((p) => p.key === "meta")).toMatchObject({ configured: true, available: false });
    expect(() => metaProvider.getAuthUrl({ state: "s", redirectUri: "r" })).toThrow(ConnectorNotImplementedError);
    expect(linkedinProvider.implemented).toBe(false);
  });
});

describe("mock provider", () => {
  it("runs a full no-network lifecycle", async () => {
    const url = mockProvider.getAuthUrl({ state: "abc", redirectUri: "http://x/cb" });
    expect(url).toContain("state=abc");
    const { profile, tokens } = await mockProvider.handleCallback({ code: "mock_demo", redirectUri: "http://x/cb" });
    expect(profile).toMatchObject({ externalAccountId: "mock-demo", handle: "@mock_demo" });
    expect(tokens.accessToken).toMatch(/^mock_at_/);
    expect((await mockProvider.healthCheck(tokens)).ok).toBe(true);
    const refreshed = await mockProvider.refreshToken(tokens);
    expect(refreshed.accessToken).not.toBe(tokens.accessToken);
    expect((await mockProvider.getProfile(tokens)).externalAccountId).toBe("mock-demo");
  });

  it("exposes failure paths for tests", async () => {
    await expect(mockProvider.handleCallback({ code: "mock_fail", redirectUri: "" })).rejects.toThrow(/rejected/);
    await expect(mockProvider.handleCallback({ code: "bogus", redirectUri: "" })).rejects.toThrow(/Invalid/);
    const { tokens } = await mockProvider.handleCallback({ code: "mock_expired", redirectUri: "" });
    expect((await mockProvider.healthCheck(tokens)).ok).toBe(false);
    const norefresh = (await mockProvider.handleCallback({ code: "mock_norefresh", redirectUri: "" })).tokens;
    await expect(mockProvider.refreshToken(norefresh)).rejects.toThrow(/reconnect/);
  });
});
