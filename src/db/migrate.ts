import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { config } from "../config.js";
import { closeDb, createPool } from "./client.js";

export const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

/**
 * Applies pending migrations over the direct (non-pooled) connection: Neon's
 * pooler runs PgBouncer in transaction mode, which doesn't suit migrations.
 */
export async function runMigrations() {
  const pool = createPool(config.migrationDatabaseUrl);
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

// Run directly: `npm run db:migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runMigrations();
    console.log("Migrations applied");
  } finally {
    // The app pool is created when client.ts is imported, even though it's unused here.
    await closeDb();
  }
}
