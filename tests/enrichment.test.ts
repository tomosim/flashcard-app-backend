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
import { fakeEnricher, spyEnricher, validEnrichment } from "./helpers/enrichers.js";

beforeEach(truncateAll);

async function setup(enricher: Enricher) {
  const app = createApp({ enricher });
  const auth = bearer((await registerUser(app)).token);
  const addWord = (word: string, language = "de") =>
    request(app).post("/api/v1/words").set(auth).send({ word, language });
  return { app, auth, addWord };
}

describe("enrichment cache", () => {
  it("writes valid results to the cache, keyed by the lowercased input", async () => {
    const { addWord } = await setup(spyEnricher().enricher);
    await addWord("Häuser").expect(201);
    const row = await db.query.enrichmentCache.findFirst();
    expect(row).toMatchObject({ language: "de", targetLanguage: "en", lookup: "häuser" });
    expect(row!.model).toBe("mock");
    expect(row!.result.lemma).toBe("Haus");
  });

  it("skips the enricher on a cache hit, including for other users", async () => {
    const { enricher, spy } = spyEnricher();
    const first = await setup(enricher);
    await first.addWord("Fenster").expect(201);
    expect(spy).toHaveBeenCalledTimes(1);

    // A different user, different casing: same cache entry.
    const second = await setup(enricher);
    const res = await second.addWord("FENSTER");
    expect(res.status).toBe(201);
    expect(res.body.word).toBe("Fenster");
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

describe("enrichment failures", () => {
  it("saves a schema-invalid result as a failed word, without caching it", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockResolvedValue({ isValidWord: true, lemma: "Haus", senses: "not an array" });
    const { addWord } = await setup(enricher);

    const res = await addWord("  Häuser ");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      word: "Häuser",
      sourceForm: null,
      partOfSpeech: "other",
      senses: [],
      enrichmentStatus: "failed",
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
    expect(res.body.enrichmentStatus).toBe("failed");
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
    expect(res.body).toMatchObject({ enrichmentStatus: "ok", senses: [{ translation: "house" }] });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient errors", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockRejectedValue(new Error("400 bad request"));
    const { addWord } = await setup(enricher);

    const res = await addWord("Haus");
    expect(res.body.enrichmentStatus).toBe("failed");
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("detects a duplicate of a failed word by the trimmed input", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockRejectedValue(new Error("boom"));
    const { addWord } = await setup(enricher);
    const first = await addWord("Haus");
    const second = await addWord(" haus ");
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ id: first.body.id, duplicate: true });
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
    const { body: created } = await addWord("Häuser");
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
    expect(cached!.result.senses[0]!.translation).toBe("house, building");
  });

  it("repairs a failed word", async () => {
    const { enricher, impl } = fakeEnricher();
    impl.mockRejectedValue(new Error("down"));
    const { app, auth, addWord } = await setup(enricher);
    const { body: created } = await addWord("stand");
    expect(created.enrichmentStatus).toBe("failed");

    impl.mockReset();
    impl.mockResolvedValue({ ...validEnrichment("stehen", "to stand"), partOfSpeech: "verb" });
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
    const { body: created } = await addWord("Haus");

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
    const { body: failed } = await addWord("stand");

    impl.mockResolvedValue(validEnrichment("stehen"));
    const res = await request(app).post(`/api/v1/words/${failed.id}/re-enrich`).set(auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_WORD");
  });
});
