import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 15000,
    hookTimeout: 15000,
    // Integration/security tests share one real Postgres instance
    // (DATABASE_URL from .env) — run serially to avoid cross-test
    // interference on shared tables.
    fileParallelism: false,
  },
});
