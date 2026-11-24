import type { Express } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { db } from "../src/db/client.js";
import { bearer } from "./helpers/auth.js";
import { truncateAll } from "./helpers/db.js";

let app: Express;

beforeEach(async () => {
  await truncateAll();
  // A fresh app per test also gives a fresh rate-limit store.
  app = createApp();
});

const register = (body: object) => request(app).post("/api/v1/auth/register").send(body);
const login = (body: object) => request(app).post("/api/v1/auth/login").send(body);

describe("POST /auth/register", () => {
  it("creates a user and returns a token and the user", async () => {
    const res = await register({
      email: "  Tom@Example.com ",
      password: "min-8-chars",
      displayName: "Tom",
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      email: "tom@example.com",
      displayName: "Tom",
    });
    const payload = jwt.verify(res.body.token, config.jwtSecret) as jwt.JwtPayload;
    expect(payload.sub).toBe(res.body.user.id);
    // Expires in 7 days.
    expect(payload.exp! - payload.iat!).toBe(7 * 24 * 60 * 60);
  });

  it("stores an argon2id hash, never the password", async () => {
    await register({ email: "tom@example.com", password: "min-8-chars" });
    const user = await db.query.users.findFirst();
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user!.displayName).toBeNull();
  });

  it("returns 409 EMAIL_TAKEN for an existing email, case-insensitively", async () => {
    await register({ email: "tom@example.com", password: "min-8-chars" }).expect(201);
    const res = await register({ email: "TOM@example.com", password: "another-pass" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("returns 400 VALIDATION_ERROR with field details for bad input", async () => {
    const res = await register({ email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["email", "password"]));
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await register({ email: "tom@example.com", password: "right-password" }).expect(201);
  });

  it("returns a token and the user for the right password", async () => {
    const res = await login({ email: "Tom@Example.com", password: "right-password" });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.email).toBe("tom@example.com");
  });

  it("returns the same 401 for a wrong password and an unknown email", async () => {
    const wrongPassword = await login({ email: "tom@example.com", password: "wrong-password" });
    const unknownEmail = await login({ email: "nobody@example.com", password: "right-password" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("GET /auth/me", () => {
  it("returns the current user with a valid token", async () => {
    const { body } = await register({ email: "tom@example.com", password: "min-8-chars" });
    const res = await request(app).get("/api/v1/auth/me").set(bearer(body.token));
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(body.user);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for an invalid, expired or wrongly signed token", async () => {
    const { body } = await register({ email: "tom@example.com", password: "min-8-chars" });
    const sub = body.user.id;
    const tokens = [
      "garbage",
      jwt.sign({ sub }, config.jwtSecret, { expiresIn: -10 }),
      jwt.sign({ sub }, "x".repeat(40)),
      jwt.sign({ sub }, config.jwtSecret, { algorithm: "HS512" }),
      jwt.sign({ sub: "not-a-uuid" }, config.jwtSecret),
    ];
    for (const token of tokens) {
      const res = await request(app).get("/api/v1/auth/me").set(bearer(token));
      expect(res.status, token).toBe(401);
    }
  });

  it("returns 401 if the user no longer exists", async () => {
    const { body } = await register({ email: "tom@example.com", password: "min-8-chars" });
    await truncateAll();
    const res = await request(app).get("/api/v1/auth/me").set(bearer(body.token));
    expect(res.status).toBe(401);
  });
});

describe("rate limiting", () => {
  it("returns 429 RATE_LIMITED after 10 auth requests per minute", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await login({ email: "nobody@example.com", password: "whatever1" });
      expect(res.status).toBe(401);
    }
    const res = await login({ email: "nobody@example.com", password: "whatever1" });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });

  it("does not rate-limit non-auth routes", async () => {
    for (let i = 0; i < 12; i++) {
      await request(app).get("/api/v1/health").expect(200);
    }
  });
});
