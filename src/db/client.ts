import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import * as schema from "./schema.js";

export function createPool(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  // An idle client can be disconnected by the server, e.g. when Neon scales the
  // compute to zero. Without a listener that error would crash the process; the
  // pool drops the client and opens a new one on the next query.
  pool.on("error", (err) => logger.warn({ err }, "Idle Postgres client error"));
  return pool;
}

export const pool = createPool(config.databaseUrl);

export const db = drizzle(pool, { schema });
export type Db = typeof db;

export async function closeDb() {
  await pool.end();
}
