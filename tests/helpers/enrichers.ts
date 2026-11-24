import { vi } from "vitest";
import { MockEnricher } from "../../src/enrichment/mockEnricher.js";
import type { Enricher, EnrichInput } from "../../src/enrichment/types.js";

/** A MockEnricher whose `enrich` is a spy. */
export function spyEnricher() {
  const enricher = new MockEnricher();
  const spy = vi.spyOn(enricher, "enrich");
  return { enricher, spy };
}

/** An enricher whose behaviour each test scripts with `impl.mockImplementation...`. */
export function fakeEnricher(model = "fake") {
  const impl = vi.fn<(input: EnrichInput) => Promise<unknown>>();
  const enricher: Enricher = { model, enrich: (input) => impl(input) };
  return { enricher, impl };
}

export function validEnrichment(lemma: string, translation = `${lemma} (en)`) {
  return {
    isValidWord: true,
    lemma,
    partOfSpeech: "noun",
    gender: "neuter",
    article: "das",
    plural: null,
    senses: [{ translation, examples: [{ text: `Das ${lemma}.`, translation: `The ${lemma}.` }] }],
  };
}
