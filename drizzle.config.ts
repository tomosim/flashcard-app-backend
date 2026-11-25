import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// drizzle-kit talks to the database directly, so prefer the non-pooled URL.
const url =
  process.env.NODE_ENV === "test"
    ? process.env.TEST_DATABASE_URL
    : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
if (!url) throw new Error("DATABASE_URL is not set");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url },
  strict: true,
});
