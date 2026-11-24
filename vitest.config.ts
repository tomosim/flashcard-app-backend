import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests must never call the Anthropic API.
    env: { NODE_ENV: "test", ENRICHER: "mock" },
  },
});
