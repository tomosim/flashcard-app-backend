import { rateLimit } from "express-rate-limit";
import { RateLimitedError } from "../lib/errors.js";

/** 10 requests per minute per IP. Create one per app so tests get a fresh store. */
export function createAuthRateLimiter() {
  return rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new RateLimitedError()),
  });
}
