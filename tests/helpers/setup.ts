import { afterAll } from "vitest";
import { closeDb } from "../../src/db/client.js";

afterAll(async () => {
  await closeDb();
});
