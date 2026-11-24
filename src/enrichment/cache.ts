import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { enrichmentCache } from "../db/schema.js";
import { EnrichmentSchema, type Enrichment } from "./types.js";

export type CacheKey = { language: string; targetLanguage: string; lookup: string };

/** Lowercased, trimmed input: the cache lookup key. */
export function toLookup(text: string): string {
  return text.trim().toLowerCase();
}

export async function getCachedEnrichment(key: CacheKey): Promise<Enrichment | null> {
  const row = await db.query.enrichmentCache.findFirst({
    where: and(
      eq(enrichmentCache.language, key.language),
      eq(enrichmentCache.targetLanguage, key.targetLanguage),
      eq(enrichmentCache.lookup, key.lookup),
    ),
  });
  if (!row) return null;
  // Re-validate in case the schema has changed since the entry was written.
  const parsed = EnrichmentSchema.safeParse(row.result);
  return parsed.success ? parsed.data : null;
}

/** Inserts or overwrites a cache entry. */
export async function putCachedEnrichment(key: CacheKey, result: Enrichment, model: string) {
  await db
    .insert(enrichmentCache)
    .values({ ...key, result, model })
    .onConflictDoUpdate({
      target: [enrichmentCache.language, enrichmentCache.targetLanguage, enrichmentCache.lookup],
      set: { result, model, createdAt: new Date() },
    });
}
