/**
 * Unit tests for src/shared/error-handler.ts — Fastify error handling.
 */
import { describe, it, expect, vi } from "vitest";
import { ZodError, ZodIssueCode } from "zod";
import { errorHandler, NotFoundError } from "../error-handler.js";

function createMockReply() {
  const reply: Record<string, unknown> = {};
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply as any;
}

const mockRequest = {} as any;

describe("error-handler", () => {
  describe("NotFoundError", () => {
    it("has statusCode 404", () => {
      const err = new NotFoundError("Item not found");
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe("Item not found");
      expect(err.name).toBe("NotFoundError");
    });

    it("uses default message", () => {
      const err = new NotFoundError();
      expect(err.message).toBe("Not found");
    });
  });

  describe("errorHandler", () => {
    it("maps ZodError to 400 with structured details", () => {
      const reply = createMockReply();
      const zodError = new ZodError([
        {
          code: ZodIssueCode.invalid_type,
          expected: "number",
          received: "string",
          path: ["opportunity_id"],
          message: "Expected number, received string",
        },
        {
          code: ZodIssueCode.too_small,
          minimum: 1,
          inclusive: true,
          type: "number",
          path: ["amount"],
          message: "Number must be greater than or equal to 1",
          exact: false,
        },
      ]);

      errorHandler(zodError, mockRequest, reply);

      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: "Validation Error",
        details: [
          { path: "opportunity_id", message: "Expected number, received string" },
          {
            path: "amount",
            message: "Number must be greater than or equal to 1",
          },
        ],
      });
    });

    it("maps NotFoundError to 404", () => {
      const reply = createMockReply();
      const err = new NotFoundError("Opportunity not found");

      errorHandler(err, mockRequest, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.send).toHaveBeenCalledWith({
        error: "Opportunity not found",
      });
    });

    it("maps error with statusCode property to that status", () => {
      const reply = createMockReply();
      const err = Object.assign(new Error("Rate limit exceeded"), {
        statusCode: 429,
      });

      errorHandler(err, mockRequest, reply);

      expect(reply.status).toHaveBeenCalledWith(429);
      expect(reply.send).toHaveBeenCalledWith({
        error: "Rate limit exceeded",
      });
    });

    it("maps unknown error to 500 without leaking details", () => {
      const reply = createMockReply();
      const err = new Error("secret database connection string exposed");

      errorHandler(err, mockRequest, reply);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith({
        error: "Internal server error",
      });
    });
  });
});
