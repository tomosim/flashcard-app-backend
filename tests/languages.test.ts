import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bearer, registerUser } from "./helpers/auth.js";
import { truncateAll } from "./helpers/db.js";

let app: Express;
let auth: { Authorization: string };

beforeEach(async () => {
  await truncateAll();
  app = createApp();
  auth = bearer((await registerUser(app)).token);
});

async function add(headers: { Authorization: string }, language: string, list: string[]) {
  for (const word of list) {
    await request(app).post("/api/v1/words").set(headers).send({ word, language }).expect(201);
  }
}

describe("GET /languages", () => {
  it("lists the user's languages with counts, most words first", async () => {
    await add(auth, "fr", ["pomme"]);
    await add(auth, "de", ["Apfel", "Birne", "Kirsche"]);
    await add(auth, "es", ["manzana", "pera"]);
    await add(auth, "it", ["mela"]);

    const res = await request(app).get("/api/v1/languages").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { language: "de", count: 3 },
        { language: "es", count: 2 },
        { language: "fr", count: 1 },
        { language: "it", count: 1 },
      ],
    });
  });

  it("only counts the caller's words", async () => {
    const other = bearer((await registerUser(app)).token);
    await add(other, "de", ["Apfel", "Birne"]);
    await add(auth, "de", ["Apfel"]);
    const res = await request(app).get("/api/v1/languages").set(auth);
    expect(res.body).toEqual({ items: [{ language: "de", count: 1 }] });
  });

  it("returns an empty list for a user with no words", async () => {
    const res = await request(app).get("/api/v1/languages").set(auth);
    expect(res.body).toEqual({ items: [] });
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/languages")).status).toBe(401);
  });
});
