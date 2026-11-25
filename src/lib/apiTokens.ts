import { createHash, randomBytes } from "node:crypto";

/** Every personal API token starts with this, which is how requireAuth tells it from a JWT. */
export const API_TOKEN_PREFIX = "vocab_";

/** Characters of the token kept in the database for display. */
const DISPLAY_PREFIX_LENGTH = 12;

/** A new random token: `vocab_` + 32 random bytes, base64url-encoded. */
export function generateApiToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/**
 * SHA-256 hex of the token. A fast hash is fine here: tokens are 256 bits of
 * randomness, so they can't be brute-forced the way passwords can.
 */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function apiTokenDisplayPrefix(token: string): string {
  return token.slice(0, DISPLAY_PREFIX_LENGTH);
}

export function looksLikeApiToken(value: string): boolean {
  return value.startsWith(API_TOKEN_PREFIX);
}
