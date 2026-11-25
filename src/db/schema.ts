import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Conjugation, Enrichment, Gender, PartOfSpeech, Sense } from "../enrichment/types.js";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Always stored lowercased (enforced in the auth service).
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  createdAt: createdAt(),
});

export const words = pgTable(
  "words",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    word: text("word").notNull(),
    sourceForm: text("source_form"),
    language: text("language").notNull(),
    targetLanguage: text("target_language").notNull().default("en"),
    partOfSpeech: text("part_of_speech").$type<PartOfSpeech>().notNull(),
    gender: text("gender").$type<Gender>(),
    article: text("article"),
    plural: text("plural"),
    // Verbs only; null for every other part of speech.
    conjugation: jsonb("conjugation").$type<Conjugation>(),
    senses: jsonb("senses").$type<Sense[]>().notNull().default([]),
    notes: text("notes"),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    sourceUrl: text("source_url"),
    enrichmentStatus: text("enrichment_status").$type<"ok" | "failed">().notNull().default("ok"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Per part of speech, so e.g. the verb "laufen" and the noun "Laufen" can coexist.
    uniqueIndex("words_user_language_word_pos_unique").on(
      t.userId,
      t.language,
      sql`lower(${t.word})`,
      t.partOfSpeech,
    ),
    // Also serves as the user_id index (leftmost column), so no separate one is needed.
    index("words_user_language_idx").on(t.userId, t.language),
    check(
      "words_part_of_speech_check",
      sql`${t.partOfSpeech} in ('noun', 'verb', 'adjective', 'adverb', 'phrase', 'other')`,
    ),
    check("words_gender_check", sql`${t.gender} in ('masculine', 'feminine', 'neuter')`),
    check("words_enrichment_status_check", sql`${t.enrichmentStatus} in ('ok', 'failed')`),
  ],
);

export const enrichmentCache = pgTable(
  "enrichment_cache",
  {
    language: text("language").notNull(),
    targetLanguage: text("target_language").notNull(),
    // Lowercased, trimmed user input.
    lookup: text("lookup").notNull(),
    result: jsonb("result").$type<Enrichment>().notNull(),
    model: text("model").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.language, t.targetLanguage, t.lookup] })],
);

export type UserRow = typeof users.$inferSelect;
export type WordRow = typeof words.$inferSelect;
export type NewWordRow = typeof words.$inferInsert;
export type EnrichmentCacheRow = typeof enrichmentCache.$inferSelect;
