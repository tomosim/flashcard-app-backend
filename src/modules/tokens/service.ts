import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { apiTokens, users, type ApiTokenRow } from "../../db/schema.js";
import { apiTokenDisplayPrefix, generateApiToken, hashApiToken } from "../../lib/apiTokens.js";
import { NotFoundError, TokenLimitReachedError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import type { ApiTokenDto, CreatedApiTokenDto, CreateTokenInput } from "./schemas.js";

/** Most active (non-revoked) tokens a user can have. */
export const MAX_ACTIVE_TOKENS = 10;

/** last_used_at is written at most this often per token. Keep in sync with touchLastUsed. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

function toDto(row: ApiTokenRow): ApiTokenDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

const active = (userId: string) => and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt));

export async function createToken(
  userId: string,
  input: CreateTokenInput,
): Promise<CreatedApiTokenDto> {
  const token = generateApiToken();

  const row = await db.transaction(async (tx) => {
    // Lock the user's row so concurrent requests can't both pass the limit check.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if ((await tx.$count(apiTokens, active(userId))) >= MAX_ACTIVE_TOKENS) {
      throw new TokenLimitReachedError(MAX_ACTIVE_TOKENS);
    }
    const [inserted] = await tx
      .insert(apiTokens)
      .values({
        userId,
        name: input.name,
        tokenHash: hashApiToken(token),
        prefix: apiTokenDisplayPrefix(token),
      })
      .returning();
    return inserted!;
  });

  return { id: row.id, name: row.name, prefix: row.prefix, createdAt: toDto(row).createdAt, token };
}

/** The user's active tokens, newest first. */
export async function listTokens(userId: string): Promise<{ items: ApiTokenDto[] }> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(active(userId))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
  return { items: rows.map(toDto) };
}

/** Revokes one of the user's active tokens. Someone else's or an already revoked token is a 404. */
export async function revokeToken(userId: string, id: string): Promise<void> {
  const revoked = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), active(userId)))
    .returning({ id: apiTokens.id });
  if (revoked.length === 0) throw new NotFoundError("Token not found");
}

/**
 * Returns the user id for a valid, non-revoked token, or null. Records the use
 * in the background, at most once per minute per token.
 */
export async function authenticateApiToken(token: string): Promise<string | null> {
  const row = await db.query.apiTokens.findFirst({
    where: and(eq(apiTokens.tokenHash, hashApiToken(token)), isNull(apiTokens.revokedAt)),
  });
  if (!row) return null;

  const stale =
    !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS;
  if (stale) void touchLastUsed(row.id);
  return row.userId;
}

/** Not awaited by callers: a failed write must never fail the request. */
async function touchLastUsed(id: string) {
  try {
    await db
      .update(apiTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(apiTokens.id, id),
          // Re-checked in SQL so concurrent requests don't all write.
          or(
            isNull(apiTokens.lastUsedAt),
            lt(apiTokens.lastUsedAt, sql`now() - interval '60 seconds'`),
          ),
        ),
      );
  } catch (err) {
    logger.warn({ err, tokenId: id }, "Failed to update API token last_used_at");
  }
}
