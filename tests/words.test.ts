import type { Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { bearer, registerUser } from "./helpers/auth.js";
import { truncateAll } from "./helpers/db.js";

let app: Express;
let auth: { Authorization: string };

beforeEach(async () => {
  await truncateAll();
  app = createApp(); // mock enricher (ENRICHER=mock in tests)
  auth = bearer((await registerUser(app)).token);
});

const addWord = (body: object, headers = auth) =>
  request(app).post("/api/v1/words").set(headers).send(body);

describe("POST /words", () => {
  it("creates an enriched word and returns 201 with the full word", async () => {
    const res = await addWord({
      word: "  Tisch ",
      language: "de",
      sourceUrl: "https://example.com/article",
      tags: ["news", "news", " home "],
      notes: "",
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      word: "Tisch",
      sourceForm: null,
      language: "de",
      targetLanguage: "en",
      partOfSpeech: "other",
      gender: null,
      article: null,
      plural: null,
      senses: [
        {
          translation: "[mock] Tisch",
          examples: [expect.objectContaining({ text: expect.any(String) })],
        },
      ],
      notes: null,
      tags: ["news", "home"],
      sourceUrl: "https://example.com/article",
      enrichmentStatus: "ok",
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(res.body).not.toHaveProperty("userId");
    expect(res.body).not.toHaveProperty("duplicate");
  });

  it("saves the lemma for inflected input, keeping what was typed as sourceForm", async () => {
    const res = await addWord({ word: "stand", language: "de" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ word: "stehen", sourceForm: "stand", partOfSpeech: "verb" });
  });

  it("returns 200 with duplicate: true when the user already has the lemma", async () => {
    const first = await addWord({ word: "stehen", language: "de" });
    const second = await addWord({ word: "stand", language: "de" });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, word: "stehen", duplicate: true });
    expect(await db.$count((await import("../src/db/schema.js")).words)).toBe(1);
  });

  it("treats the same word in another language as a new word", async () => {
    await addWord({ word: "Hand", language: "de" }).expect(201);
    await addWord({ word: "Hand", language: "nl" }).expect(201);
  });

  it("returns 422 NOT_A_WORD for an invalid word and saves nothing", async () => {
    const res = await addWord({ word: "xxinvalid", language: "de" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("NOT_A_WORD");
    const { words, enrichmentCache } = await import("../src/db/schema.js");
    expect(await db.$count(words)).toBe(0);
    expect(await db.$count(enrichmentCache)).toBe(0);
  });

  it("returns 422 UNSUPPORTED_LANGUAGE for a language outside the allow-list", async () => {
    const res = await addWord({ word: "hello", language: "en" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("UNSUPPORTED_LANGUAGE");
  });

  it("returns 400 VALIDATION_ERROR for bad input", async () => {
    for (const body of [
      {},
      { word: "   ", language: "de" },
      { word: "x".repeat(81), language: "de" },
      { word: "Haus", language: "german" },
      { word: "Haus", language: "de", sourceUrl: "not a url" },
    ]) {
      const res = await addWord(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/v1/words").send({ word: "Haus", language: "de" });
    expect(res.status).toBe(401);
  });
});

describe("GET /words", () => {
  beforeEach(async () => {
    for (const word of ["Apfel", "Birne", "Kirsche", "Banane", "Zitrone"]) {
      await addWord({ word, language: "de", tags: word === "Banane" ? ["yellow"] : [] });
    }
    await addWord({ word: "pomme", language: "fr", tags: ["fruit"] });
  });

  it("lists newest first with pagination metadata", async () => {
    const res = await request(app).get("/api/v1/words?pageSize=2&page=1").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 2, total: 6 });
    expect(res.body.items.map((w: { word: string }) => w.word)).toEqual(["pomme", "Zitrone"]);

    const page3 = await request(app).get("/api/v1/words?pageSize=2&page=3").set(auth);
    expect(page3.body.items.map((w: { word: string }) => w.word)).toEqual(["Birne", "Apfel"]);

    const beyond = await request(app).get("/api/v1/words?pageSize=2&page=4").set(auth);
    expect(beyond.body).toMatchObject({ items: [], total: 6 });
  });

  it("defaults to page 1 and pageSize 20, and caps pageSize at 100", async () => {
    const res = await request(app).get("/api/v1/words").set(auth);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 6 });
    const tooBig = await request(app).get("/api/v1/words?pageSize=101").set(auth);
    expect(tooBig.status).toBe(400);
  });

  it("sorts by word, case-insensitively", async () => {
    const res = await request(app).get("/api/v1/words?sort=word&language=de").set(auth);
    expect(res.body.items.map((w: { word: string }) => w.word)).toEqual([
      "Apfel",
      "Banane",
      "Birne",
      "Kirsche",
      "Zitrone",
    ]);
  });

  it("filters by language and tag", async () => {
    const fr = await request(app).get("/api/v1/words?language=fr").set(auth);
    expect(fr.body.items.map((w: { word: string }) => w.word)).toEqual(["pomme"]);
    const tagged = await request(app).get("/api/v1/words?tag=yellow").set(auth);
    expect(tagged.body.items.map((w: { word: string }) => w.word)).toEqual(["Banane"]);
  });

  it("searches the word and translations case-insensitively", async () => {
    const byWord = await request(app).get("/api/v1/words?search=KIRSCH").set(auth);
    expect(byWord.body.items.map((w: { word: string }) => w.word)).toEqual(["Kirsche"]);

    // Mock translations are "[mock] {word}", so "mock] p" only matches a translation.
    const byTranslation = await request(app)
      .get(`/api/v1/words?search=${encodeURIComponent("mock] p")}`)
      .set(auth);
    expect(byTranslation.body.items.map((w: { word: string }) => w.word)).toEqual(["pomme"]);
  });

  it("treats % and _ in search as literal characters", async () => {
    const res = await request(app).get("/api/v1/words?search=%25").set(auth);
    expect(res.body.total).toBe(0);
  });

  it("only lists the caller's words", async () => {
    const other = bearer((await registerUser(app)).token);
    const res = await request(app).get("/api/v1/words").set(other);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });
});

describe("GET, PATCH and DELETE /words/:id", () => {
  let id: string;

  beforeEach(async () => {
    id = (await addWord({ word: "Haus", language: "de" })).body.id;
  });

  it("gets one word", async () => {
    const res = await request(app).get(`/api/v1/words/${id}`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, word: "Haus" });
  });

  it("returns 404 for an unknown id and 400 for a malformed one", async () => {
    const missing = await request(app)
      .get("/api/v1/words/00000000-0000-4000-8000-000000000000")
      .set(auth);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    const malformed = await request(app).get("/api/v1/words/not-a-uuid").set(auth);
    expect(malformed.status).toBe(400);
  });

  it("replaces the whole senses array on PATCH", async () => {
    const senses = [
      {
        translation: "house, home",
        note: "building",
        examples: [{ text: "Das Haus ist groß.", translation: "The house is big." }],
      },
      {
        translation: "household",
        examples: [{ text: "Das ganze Haus schläft.", translation: "The whole household sleeps." }],
      },
    ];
    const res = await request(app)
      .patch(`/api/v1/words/${id}`)
      .set(auth)
      .send({ senses, partOfSpeech: "noun", gender: "neuter", article: "das", notes: "  mine " });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      senses,
      partOfSpeech: "noun",
      gender: "neuter",
      article: "das",
      notes: "mine",
    });
    expect(new Date(res.body.updatedAt) > new Date(res.body.createdAt)).toBe(true);

    const reread = await request(app).get(`/api/v1/words/${id}`).set(auth);
    expect(reread.body.senses).toEqual(senses);
  });

  it("validates PATCH bodies with the same schemas", async () => {
    for (const body of [
      {},
      { senses: [] },
      { senses: [{ translation: "x", examples: [] }] },
      { partOfSpeech: "pronoun" },
      { language: "fr" },
      { enrichmentStatus: "ok" },
    ]) {
      const res = await request(app).patch(`/api/v1/words/${id}`).set(auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("returns 409 DUPLICATE_WORD when renaming to a word the user already has", async () => {
    await addWord({ word: "Tisch", language: "de" });
    const res = await request(app).patch(`/api/v1/words/${id}`).set(auth).send({ word: "tisch" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_WORD");
  });

  it("deletes a word and returns 204", async () => {
    const res = await request(app).delete(`/api/v1/words/${id}`).set(auth);
    expect(res.status).toBe(204);
    await request(app).get(`/api/v1/words/${id}`).set(auth).expect(404);
    await request(app).delete(`/api/v1/words/${id}`).set(auth).expect(404);
  });

  it("does not let user B read, edit, re-enrich or delete user A's word (404)", async () => {
    const userB = bearer((await registerUser(app)).token);
    await request(app).get(`/api/v1/words/${id}`).set(userB).expect(404);
    await request(app).patch(`/api/v1/words/${id}`).set(userB).send({ notes: "x" }).expect(404);
    await request(app).post(`/api/v1/words/${id}/re-enrich`).set(userB).expect(404);
    await request(app).delete(`/api/v1/words/${id}`).set(userB).expect(404);
    await request(app).get(`/api/v1/words/${id}`).set(auth).expect(200);
  });
});

describe("DELETE /words", () => {
  it("deletes all of the caller's words and returns the count", async () => {
    await addWord({ word: "Tisch", language: "de" }).expect(201);
    await addWord({ word: "Stuhl", language: "de" }).expect(201);
    await addWord({ word: "chaise", language: "fr" }).expect(201);

    const res = await request(app).delete("/api/v1/words").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 3 });

    const list = await request(app).get("/api/v1/words").set(auth).expect(200);
    expect(list.body.total).toBe(0);
  });

  it("returns deleted: 0 when the user has no words", async () => {
    const res = await request(app).delete("/api/v1/words").set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 0 });
  });

  it("leaves other users' words alone", async () => {
    const userB = bearer((await registerUser(app)).token);
    await addWord({ word: "Tisch", language: "de" }).expect(201);
    await addWord({ word: "Stuhl", language: "de" }, userB).expect(201);

    await request(app).delete("/api/v1/words").set(auth).expect(200, { deleted: 1 });

    const list = await request(app).get("/api/v1/words").set(userB).expect(200);
    expect(list.body.total).toBe(1);
  });

  it("requires auth", async () => {
    await request(app).delete("/api/v1/words").expect(401);
  });
});
