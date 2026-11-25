import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { apiTokens } from "../src/db/schema.js";
import { bearer, registerUser } from "./helpers/auth.js";
import { truncateAll } from "./helpers/db.js";

let app: Express;
let jwt: { Authorization: string };

beforeEach(async () => {
  await truncateAll();
  app = createApp();
  jwt = bearer((await registerUser(app)).token);
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function createToken(headers = jwt, name = "iPhone Shortcut") {
  const res = await request(app).post("/api/v1/tokens").set(headers).send({ name }).expect(201);
  return res.body as { id: string; name: string; prefix: string; createdAt: string; token: string };
}

describe("POST /tokens", () => {
  it("returns the raw token once and stores only its hash", async () => {
    const res = await request(app)
      .post("/api/v1/tokens")
      .set(jwt)
      .send({ name: "  iPhone Shortcut " });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "iPhone Shortcut",
      prefix: res.body.token.slice(0, 12),
      createdAt: expect.any(String),
      token: expect.stringMatching(/^vocab_[A-Za-z0-9_-]{43}$/),
    });

    const row = await db.query.apiTokens.findFirst({ where: eq(apiTokens.id, res.body.id) });
    expect(row!.tokenHash).toBe(sha256(res.body.token));
    expect(row!.prefix).toBe(res.body.token.slice(0, 12));
    expect(Object.values(row!)).not.toContain(res.body.token);

    // The list never shows the token or its hash.
    const list = await request(app).get("/api/v1/tokens").set(jwt).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(res.body.token);
    expect(JSON.stringify(list.body)).not.toContain(row!.tokenHash);
  });

  it("validates the name", async () => {
    for (const name of [undefined, "", "   ", "x".repeat(51), 42]) {
      const res = await request(app).post("/api/v1/tokens").set(jwt).send({ name });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("allows 10 active tokens and returns 409 TOKEN_LIMIT_REACHED for the 11th", async () => {
    const tokens = [];
    for (let i = 0; i < 10; i++) tokens.push(await createToken(jwt, `token ${i}`));

    const res = await request(app).post("/api/v1/tokens").set(jwt).send({ name: "one too many" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TOKEN_LIMIT_REACHED");

    // Revoked tokens don't count towards the limit.
    await request(app).delete(`/api/v1/tokens/${tokens[0]!.id}`).set(jwt).expect(204);
    await createToken(jwt, "replacement");
  });

  it("enforces the limit under concurrent requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        request(app)
          .post("/api/v1/tokens")
          .set(jwt)
          .send({ name: `t${i}` }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
  });
});

describe("GET /tokens", () => {
  it("lists active tokens newest first, without the token or hash", async () => {
    const first = await createToken(jwt, "first");
    const second = await createToken(jwt, "second");
    const revoked = await createToken(jwt, "revoked");
    await request(app).delete(`/api/v1/tokens/${revoked.id}`).set(jwt).expect(204);

    const res = await request(app).get("/api/v1/tokens").set(jwt);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          id: second.id,
          name: "second",
          prefix: second.prefix,
          createdAt: second.createdAt,
          lastUsedAt: null,
        },
        {
          id: first.id,
          name: "first",
          prefix: first.prefix,
          createdAt: first.createdAt,
          lastUsedAt: null,
        },
      ],
    });
  });
});

describe("DELETE /tokens/:id", () => {
  it("revokes the token, which then gets 401", async () => {
    const { id, token } = await createToken();
    await request(app).get("/api/v1/words").set(bearer(token)).expect(200);

    await request(app).delete(`/api/v1/tokens/${id}`).set(jwt).expect(204);
    const row = await db.query.apiTokens.findFirst({ where: eq(apiTokens.id, id) });
    expect(row!.revokedAt).toBeInstanceOf(Date);

    const res = await request(app).get("/api/v1/words").set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({
      code: "UNAUTHORIZED",
      message: "Missing or invalid access token",
    });
  });

  it("returns 404 for an already revoked token, an unknown id, and 400 for a malformed id", async () => {
    const { id } = await createToken();
    await request(app).delete(`/api/v1/tokens/${id}`).set(jwt).expect(204);
    const again = await request(app).delete(`/api/v1/tokens/${id}`).set(jwt);
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe("NOT_FOUND");
    await request(app)
      .delete("/api/v1/tokens/00000000-0000-4000-8000-000000000000")
      .set(jwt)
      .expect(404);
    await request(app).delete("/api/v1/tokens/not-a-uuid").set(jwt).expect(400);
  });
});

describe("ownership", () => {
  it("user A can't list or revoke user B's tokens", async () => {
    const userB = bearer((await registerUser(app)).token);
    const tokenB = await createToken(userB, "B's token");

    const listA = await request(app).get("/api/v1/tokens").set(jwt).expect(200);
    expect(listA.body).toEqual({ items: [] });

    const res = await request(app).delete(`/api/v1/tokens/${tokenB.id}`).set(jwt);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");

    // B's token still works and is still listed for B.
    await request(app).get("/api/v1/words").set(bearer(tokenB.token)).expect(200);
    const listB = await request(app).get("/api/v1/tokens").set(userB).expect(200);
    expect(listB.body.items).toHaveLength(1);
  });

  it("an API token only sees its own user's words", async () => {
    const userB = bearer((await registerUser(app)).token);
    await request(app)
      .post("/api/v1/words")
      .set(userB)
      .send({ word: "Haus", language: "de" })
      .expect(201);
    const { token } = await createToken();
    const res = await request(app).get("/api/v1/words").set(bearer(token)).expect(200);
    expect(res.body.total).toBe(0);
  });
});

describe("authenticating with an API token", () => {
  it("can add words and get a study batch", async () => {
    const auth = bearer((await createToken()).token);

    const created = await request(app)
      .post("/api/v1/words")
      .set(auth)
      .send({ word: "Tisch", language: "de", tags: ["shortcut"] });
    expect(created.status).toBe(201);
    expect(created.body.items[0]).toMatchObject({ word: "Tisch", tags: ["shortcut"] });

    const batch = await request(app).get("/api/v1/study/batch?language=de").set(auth);
    expect(batch.status).toBe(200);
    expect(batch.body.items.map((w: { word: string }) => w.word)).toEqual(["Tisch"]);

    // Visible to the same user's JWT session.
    const list = await request(app).get("/api/v1/words").set(jwt).expect(200);
    expect(list.body.total).toBe(1);
  });

  it("rejects a made-up vocab_ token with the same generic 401", async () => {
    for (const token of ["vocab_made-up", `vocab_${"A".repeat(43)}`, "vocab_"]) {
      const res = await request(app).get("/api/v1/words").set(bearer(token));
      expect(res.status, token).toBe(401);
      expect(res.body.error).toEqual({
        code: "UNAUTHORIZED",
        message: "Missing or invalid access token",
      });
    }
    // Same message as an invalid JWT.
    const badJwt = await request(app).get("/api/v1/words").set(bearer("not.a.jwt"));
    expect(badJwt.body.error.message).toBe("Missing or invalid access token");
  });

  it("is rejected by the /tokens endpoints with 403 FORBIDDEN", async () => {
    const { id, token } = await createToken();
    const auth = bearer(token);

    for (const req of [
      request(app).get("/api/v1/tokens").set(auth),
      request(app).post("/api/v1/tokens").set(auth).send({ name: "minted by a token" }),
      request(app).delete(`/api/v1/tokens/${id}`).set(auth),
    ]) {
      const res = await req;
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }

    // Nothing was created or revoked.
    const list = await request(app).get("/api/v1/tokens").set(jwt).expect(200);
    expect(list.body.items.map((t: { id: string }) => t.id)).toEqual([id]);
  });

  it("still gets 401 on /tokens for an invalid token", async () => {
    await request(app).get("/api/v1/tokens").set(bearer("vocab_nope")).expect(401);
    await request(app).get("/api/v1/tokens").expect(401);
  });
});

describe("last_used_at", () => {
  const lastUsed = async (id: string) =>
    (await db.query.apiTokens.findFirst({ where: eq(apiTokens.id, id) }))!.lastUsedAt;

  it("is set after the token is used", async () => {
    const { id, token } = await createToken();
    expect(await lastUsed(id)).toBeNull();

    await request(app).get("/api/v1/words").set(bearer(token)).expect(200);
    // The write isn't awaited in the request path, so wait for it.
    await vi.waitFor(async () => expect(await lastUsed(id)).toBeInstanceOf(Date));

    const list = await request(app).get("/api/v1/tokens").set(jwt).expect(200);
    expect(list.body.items[0].lastUsedAt).toBe((await lastUsed(id))!.toISOString());
  });

  it("is written at most once a minute", async () => {
    const { id, token } = await createToken();
    const recent = new Date(Date.now() - 30_000);
    await db.update(apiTokens).set({ lastUsedAt: recent }).where(eq(apiTokens.id, id));

    await request(app).get("/api/v1/words").set(bearer(token)).expect(200);
    await new Promise((r) => setTimeout(r, 100));
    expect((await lastUsed(id))!.getTime()).toBe(recent.getTime());

    // More than a minute old: updated again.
    await db
      .update(apiTokens)
      .set({ lastUsedAt: sql`now() - interval '2 minutes'` })
      .where(eq(apiTokens.id, id));
    const before = (await lastUsed(id))!.getTime();
    await request(app).get("/api/v1/words").set(bearer(token)).expect(200);
    await vi.waitFor(async () => expect((await lastUsed(id))!.getTime()).toBeGreaterThan(before));
  });
});

it("deletes a user's tokens when the user is deleted", async () => {
  await createToken();
  const { users } = await import("../src/db/schema.js");
  await db.delete(users);
  expect(await db.$count(apiTokens)).toBe(0);
});
