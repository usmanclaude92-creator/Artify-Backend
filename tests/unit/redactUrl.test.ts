import { describe, expect, it } from "vitest";
import { redactUrl } from "../../server/middleware/requestLogger";

describe("redactUrl (secrets never reach the access log)", () => {
  it("hides invitation and preview tokens in the path", () => {
    expect(redactUrl("/api/v1/invitations/art_invite_abc123/accept")).toBe("/api/v1/invitations/[REDACTED]/accept");
    expect(redactUrl("/api/v1/public/landing-preview/SECRETTOKEN123")).toBe("/api/v1/public/landing-preview/[REDACTED]");
    expect(redactUrl("/lp-preview/SECRETTOKEN123")).toBe("/lp-preview/[REDACTED]");
  });
  it("hides credential-looking query values and keeps the rest", () => {
    const out = redactUrl("/api/v1/auth/verify-email?token=abc&page=2&hub.verify_token=zzz&code=1");
    expect(out).not.toMatch(/abc|zzz/);
    expect(out).toContain("page=2");
    expect(out).toContain("token=%5BREDACTED%5D");
  });
  it("leaves ordinary URLs alone", () => {
    expect(redactUrl("/api/v1/leads?page=1&search=acme")).toBe("/api/v1/leads?page=1&search=acme");
    expect(redactUrl("/api/v1/public/landing/spring-sale")).toBe("/api/v1/public/landing/spring-sale");
  });
});
