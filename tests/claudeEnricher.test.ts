import { describe, expect, it, vi } from "vitest";

// These tests prove that no test can ever call the Claude API.
describe("Claude API is unreachable from tests", () => {
  it("config forces the mock enricher and drops the API key, whatever the env says", async () => {
    vi.resetModules();
    vi.stubEnv("ENRICHER", "claude");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-should-be-ignored");
    vi.stubEnv("NODE_ENV", "development");
    try {
      const { config } = await import("../src/config.js");
      expect(config.enricher).toBe("mock");
      expect(config.anthropicApiKey).toBeUndefined();
      expect(config.isTest).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("createEnricher returns the MockEnricher even when asked for Claude", async () => {
    const { createEnricher } = await import("../src/enrichment/index.js");
    const { MockEnricher } = await import("../src/enrichment/mockEnricher.js");
    const enricher = createEnricher({ enricher: "claude", anthropicApiKey: "sk-ant-x" });
    expect(enricher).toBeInstanceOf(MockEnricher);
  });

  it("ClaudeEnricher cannot be constructed in tests", async () => {
    const { ClaudeEnricher } = await import("../src/enrichment/claudeEnricher.js");
    expect(() => new ClaudeEnricher("sk-ant-x")).toThrow(/never be used in tests/);
  });

  it("no Anthropic credentials are visible to tests", () => {
    const leaked = Object.keys(process.env).filter((k) => k.startsWith("ANTHROPIC_"));
    expect(leaked).toEqual([]);
  });

  it("HTTP requests to the Anthropic API are blocked", async () => {
    for (const url of [
      "https://api.anthropic.com/v1/messages",
      "https://API.ANTHROPIC.COM:443/v1/messages",
      new Request("https://api.anthropic.com/v1/models"),
    ]) {
      await expect(fetch(url, { method: "POST" })).rejects.toThrow(/Blocked request/);
    }
  });
});
