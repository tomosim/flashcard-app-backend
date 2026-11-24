import jwt, { type SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";

const PayloadSchema = z.object({ sub: z.uuid() });

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    algorithm: "HS256",
    expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"],
  });
}

/** Returns the user id, or null if the token is invalid, expired or malformed. */
export function verifyAccessToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
    const parsed = PayloadSchema.safeParse(decoded);
    return parsed.success ? parsed.data.sub : null;
  } catch {
    return null;
  }
}
