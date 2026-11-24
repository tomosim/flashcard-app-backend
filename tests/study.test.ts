import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { bearer, registerUser } from "./helpers/auth.js";
import { truncateAll } from "./helpers/db.js";
import { fakeEnricher } from "./helpers/enrichers.js";

let app: Express;
let auth: { Authorization: string };

const GERMAN = ["Apfel", "Birne", "Kirsche", "Banane", "Zitrone", "Pflaume", "Traube"];

async function addWords(headers: { Authorization: string }, list: string[], language: string) {
  for (const word of list) {
    await request(app).post("/api/v1/words").set(headers).send({ word, language }).expect(201);
  }
}

const batch = (query: string, headers = auth) =>
  request(app).get(`/api/v1/study/batch?${query}`).set(headers);

beforeEach(async () => {
  await truncateAll();
  app = createApp();
  auth = bearer((await registerUser(app)).token);
});

describe("GET /study/batch", () => {
  beforeEach(async () => {
    await addWords(auth, GERMAN, "de");
    await addWords(auth, ["pomme", "poire"], "fr");
  });

  it("returns at most `limit` words, all in the requested language", async () => {
    const res = await batch("language=de&limit=3");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    for (const word of res.body.items) {
      expect(word.language).toBe("de");
      expect(GERMAN).toContain(word.word);
    }
  });

  it("defaults to 10 and returns what exists when there are fewer", async () => {
    const res = await batch("language=de");
    expect(res.body.items).toHaveLength(GERMAN.length);
    expect(new Set(res.body.items.map((w: { id: string }) => w.id)).size).toBe(GERMAN.length);
  });

  it("returns words in random order", async () => {
    const orders = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const res = await batch("language=de");
      orders.add(res.body.items.map((w: { word: string }) => w.word).join(","));
    }
    // 7! orderings: ten identical results in a row would mean no shuffling.
    expect(orders.size).toBeGreaterThan(1);
  });

  it("only returns the caller's words", async () => {
    const other = bearer((await registerUser(app)).token);
    await addWords(other, ["Mango"], "de");
    const res = await batch("language=de&limit=50");
    expect(res.body.items.map((w: { word: string }) => w.word)).not.toContain("Mango");
    const theirs = await batch("language=de&limit=50", other);
    expect(theirs.body.items.map((w: { word: string }) => w.word)).toEqual(["Mango"]);
  });

  it("returns an empty array when the user has no words in that language", async () => {
    const res = await batch("language=es");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it("validates the query", async () => {
    expect((await batch("")).status).toBe(400); // language is required
    expect((await batch("language=de&limit=0")).status).toBe(400);
    expect((await batch("language=de&limit=51")).status).toBe(400);
    expect((await batch("language=de&limit=abc")).status).toBe(400);
    const unsupported = await batch("language=ja");
    expect(unsupported.status).toBe(422);
    expect(unsupported.body.error.code).toBe("UNSUPPORTED_LANGUAGE");
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/study/batch?language=de")).status).toBe(401);
  });
});

it("excludes words whose enrichment failed", async () => {
  const { enricher, impl } = fakeEnricher();
  impl.mockRejectedValue(new Error("down"));
  const failingApp = createApp({ enricher });
  const headers = bearer((await registerUser(failingApp)).token);
  await request(failingApp)
    .post("/api/v1/words")
    .set(headers)
    .send({ word: "Haus", language: "de" })
    .expect(201);

  const res = await request(failingApp).get("/api/v1/study/batch?language=de").set(headers);
  expect(res.body).toEqual({ items: [] });
});
