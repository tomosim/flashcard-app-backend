import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email());

export const RegisterSchema = z.object({
  email,
  // Upper bound stops very long inputs from making argon2 hashing expensive.
  password: z.string().min(8, "Password must be at least 8 characters").max(256),
  displayName: z.string().trim().min(1).max(100).optional(),
});

export const LoginSchema = z.object({
  email,
  // Wrong-length passwords get the same 401 as any other wrong password.
  password: z.string().min(1).max(256),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

export type PublicUser = { id: string; email: string; displayName: string | null };
export type AuthResult = { token: string; user: PublicUser };
