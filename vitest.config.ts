import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Tests must never call the Anthropic API.
    env: { NODE_ENV: "test", ENRICHER: "mock" },
    globalSetup: ["tests/helpers/globalSetup.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
