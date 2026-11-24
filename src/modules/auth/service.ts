import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { users, type UserRow } from "../../db/schema.js";
import { EmailTakenError, UnauthorizedError } from "../../lib/errors.js";
import { signAccessToken } from "../../lib/jwt.js";
import type { AuthResult, LoginInput, PublicUser, RegisterInput } from "./schemas.js";

const INVALID_CREDENTIALS = "Invalid email or password";
const PG_UNIQUE_VIOLATION = "23505";

// Verified against when the email is unknown, so both failure paths take similar time.
const dummyHash = argon2.hash("not-a-real-password", { type: argon2.argon2id });

function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, displayName: row.displayName };
}

function authResult(row: UserRow): AuthResult {
  return { token: signAccessToken(row.id), user: toPublicUser(row) };
}

function isUniqueViolation(err: unknown): boolean {
  const cause = err instanceof Error && "cause" in err ? err.cause : err;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === PG_UNIQUE_VIOLATION
  );
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  if (existing) throw new EmailTakenError();

  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  try {
    const [row] = await db
      .insert(users)
      .values({ email: input.email, passwordHash, displayName: input.displayName ?? null })
      .returning();
    return authResult(row!);
  } catch (err) {
    // Two registrations for the same email racing each other.
    if (isUniqueViolation(err)) throw new EmailTakenError();
    throw err;
  }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const row = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  const ok = await argon2.verify(row?.passwordHash ?? (await dummyHash), input.password);
  if (!row || !ok) throw new UnauthorizedError(INVALID_CREDENTIALS);
  return authResult(row);
}

export async function getMe(userId: string): Promise<PublicUser> {
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  // The token is valid but the user no longer exists.
  if (!row) throw new UnauthorizedError("Missing or invalid access token");
  return toPublicUser(row);
}
