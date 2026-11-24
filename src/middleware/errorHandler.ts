import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, NotFoundError, ValidationError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError("Route not found"));
};

function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return typeof err === "object" && err !== null && "type" in err && "status" in err;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (isBodyParserError(err) && err.type === "entity.parse.failed") {
    appError = new ValidationError("Malformed JSON body");
  } else if (isBodyParserError(err) && err.type === "entity.too.large") {
    appError = new ValidationError("Request body too large");
  } else {
    (req.log ?? logger).error({ err }, "Unhandled error");
    appError = new AppError(500, "INTERNAL", "Internal server error");
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined && { details: appError.details }),
    },
  });
};
