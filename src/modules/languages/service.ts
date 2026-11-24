import { asc, count, desc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { words } from "../../db/schema.js";

export type LanguageCount = { language: string; count: number };

/** The caller's languages with word counts, most words first. */
export async function listLanguages(userId: string): Promise<{ items: LanguageCount[] }> {
  const items = await db
    .select({ language: words.language, count: count() })
    .from(words)
    .where(eq(words.userId, userId))
    .groupBy(words.language)
    .orderBy(desc(count()), asc(words.language));
  return { items };
}
