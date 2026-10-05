import { describe, expect, it } from "vitest";
import { tuneDatabaseUrl } from "../../server/db/databaseUrl";

describe("tuneDatabaseUrl", () => {
  const pooled = "postgresql://u:p@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres";
  it("fills missing pooler params for serverless", () => {
    const u = new URL(tuneDatabaseUrl(pooled, { serverless: true }));
    expect(u.searchParams.get("pgbouncer")).toBe("true");
    expect(u.searchParams.get("connection_limit")).toBe("3");
    expect(u.searchParams.get("pool_timeout")).toBe("20");
  });
  it("never overrides explicit values", () => {
    const u = new URL(tuneDatabaseUrl(`${pooled}?connection_limit=5&pgbouncer=true`, { serverless: true }));
    expect(u.searchParams.get("connection_limit")).toBe("5");
  });
  it("leaves direct connections untouched", () => {
    const direct = "postgresql://u:p@localhost:5432/db?schema=public";
    expect(tuneDatabaseUrl(direct, { serverless: true })).toBe(direct);
  });
});
