import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/client.js";
import { enrichmentCache, users, words, type NewWordRow } from "../src/db/schema.js";
import { truncateAll } from "./helpers/db.js";

async function createUser(email = "a@example.com") {
  const [user] = await db.insert(users).values({ email, passwordHash: "x" }).returning();
  return user!;
}

function wordValues(userId: string, overrides: Partial<NewWordRow> = {}): NewWordRow {
  return {
    userId,
    word: "Haus",
    language: "de",
    partOfSpeech: "noun",
    senses: [
      { translation: "house", examples: [{ text: "Das Haus.", translation: "The house." }] },
    ],
    ...overrides,
  };
}

describe("database schema", () => {
  beforeEach(truncateAll);

  it("applies defaults to a new word", async () => {
    const user = await createUser();
    const [row] = await db.insert(words).values(wordValues(user.id)).returning();
    expect(row).toMatchObject({
      targetLanguage: "en",
      tags: [],
      enrichmentStatus: "ok",
      notes: null,
      sourceForm: null,
      conjugation: null,
    });
    expect(row!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row!.createdAt).toBeInstanceOf(Date);
    expect(row!.senses[0]!.translation).toBe("house");
  });

  it("rejects the same word and part of speech (case-insensitive) twice for one user and language", async () => {
    const user = await createUser();
    await db.insert(words).values(wordValues(user.id, { word: "Haus" }));
    await expect(db.insert(words).values(wordValues(user.id, { word: "haus" }))).rejects.toThrow();
  });

  it("allows the same word in another language, part of speech or for another user", async () => {
    const a = await createUser("a@example.com");
    const b = await createUser("b@example.com");
    await db.insert(words).values(wordValues(a.id));
    await db.insert(words).values(wordValues(a.id, { language: "nl" }));
    await db.insert(words).values(wordValues(a.id, { word: "haus", partOfSpeech: "verb" }));
    await db.insert(words).values(wordValues(b.id));
    expect(await db.$count(words)).toBe(4);
  });

  it("rejects an invalid part of speech", async () => {
    const user = await createUser();
    await expect(
      db.insert(words).values(wordValues(user.id, { partOfSpeech: "pronoun" as "noun" })),
    ).rejects.toThrow();
  });

  it("deletes a user's words when the user is deleted", async () => {
    const user = await createUser();
    await db.insert(words).values(wordValues(user.id));
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.$count(words)).toBe(0);
  });

  it("keys the enrichment cache by language, target language and lookup", async () => {
    const result = {
      isValidWord: true,
      entries: [
        {
          lemma: "Haus",
          partOfSpeech: "noun" as const,
          gender: "neuter" as const,
          article: "das",
          plural: "Häuser",
          conjugation: null,
          senses: [
            { translation: "house", examples: [{ text: "Das Haus.", translation: "The house." }] },
          ],
        },
      ],
    };
    const entry = { language: "de", targetLanguage: "en", lookup: "haus", result, model: "mock" };
    await db.insert(enrichmentCache).values(entry);
    await expect(db.insert(enrichmentCache).values(entry)).rejects.toThrow();
    await db.insert(enrichmentCache).values({ ...entry, language: "nl" });
    expect(await db.$count(enrichmentCache)).toBe(2);
  });
});
