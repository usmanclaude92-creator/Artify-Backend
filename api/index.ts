/**
 * Vercel serverless entry point. server.ts's single-process topology
 * (Express app + static frontend serving + .listen()) targets
 * Railway/Docker; Vercel instead serves the Vite build output as static
 * files and needs the API surface as a function it can invoke per
 * request. This re-uses the exact same `createApp()`/`finalizeApp()`
 * assembly server.ts uses — no route/middleware duplication — just
 * without the static-serving and .listen() parts, which Vercel's static
 * hosting and routing already handle (see ../vercel.json).
 */
import { createApp, finalizeApp } from "../server/app/app";

const app = createApp();
finalizeApp(app);

export default app;
