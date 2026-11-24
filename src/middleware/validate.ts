import type { z } from "zod";
import { ValidationError } from "../lib/errors.js";

/**
 * Parse `data` with a Zod schema, throwing a 400 VALIDATION_ERROR with the
 * field issues as `details` on failure. Use for bodies, query strings and params.
 */
export function validate<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(
      "Request validation failed",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}
