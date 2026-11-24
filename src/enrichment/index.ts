import type { Config } from "../config.js";
import { isTestRuntime } from "../lib/runtime.js";
import { ClaudeEnricher } from "./claudeEnricher.js";
import { MockEnricher } from "./mockEnricher.js";
import type { Enricher } from "./types.js";

export function createEnricher(cfg: Pick<Config, "enricher" | "anthropicApiKey">): Enricher {
  // Tests always get the mock, even if handed a config asking for Claude.
  if (isTestRuntime()) return new MockEnricher();
  if (cfg.enricher === "claude") {
    if (!cfg.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required when ENRICHER=claude");
    return new ClaudeEnricher(cfg.anthropicApiKey);
  }
  return new MockEnricher();
}

export type { Enricher } from "./types.js";
