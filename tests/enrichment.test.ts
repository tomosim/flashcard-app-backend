import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { db } from "../src/db/client.js";
import { enrichmentCache, words } from "../src/db/schema.js";
import { runEnricher } from "../src/enrichment/run.js";
import { TransientEnrichmentError, type Enricher } from "../src/enrichment/types.js";
import { bearer, registerUser } from "./helpers/auth.js";
import { truncateAll } from "./helpers/db.js";
import {
  fakeEnricher,
  spyEnricher,
  validConjugation,
  validEnrichment,
  validEntry,
} from "./helpers/enrichers.js";

beforeEach(truncateAll);

async function setup(enricher: Enricher) {
  const app = createApp({ enricher });
  const auth = bearer((await registerUser(app)).token);
  const addWord = (word: string, language = "de") =>
    request(app).post("/api/v1/words").set(auth).send({ word, language });
  return { app, auth, addWord };
}

/** The first (often only) word a POST /words response returned. */
function first(res: request.Response) {
  return res.body.items[0];
}

describe("enrichment cache", () => {
  it("writes valid results to the cache, keyed by the lowercased input", async () => {
    const { addWord } = await setup(spyEnricher().enricher);
    await addWord("Häuser").expect(201);
    const row = await db.query.enrichmentCache.findFirst();
    expect(row).toMatchObject({ language: "de", targetLanguage: "en", lookup: "häuser" });
    expect(row!.model).toBe("mock");
    expect(row!.result.entries[0]!.lemma).toBe("Haus");
  });

  it("skips the enricher on a cache hit, including for other users", async () => {
    const { enricher, spy } = spyEnricher();
    const firstUser = await setup(enricher);
    await firstUser.addWord("Fenster").expect(201);
    expect(spy).toHaveBeenCalledTimes(1);

    // A different user, different casing: same cache entry.
    const second = await setup(enricher);
    const res = await second.addWord("FENSTER");
    expect(res.status).toBe(201);
    expect(first(res).word).toBe("Fenster");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not cache NOT_A_WORD results", async () => {
    const { enricher, spy } = spyEnricher();
    const { addWord } = await setup(enricher);
    await addWord("xxinvalid").expect(422);
    await addWord("xxinvalid").expect(422);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await db.$count(enrichmentCache)).toBe(0);
  });
});

