import type { Request, RequestHandler } from "express";
import { looksLikeApiToken } from "../lib/apiTokens.js";
import { ForbiddenError, UnauthorizedError } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { authenticateApiToken } from "../modules/tokens/service.js";

type AuthUser = NonNullable<Request["user"]>;

/** The same message for every failure, so callers can't tell why a token was rejected. */
const INVALID_TOKEN = "Missing or invalid access token";

/**
 * Resolves `Authorization: Bearer <token>` to a user. A value starting with
 * `vocab_` is a personal API token; anything else is verified as a JWT.
 */
async function authenticate(req: Request): Promise<AuthUser> {
  const header = req.get("authorization");
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new UnauthorizedError(INVALID_TOKEN);

  if (looksLikeApiToken(token)) {
    const userId = await authenticateApiToken(token);
    if (!userId) throw new UnauthorizedError(INVALID_TOKEN);
    return { id: userId, authType: "apiToken" };
  }

  const userId = verifyAccessToken(token);
  if (!userId) throw new UnauthorizedError(INVALID_TOKEN);
  return { id: userId, authType: "jwt" };
}

/** Accepts a JWT or a personal API token and sets `req.user`. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  req.user = await authenticate(req);
  next();
};

/**
 * Accepts only a JWT. A valid API token gets 403 FORBIDDEN rather than 401,
 * since the token itself is fine and the client shouldn't discard it.
 */
export const requireJwt: RequestHandler = async (req, _res, next) => {
  const user = await authenticate(req);
  if (user.authType !== "jwt") {
    throw new ForbiddenError("API tokens can't manage API tokens; log in with your password");
  }
  req.user = user;
  next();
};

/** The authenticated user's id. Only call in handlers behind requireAuth or requireJwt. */
export function userIdOf(req: Request): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}
