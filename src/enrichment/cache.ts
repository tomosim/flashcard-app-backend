import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { enrichmentCache } from "../db/schema.js";
import { MOCK_MODEL } from "./mockEnricher.js";
import { EnrichmentSchema, type Enrichment } from "./types.js";

export type CacheKey = { language: string; targetLanguage: string; lookup: string };

/** Lowercased, trimmed input: the cache lookup key. */
export function toLookup(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Returns the cached result only if it was produced by `model`, the enricher
 * currently in use. Mock data is never served to Claude users, and vice versa.
 */
export async function getCachedEnrichment(
  key: CacheKey,
  model: string,
): Promise<Enrichment | null> {
  const row = await db.query.enrichmentCache.findFirst({
    where: and(
      eq(enrichmentCache.language, key.language),
      eq(enrichmentCache.targetLanguage, key.targetLanguage),
      eq(enrichmentCache.lookup, key.lookup),
      eq(enrichmentCache.model, model),
    ),
  });
  if (!row) return null;
  // Re-validate in case the schema has changed since the entry was written.
  const parsed = EnrichmentSchema.safeParse(row.result);
  return parsed.success ? parsed.data : null;
}

/**
 * Inserts or overwrites the cache entry for `key`. There is one entry per key,
 * so a real model's result replaces anything, but a mock result only replaces
 * another mock result: running in mock mode never discards paid-for data.
 */
export async function putCachedEnrichment(key: CacheKey, result: Enrichment, model: string) {
  await db
    .insert(enrichmentCache)
    .values({ ...key, result, model })
    .onConflictDoUpdate({
      target: [enrichmentCache.language, enrichmentCache.targetLanguage, enrichmentCache.lookup],
      set: { result, model, createdAt: new Date() },
      // Mock writes only update rows that are already mock.
      ...(model === MOCK_MODEL && { setWhere: eq(enrichmentCache.model, MOCK_MODEL) }),
    });
}
