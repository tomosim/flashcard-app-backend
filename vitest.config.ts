import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      NODE_ENV: "test",
      // Tests never use Claude: always the mock enricher, never an API key.
      // (Also enforced in config.ts, createEnricher, ClaudeEnricher and tests/helpers/setup.ts.)
      ENRICHER: "mock",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
    },
    globalSetup: ["tests/helpers/globalSetup.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
