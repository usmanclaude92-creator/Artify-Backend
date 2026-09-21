/**
 * Vercel serverless entry point. server.ts's single-process topology
 * (Express app + static frontend serving + .listen()) targets
 * Railway/Docker; Vercel instead serves the Vite build output as static
 * files and needs the API surface as a function it can invoke per
 * request. This re-uses the exact same `createApp()`/`finalizeApp()`
 * assembly server.ts uses — no route/middleware duplication — just
 * without the static-serving and .listen() parts, which Vercel's static
 * hosting and routing already handle (see ../vercel.json).
 *
 * TEMPORARY: module construction is wrapped in try/catch so a cold-start
 * failure (e.g. env validation, Prisma client init) surfaces as a JSON
 * body instead of an opaque platform 500 — this deployment's log access
 * is unavailable, so this is the only way to see what's actually failing.
 * Revert to the plain `const app = createApp(); finalizeApp(app); export
 * default app;` form once the underlying issue is found and fixed.
 */
import express, { type Express } from "express";

async function build(): Promise<Express> {
  try {
    const { createApp, finalizeApp } = await import("../server/app/app");
    const app = createApp();
    finalizeApp(app);
    return app;
  } catch (err: unknown) {
    const debugApp = express();
    debugApp.use((_req, res) => {
      const e = err as { message?: string; stack?: string; name?: string } | undefined;
      res.status(500).json({
        debug: true,
        name: e?.name,
        message: e?.message ?? String(err),
        stack: e?.stack,
      });
    });
    return debugApp;
  }
}

export default await build();
