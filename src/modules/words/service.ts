import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { words, type NewWordRow, type WordRow } from "../../db/schema.js";
import {
  getCachedEnrichment,
  putCachedEnrichment,
  toLookup,
  type CacheKey,
} from "../../enrichment/cache.js";
import { runEnricher } from "../../enrichment/run.js";
import type { Enricher, Enrichment, Entry, PartOfSpeech } from "../../enrichment/types.js";
import {
  DuplicateWordError,
  EnrichmentFailedError,
  NotAWordError,
  NotFoundError,
} from "../../lib/errors.js";
import { assertSupportedLanguage, TARGET_LANGUAGE } from "../../lib/languages.js";
import type { CreateWordInput, ListWordsQuery, UpdateWordInput } from "./schemas.js";

const PG_UNIQUE_VIOLATION = "23505";

export type WordDto = Omit<WordRow, "userId" | "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

export function toWordDto(row: WordRow): WordDto {
  const { userId: _userId, createdAt, updatedAt, ...rest } = row;
  return { ...rest, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

function isUniqueViolation(err: unknown): boolean {
  const cause = err instanceof Error && "cause" in err ? err.cause : err;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === PG_UNIQUE_VIOLATION
  );
}

/** Every word query goes through this, so it is always scoped to the user. */
function ownedBy(userId: string, ...conditions: (SQL | undefined)[]) {
  return and(eq(words.userId, userId), ...conditions);
}

function sameWord(userId: string, language: string, word: string, partOfSpeech: PartOfSpeech) {
  return ownedBy(
    userId,
    eq(words.language, language),
    sql`lower(${words.word}) = lower(${word})`,
    eq(words.partOfSpeech, partOfSpeech),
  );
}

async function findOwned(userId: string, id: string): Promise<WordRow> {
  const row = await db.query.words.findFirst({ where: ownedBy(userId, eq(words.id, id)) });
  // Another user's word looks exactly like a missing one.
  if (!row) throw new NotFoundError("Word not found");
  return row;
}

/** Word fields derived from one enrichment entry for the given user input. */
function enrichedFields(input: string, e: Entry) {
  return {
    word: e.lemma,
    sourceForm: e.lemma === input ? null : input,
    partOfSpeech: e.partOfSpeech,
    gender: e.gender,
    article: e.article,
    plural: e.plural,
    // Only verbs conjugate, whatever the enricher sent.
    conjugation: e.partOfSpeech === "verb" ? e.conjugation : null,
    senses: e.senses,
    enrichmentStatus: "ok" as const,
  };
}

/** The word saved when enrichment fails: the trimmed input, ready to re-enrich. */
function failedFields(input: string) {
  return {
    word: input,
    sourceForm: null,
    partOfSpeech: "other" as const,
    gender: null,
    article: null,
    plural: null,
    conjugation: null,
    senses: [],
    enrichmentStatus: "failed" as const,
  };
}

type EnrichResult = { status: "ok"; enrichment: Enrichment } | { status: "failed" };

/** Cache first, then the enricher. Valid results are cached; failures never are. */
async function enrichWithCache(enricher: Enricher, key: CacheKey, text: string) {
  const cached = await getCachedEnrichment(key, enricher.model);
  if (cached) return { status: "ok", enrichment: cached } satisfies EnrichResult;

  const outcome = await runEnricher(enricher, {
    text,
    language: key.language,
    targetLanguage: key.targetLanguage,
  });
  if (outcome.status === "ok" && outcome.enrichment.isValidWord) {
    await putCachedEnrichment(key, outcome.enrichment, enricher.model);
  }
  return outcome;
}

export type CreatedWord = WordDto & { duplicate: boolean };
export type CreateWordResult = { items: CreatedWord[]; created: boolean };

/**
 * Enriches the input and saves one word per entry (part of speech). Entries the
 * user already has are returned unchanged with `duplicate: true`.
 */
export async function createWord(
  userId: string,
  input: CreateWordInput,
  enricher: Enricher,
): Promise<CreateWordResult> {
  assertSupportedLanguage(input.language);

  const text = input.word; // already trimmed; original casing kept for display
  const key = { language: input.language, targetLanguage: TARGET_LANGUAGE, lookup: toLookup(text) };
  const outcome = await enrichWithCache(enricher, key, text);

  if (outcome.status === "ok" && !outcome.enrichment.isValidWord) {
    throw new NotAWordError();
  }

  const fieldsList =
    outcome.status === "ok"
      ? dedupeEntries(outcome.enrichment.entries).map((e) => enrichedFields(text, e))
      : [failedFields(text)];

  const rows: NewWordRow[] = fieldsList.map((fields) => ({
    ...fields,
    userId,
    language: input.language,
    targetLanguage: TARGET_LANGUAGE,
    tags: input.tags ?? [],
    notes: input.notes ?? null,
    sourceUrl: input.sourceUrl ?? null,
  }));

  // The unique index decides duplicates, which also covers concurrent requests.
  const inserted = await db.insert(words).values(rows).onConflictDoNothing().returning();

  const items = await Promise.all(
    fieldsList.map(async (fields): Promise<CreatedWord> => {
      const isSame = (r: WordRow) =>
        r.partOfSpeech === fields.partOfSpeech &&
        r.word.toLowerCase() === fields.word.toLowerCase();
      const created = inserted.find(isSame);
      if (created) return { ...toWordDto(created), duplicate: false };

      const existing = await db.query.words.findFirst({
        where: sameWord(userId, input.language, fields.word, fields.partOfSpeech),
      });
      if (!existing) throw new Error("Insert conflicted but no existing word was found");
      return { ...toWordDto(existing), duplicate: true };
    }),
  );

  return { items, created: inserted.length > 0 };
}

/** Drops entries that would collide on the unique index (same lemma and part of speech). */
function dedupeEntries(entries: Entry[]): Entry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const k = `${e.lemma.toLowerCase()}\u0000${e.partOfSpeech}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function listWords(userId: string, query: ListWordsQuery) {
  if (query.language) assertSupportedLanguage(query.language);

  const pattern = query.search ? `%${query.search.replace(/[\\%_]/g, "\\$&")}%` : undefined;
  const where = ownedBy(
    userId,
    query.language ? eq(words.language, query.language) : undefined,
    query.tag ? sql`${query.tag} = any(${words.tags})` : undefined,
    pattern
      ? sql`(${words.word} ilike ${pattern} or exists (
          select 1 from jsonb_array_elements(${words.senses}) as s
          where s->>'translation' ilike ${pattern}))`
      : undefined,
  );

  const orderBy =
    query.sort === "word"
      ? [asc(sql`lower(${words.word})`), asc(words.id)]
      : [desc(words.createdAt), desc(words.id)];

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(words)
      .where(where)
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.$count(words, where),
  ]);

  return { items: rows.map(toWordDto), page: query.page, pageSize: query.pageSize, total };
}

export async function getWord(userId: string, id: string): Promise<WordDto> {
  return toWordDto(await findOwned(userId, id));
}

export async function updateWord(
  userId: string,
  id: string,
  patch: UpdateWordInput,
): Promise<WordDto> {
  await findOwned(userId, id);
  try {
    const [row] = await db
      .update(words)
      .set({
        ...patch,
        // Senses supplied by hand make a failed word usable for study.
        ...(patch.senses && { enrichmentStatus: "ok" as const }),
      })
      .where(ownedBy(userId, eq(words.id, id)))
      .returning();
    if (!row) throw new NotFoundError("Word not found");
    return toWordDto(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateWordError();
    throw err;
  }
}

/**
 * Runs enrichment again, bypassing the cache read, and overwrites both the
 * word and the cache entry. On failure the word is left unchanged.
 */
export async function reEnrichWord(
  userId: string,
  id: string,
  enricher: Enricher,
): Promise<WordDto> {
  const existing = await findOwned(userId, id);
  const text = existing.sourceForm ?? existing.word;
  const key = {
    language: existing.language,
    targetLanguage: existing.targetLanguage,
    lookup: toLookup(text),
  };

  const outcome = await runEnricher(enricher, {
    text,
    language: key.language,
    targetLanguage: key.targetLanguage,
  });
  if (outcome.status === "failed") throw new EnrichmentFailedError();
  if (!outcome.enrichment.isValidWord) throw new NotAWordError();

  // Re-enrich updates only this word: the entry for its part of speech, else the first.
  const { entries } = outcome.enrichment;
  const entry = entries.find((e) => e.partOfSpeech === existing.partOfSpeech) ?? entries[0]!;

  try {
    const [row] = await db
      .update(words)
      .set(enrichedFields(text, entry))
      .where(ownedBy(userId, eq(words.id, id)))
      .returning();
    if (!row) throw new NotFoundError("Word not found");
    await putCachedEnrichment(key, outcome.enrichment, enricher.model);
    return toWordDto(row);
  } catch (err) {
    // The new lemma matches another word the user already has.
    if (isUniqueViolation(err)) throw new DuplicateWordError();
    throw err;
  }
}

export async function deleteWord(userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(words)
    .where(ownedBy(userId, eq(words.id, id)))
    .returning({ id: words.id });
  if (deleted.length === 0) throw new NotFoundError("Word not found");
}

/** Deletes every word the user owns and returns how many were removed. */
export async function deleteAllWords(userId: string): Promise<{ deleted: number }> {
  const deleted = await db.delete(words).where(ownedBy(userId)).returning({ id: words.id });
  return { deleted: deleted.length };
}
