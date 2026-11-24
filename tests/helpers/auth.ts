import type { Express } from "express";
import request from "supertest";

let counter = 0;

/** Registers a fresh user and returns their token and id. */
export async function registerUser(app: Express, email = `user${++counter}@example.com`) {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ email, password: "password123" })
    .expect(201);
  return { token: res.body.token as string, userId: res.body.user.id as string, email };
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
