/**
 * Creates a demo user and ~15 German words enriched by the MockEnricher.
 * Idempotent: safe to run repeatedly. Run with `npm run db:seed`.
 */
import argon2 from "argon2";
import { MockEnricher } from "../enrichment/mockEnricher.js";
import { closeDb, db } from "./client.js";
import { enrichmentCache, users, words } from "./schema.js";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo-password";
const LANGUAGE = "de";
const TARGET_LANGUAGE = "en";

const GERMAN_WORDS = [
  "Haus",
  "stand",
  "ging",
  "Fenster",
  "Tisch",
  "Buch",
  "schnell",
  "schön",
  "laufen",
  "sprechen",
  "Zeitung",
  "gestern",
  "Freundschaft",
  "vielleicht",
  "Bahnhof",
  "beeindruckt",
];

async function seed() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const [user] = await db
    .insert(users)
    .values({ email: DEMO_EMAIL, passwordHash, displayName: "Demo" })
    .onConflictDoUpdate({ target: users.email, set: { passwordHash } })
    .returning({ id: users.id });
  if (!user) throw new Error("Failed to upsert demo user");

  const enricher = new MockEnricher();
  let inserted = 0;

  for (const input of GERMAN_WORDS) {
    const text = input.trim();
    const enrichment = await enricher.enrich({
      text,
      language: LANGUAGE,
      targetLanguage: TARGET_LANGUAGE,
    });

    await db
      .insert(enrichmentCache)
      .values({
        language: LANGUAGE,
        targetLanguage: TARGET_LANGUAGE,
        lookup: text.toLowerCase(),
        result: enrichment,
        model: enricher.model,
      })
      .onConflictDoNothing();

    // One word per entry (part of speech).
    const rows = await db
      .insert(words)
      .values(
        enrichment.entries.map((entry) => ({
          userId: user.id,
          word: entry.lemma,
          sourceForm: entry.lemma === text ? null : text,
          language: LANGUAGE,
          targetLanguage: TARGET_LANGUAGE,
          partOfSpeech: entry.partOfSpeech,
          gender: entry.gender,
          article: entry.article,
          plural: entry.plural,
          conjugation: entry.partOfSpeech === "verb" ? entry.conjugation : null,
          senses: entry.senses,
          tags: ["seed"],
          enrichmentStatus: "ok" as const,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: words.id });
    inserted += rows.length;
  }

  console.log(`Seeded demo user ${DEMO_EMAIL} / ${DEMO_PASSWORD} with ${inserted} new words`);
}

try {
  await seed();
} finally {
  await closeDb();
}
