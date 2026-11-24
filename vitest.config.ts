import { defineConfig } from "vitest/config";

// The live ClaudeEnricher test only runs via `npm run test:claude`.
const runLiveClaude = process.env.RUN_CLAUDE_TESTS === "1";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: {
      NODE_ENV: "test",
      // The app under test always uses the mock enricher.
      ENRICHER: "mock",
      // Never pick up a shell-exported key unless the live test was requested.
      ...(!runLiveClaude && { ANTHROPIC_API_KEY: "" }),
    },
    globalSetup: ["tests/helpers/globalSetup.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
  },
});
