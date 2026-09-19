/**
 * Vitest global setup. Loads .env.test BEFORE any test file imports
 * server/config/env.ts, so config validation runs against the dedicated
 * `artify_test` database rather than dev data. dotenv does not overwrite
 * already-set process.env keys, so this must run first (vitest.config.ts
 * lists it in `setupFiles`, which load before test files).
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.test" });
