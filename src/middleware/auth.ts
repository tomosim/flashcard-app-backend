import type { Request, RequestHandler } from "express";
import { UnauthorizedError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/jwt.js";

/** Verifies `Authorization: Bearer <token>` and sets `req.user = { id }`. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.get("authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  const userId = match?.[1] ? verifyAccessToken(match[1]) : null;
  if (!userId) {
    throw new UnauthorizedError("Missing or invalid access token");
  }
  req.user = { id: userId };
  next();
};

/** The authenticated user's id. Only call in handlers behind requireAuth. */
export function userIdOf(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}
