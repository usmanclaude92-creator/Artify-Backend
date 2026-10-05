import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import cors from "cors";
import { errorHandlerMiddleware } from "../../server/middleware/errorHandler";
import { corsOptions } from "../../server/middleware/security";

function app() {
  const a = express();
  a.use(cors(corsOptions));
  a.use(express.json({ limit: "1kb" }));
  a.post("/x", (_req, res) => res.json({ ok: true }));
  a.use(errorHandlerMiddleware);
  return a;
}

describe("errorHandler status mapping", () => {
  it("returns 400 for malformed JSON", async () => {
    const res = await request(app()).post("/x").set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at /);
  });

  it("returns 413 for oversized bodies", async () => {
    const res = await request(app()).post("/x").set("Content-Type", "application/json").send({ a: "x".repeat(5000) });
    expect(res.status).toBe(413);
  });

  it("returns 403 for a disallowed CORS origin", async () => {
    const res = await request(app()).post("/x").set("Origin", "https://evil.example").send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});
