import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { words } from "../../db/schema.js";
import { assertSupportedLanguage } from "../../lib/languages.js";
import { toWordDto, type WordDto } from "../words/service.js";

/** Up to `limit` random, successfully enriched words in one language, for the caller only. */
export async function getStudyBatch(
  userId: string,
  { language, limit }: { language: string; limit: number },
): Promise<{ items: WordDto[] }> {
  assertSupportedLanguage(language);
  const rows = await db
    .select()
    .from(words)
    .where(
      and(eq(words.userId, userId), eq(words.language, language), eq(words.enrichmentStatus, "ok")),
    )
    // Fine at this scale; revisit if a user ever has tens of thousands of words.
    .orderBy(sql`random()`)
    .limit(limit);
  return { items: rows.map(toWordDto) };
}
