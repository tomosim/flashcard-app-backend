import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "./client.js";

export const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations",
);

export async function runMigrations() {
  await migrate(db, { migrationsFolder });
}

// Run directly: `npm run db:migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runMigrations();
    console.log("Migrations applied");
  } finally {
    await closeDb();
  }
}
