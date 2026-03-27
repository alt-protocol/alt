import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { logger } from "./logger.js";

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ZodError) {
    void reply.status(400).send({
      error: "Validation Error",
      details: error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  if ("statusCode" in error && typeof error.statusCode === "number") {
    void reply.status(error.statusCode).send({
      error: error.message,
    });
    return;
  }

  logger.error({ err: error }, "Unhandled error");
  void reply.status(500).send({ error: "Internal server error" });
}
