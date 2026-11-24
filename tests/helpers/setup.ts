import { afterAll } from "vitest";
import { closeDb } from "../../src/db/client.js";

// --- Tests must never reach the Claude API ---------------------------------
// Remove every credential the Anthropic SDK could pick up...
for (const name of Object.keys(process.env)) {
  if (name.startsWith("ANTHROPIC_")) delete process.env[name];
}
// ...and block any HTTP request to Anthropic, however it is made.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (/^https?:\/\/([^/]+\.)?anthropic\.com(?=[/:]|$)/i.test(url)) {
    return Promise.reject(new Error(`Blocked request to the Claude API in tests: ${url}`));
  }
  return realFetch(input, init);
};
// ---------------------------------------------------------------------------

afterAll(async () => {
  await closeDb();
});
