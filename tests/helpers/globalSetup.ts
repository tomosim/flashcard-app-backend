// Migrates the test database once before the whole test run.
export async function setup() {
  process.env.NODE_ENV = "test";
  const { runMigrations } = await import("../../src/db/migrate.js");
  const { closeDb } = await import("../../src/db/client.js");
  try {
    await runMigrations();
  } finally {
    await closeDb();
  }
}