describe("model-aware cache", () => {
  async function cacheRow() {
    return db.query.enrichmentCache.findFirst({ where: eq(enrichmentCache.lookup, "leistung") });
  }

  it("ignores mock entries when a real model is in use, and replaces them", async () => {
    // Cached by the mock enricher first.
    await (await setup(spyEnricher().enricher)).addWord("Leistung").expect(201);
    expect((await cacheRow())!.model).toBe("mock");

    const { enricher, impl } = fakeEnricher("claude-haiku-5-5");
    impl.mockResolvedValue(validEnrichment("Leistung", "performance, achievement"));
    const res = await (await setup(enricher)).addWord("Leistung");

    expect(impl).toHaveBeenCalledTimes(1); // cache miss: the mock entry was not served
    expect(first(res).senses[0].translation).toBe("performance, achievement");
    expect(await cacheRow()).toMatchObject({
      model: "claude-haiku-5-5",
      result: expect.objectContaining({
        entries: [expect.objectContaining({ lemma: "Leistung" })],
      }),
    });
  });

  it("serves a real model's entry to that model on later requests", async () => {
    const { enricher, impl } = fakeEnricher("claude-haiku-5-5");
    impl.mockResolvedValue(validEnrichment("Leistung", "performance"));
    await (await setup(enricher)).addWord("Leistung").expect(201);
    await (await setup(enricher)).addWord("leistung").expect(201);
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("never serves a real model's entry to the mock, and never overwrites it with mock data", async () => {
    const real = fakeEnricher("claude-haiku-5-5");
    real.impl.mockResolvedValue(validEnrichment("Leistung", "performance"));
    await (await setup(real.enricher)).addWord("Leistung").expect(201);

    const mock = spyEnricher();
    const { app, auth, addWord } = await setup(mock.enricher);
    const res = await addWord("Leistung");
    expect(mock.spy).toHaveBeenCalledTimes(1);
    expect(first(res).senses[0].translation).toBe("[mock] Leistung");

    // Re-enriching in mock mode doesn't overwrite it either.
    await request(app)
      .post(`/api/v1/words/${first(res).id}/re-enrich`)
      .set(auth)
      .expect(200);
    expect(await cacheRow()).toMatchObject({
      model: "claude-haiku-5-5",
      result: expect.objectContaining({
        entries: [
          expect.objectContaining({
            senses: [expect.objectContaining({ translation: "performance" })],
          }),
        ],
      }),
    });
  });
});

describe("enrichment failures", () => {
  it("saves a schema-invalid result as a failed word, without caching it", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockResolvedValue({ isValidWord: true, entries: [{ lemma: "Haus", senses: "nope" }] });
    const { addWord } = await setup(enricher);

    const res = await addWord("  Häuser ");
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    expect(first(res)).toMatchObject({
      word: "Häuser",
      sourceForm: null,
      partOfSpeech: "other",
      conjugation: null,
      senses: [],
      enrichmentStatus: "failed",
      duplicate: false,
    });
    expect(impl).toHaveBeenCalledTimes(1); // validation failures are not retried
    expect(await db.$count(enrichmentCache)).toBe(0);
  });

  it("saves a failed word when both attempts hit transient errors", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockRejectedValue(new TransientEnrichmentError("503"));
    const { addWord } = await setup(enricher);

    const res = await addWord("Haus");
    expect(res.status).toBe(201);
    expect(first(res).enrichmentStatus).toBe("failed");
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("succeeds when the retry after a transient error works", async () => {
    const { enricher, impl } = fakeEnricher();
    impl
      .mockRejectedValueOnce(new TransientEnrichmentError("network"))
      .mockResolvedValueOnce(validEnrichment("Haus", "house"));
    const { addWord } = await setup(enricher);

    const res = await addWord("Haus");
    expect(res.status).toBe(201);
    expect(first(res)).toMatchObject({
      enrichmentStatus: "ok",
      senses: [{ translation: "house" }],
    });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient errors", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockRejectedValue(new Error("400 bad request"));
    const { addWord } = await setup(enricher);

    const res = await addWord("Haus");
    expect(first(res).enrichmentStatus).toBe("failed");
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("detects a duplicate of a failed word by the trimmed input", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockRejectedValue(new Error("boom"));
    const { addWord } = await setup(enricher);
    const firstRes = await addWord("Haus");
    const second = await addWord(" haus ");
    expect(second.status).toBe(200);
    expect(second.body.items).toEqual([
      expect.objectContaining({ id: first(firstRes).id, duplicate: true }),
    ]);
  });
});

describe("runEnricher", () => {
  it("times out each attempt and retries once", async () => {
    const signals: AbortSignal[] = [];
    const enricher: Enricher = {
      model: "slow",
      enrich: vi.fn((_input, options) => {
        signals.push(options!.signal!);
        return new Promise(() => {});
      }),
    };
    const outcome = await runEnricher(
      enricher,
      { text: "Haus", language: "de", targetLanguage: "en" },
      { timeoutMs: 20 },
    );
    expect(outcome).toEqual({ status: "failed" });
    expect(enricher.enrich).toHaveBeenCalledTimes(2);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});

describe("POST /words/:id/re-enrich", () => {
  it("bypasses the cache, overwrites the word and the cache entry", async () => {
    const { enricher, impl } = fakeEnricher("fake-v1");
    impl.mockResolvedValue(validEnrichment("Haus", "house"));
    const { app, auth, addWord } = await setup(enricher);
    const created = first(await addWord("Häuser"));
    expect(created).toMatchObject({ word: "Haus", sourceForm: "Häuser" });

    impl.mockResolvedValue(validEnrichment("Haus", "house, building"));
    const res = await request(app).post(`/api/v1/words/${created.id}/re-enrich`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: created.id,
      word: "Haus",
      sourceForm: "Häuser",
      senses: [{ translation: "house, building" }],
      enrichmentStatus: "ok",
    });
    expect(impl).toHaveBeenCalledTimes(2);
    expect(impl).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Häuser" }));

    const cached = await db.query.enrichmentCache.findFirst({
      where: eq(enrichmentCache.lookup, "häuser"),
    });
    expect(cached!.result.entries[0]!.senses[0]!.translation).toBe("house, building");
  });

  it("repairs a failed word", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockRejectedValue(new Error("down"));
    const { app, auth, addWord } = await setup(enricher);
    const created = first(await addWord("stand"));
    expect(created.enrichmentStatus).toBe("failed");

    impl.mockReset();
    impl.mockResolvedValue(validEnrichment("stehen", "to stand", { partOfSpeech: "verb" }));
    const res = await request(app).post(`/api/v1/words/${created.id}/re-enrich`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      word: "stehen",
      sourceForm: "stand",
      enrichmentStatus: "ok",
    });
    expect(await db.$count(enrichmentCache)).toBe(1);
  });

  it("returns 502 ENRICHMENT_FAILED and leaves the word unchanged on failure", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockResolvedValue(validEnrichment("Haus", "house"));
    const { app, auth, addWord } = await setup(enricher);
    const created = first(await addWord("Haus"));

    impl.mockRejectedValue(new TransientEnrichmentError("down"));
    const res = await request(app).post(`/api/v1/words/${created.id}/re-enrich`).set(auth);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("ENRICHMENT_FAILED");

    const row = await db.query.words.findFirst({ where: eq(words.id, created.id) });
    expect(row!.senses[0]!.translation).toBe("house");
    expect(row!.enrichmentStatus).toBe("ok");
  });

  it("returns 409 DUPLICATE_WORD if the new lemma matches another of the user's words", async () => {
    const { enricher, impl } = fakeEnricher();
    const { app, auth, addWord } = await setup(enricher);
    impl.mockResolvedValue(validEnrichment("stehen"));
    await addWord("stehen").expect(201);
    impl.mockRejectedValue(new Error("down"));
    const failed = first(await addWord("stand"));

    impl.mockResolvedValue(validEnrichment("stehen"));
    const res = await request(app).post(`/api/v1/words/${failed.id}/re-enrich`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_WORD");
  });
});

describe("multiple parts of speech and conjugations", () => {
  const adjective = () =>
    validEntry("beeindruckt", "impressed", {
      partOfSpeech: "adjective",
      gender: null,
      article: null,
    });
  const verb = () =>
    validEntry("beeindrucken", "to impress", {
      partOfSpeech: "verb",
      gender: null,
      article: null,
      conjugation: validConjugation("beeindruck"),
    });

  it("saves one word per entry, each with its own lemma and sourceForm", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockResolvedValue({ isValidWord: true, entries: [adjective(), verb()] });
    const { addWord } = await setup(enricher);

    const res = await addWord("beeindruckt");
    expect(res.status).toBe(201);
    expect(res.body.items).toEqual([
      expect.objectContaining({
        word: "beeindruckt",
        sourceForm: null,
        partOfSpeech: "adjective",
        conjugation: null,
        duplicate: false,
      }),
      expect.objectContaining({
        word: "beeindrucken",
        sourceForm: "beeindruckt",
        partOfSpeech: "verb",
        conjugation: validConjugation("beeindruck"),
        duplicate: false,
      }),
    ]);
    expect(await db.$count(words)).toBe(2);
  });

  it("returns 200 with every entry marked duplicate when the user has them all", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockResolvedValue({ isValidWord: true, entries: [adjective(), verb()] });
    const { addWord } = await setup(enricher);
    const created = (await addWord("beeindruckt").expect(201)).body.items;

    const res = await addWord("Beeindruckt");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      expect.objectContaining({ id: created[0].id, duplicate: true }),
      expect.objectContaining({ id: created[1].id, duplicate: true }),
    ]);
  });

  it("returns 201 with mixed duplicate flags when only some entries are new", async () => {
    const { enricher, impl } = fakeEnricher();
    const { addWord } = await setup(enricher);
    impl.mockResolvedValue({ isValidWord: true, entries: [verb()] });
    const existing = first(await addWord("beeindrucken").expect(201));

    impl.mockResolvedValue({ isValidWord: true, entries: [adjective(), verb()] });
    const res = await addWord("beeindruckt");
    expect(res.status).toBe(201);
    expect(res.body.items).toEqual([
      expect.objectContaining({ word: "beeindruckt", duplicate: false }),
      expect.objectContaining({ id: existing.id, word: "beeindrucken", duplicate: true }),
    ]);
  });

  it("allows the same lemma with a different part of speech", async () => {
    const { enricher, impl } = fakeEnricher();
    const { addWord } = await setup(enricher);
    impl.mockResolvedValue(validEnrichment("laufen", "to run", { partOfSpeech: "verb" }));
    await addWord("laufen").expect(201);
    impl.mockResolvedValue(validEnrichment("Laufen", "running"));
    const res = await addWord("das Laufen");
    expect(res.status).toBe(201);
    expect(first(res)).toMatchObject({ word: "Laufen", partOfSpeech: "noun" });
  });

  it("drops a conjugation the enricher sent for a non-verb", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockResolvedValue(validEnrichment("Haus", "house", { conjugation: validConjugation() }));
    const { addWord } = await setup(enricher);
    expect(first(await addWord("Haus")).conjugation).toBeNull();
  });

  it("fails enrichment when a conjugation table does not have six persons", async () => {
    const { enricher, impl } = fakeEnricher();
    const bad = validConjugation();
    bad.present = bad.present.slice(0, 5);
    impl.mockResolvedValue(
      validEnrichment("gehen", "to go", { partOfSpeech: "verb", conjugation: bad }),
    );
    const { addWord } = await setup(enricher);
    expect(first(await addWord("gehen")).enrichmentStatus).toBe("failed");
  });

  it("re-enrich updates the word from the entry matching its part of speech", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockResolvedValue({ isValidWord: true, entries: [adjective(), verb()] });
    const { app, auth, addWord } = await setup(enricher);
    const verbWord = (await addWord("beeindruckt")).body.items[1];

    const updatedVerb = {
      ...verb(),
      senses: verb().senses.map((s) => ({ ...s, translation: "to wow" })),
    };
    impl.mockResolvedValue({ isValidWord: true, entries: [adjective(), updatedVerb] });
    const res = await request(app).post(`/api/v1/words/${verbWord.id}/re-enrich`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: verbWord.id,
      word: "beeindrucken",
      partOfSpeech: "verb",
      senses: [{ translation: "to wow" }],
    });
    expect(await db.$count(words)).toBe(2);
  });

  it("the mock enricher returns two entries for beeindruckt, with a verb conjugation", async () => {
    const { addWord } = await setup(spyEnricher().enricher);
    const res = await addWord("beeindruckt").expect(201);
    expect(res.body.items.map((w: { partOfSpeech: string }) => w.partOfSpeech)).toEqual([
      "adjective",
      "verb",
    ]);
    expect(res.body.items[1].conjugation.present).toHaveLength(6);
  });
});
