import { sql } from "drizzle-orm";
import { db } from "../../src/db/client.js";

/** Empties every table. Call in beforeEach for tests that touch the database. */
export async function truncateAll() {
  await db.execute(sql`TRUNCATE TABLE words, enrichment_cache, users RESTART IDENTITY CASCADE`);
}
