import { describe, expect, it, vi } from "vitest";
import { errorHandlerMiddleware } from "../../server/middleware/errorHandler";
import { InfrastructureError, ServiceBusyError } from "../../server/core/errors";

function send(err: unknown) {
  let status = 0;
  let body: { error?: { message?: string } } = {};
  const res = { req: { requestId: "r1", headers: {} }, setHeader: vi.fn(), status(s: number) { status = s; return this; }, json(b: typeof body) { body = b; return this; } };
  errorHandlerMiddleware(err, { requestId: "r1" } as never, res as never, vi.fn());
  return { status, message: body.error?.message };
}

describe("error handler", () => {
  it("shows the user-safe message of a busy-AI error", () => {
    expect(send(new ServiceBusyError())).toEqual({ status: 503, message: "The AI service is busy right now. Please try again in a minute." });
  });
  it("still hides the message of other server errors", () => {
    expect(send(new InfrastructureError("db password is hunter2"))).toEqual({ status: 503, message: "An unexpected error occurred" });
  });
});
