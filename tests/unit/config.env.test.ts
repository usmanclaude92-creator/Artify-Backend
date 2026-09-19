import { describe, expect, it } from "vitest";
import { validateEnv } from "../../server/config/env";

const VALID_BASE = {
  NODE_ENV: "development",
  PORT: "3000",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  SESSION_SECRET: "a".repeat(20),
  CORS_ORIGINS: "http://localhost:3000",
  LOG_LEVEL: "info",
  WEBHOOK_SECRET: "b".repeat(20),
};

describe("validateEnv", () => {
  it("accepts a fully valid development configuration", () => {
    const result = validateEnv(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.nodeEnv).toBe("development");
      expect(result.config.corsOrigins).toEqual(["http://localhost:3000"]);
    }
  });

  it("fails fast when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _omit, ...rest } = VALID_BASE;
    const result = validateEnv(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.includes("DATABASE_URL"))).toBe(true);
    }
  });

  it("rejects a DATABASE_URL that isn't a postgresql:// connection string", () => {
    const result = validateEnv({ ...VALID_BASE, DATABASE_URL: "mysql://user:pass@localhost/db" });
    expect(result.success).toBe(false);
  });

  it("rejects the known-compromised webhook secret from the Phase 0 audit (S3/S4/R3/R4)", () => {
    const result = validateEnv({ ...VALID_BASE, WEBHOOK_SECRET: "artify_whsec_prod_2026_soc2" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.toLowerCase().includes("compromised"))).toBe(true);
    }
  });

  it("requires a >=32-char SESSION_SECRET in production", () => {
    const result = validateEnv({ ...VALID_BASE, NODE_ENV: "production", SESSION_SECRET: "short-secret-16c" });
    expect(result.success).toBe(false);
  });

  it("accepts a >=32-char SESSION_SECRET in production", () => {
    const result = validateEnv({ ...VALID_BASE, NODE_ENV: "production", SESSION_SECRET: "x".repeat(32) });
    expect(result.success).toBe(true);
  });

  it("rejects a wildcard CORS origin in production", () => {
    const result = validateEnv({
      ...VALID_BASE,
      NODE_ENV: "production",
      SESSION_SECRET: "x".repeat(32),
      CORS_ORIGINS: "*",
    });
    expect(result.success).toBe(false);
  });

  it("does not fail on a missing GEMINI_API_KEY — AI degrades to unavailable instead", () => {
    const result = validateEnv({ ...VALID_BASE, AI_PROVIDER: "gemini", GEMINI_API_KEY: "" });
    expect(result.success).toBe(true);
  });

  it("never echoes raw process.env or secret values in its error list", () => {
    const result = validateEnv({ ...VALID_BASE, DATABASE_URL: undefined, SESSION_SECRET: "super-secret-value-should-not-leak-0000" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const joined = result.errors.join(" ");
      expect(joined).not.toContain("super-secret-value-should-not-leak");
    }
  });
});
