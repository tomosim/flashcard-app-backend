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

/** One valid enrichment entry: a neuter noun unless overridden. */
export function validEntry(
  lemma: string,
  translation = `${lemma} (en)`,
  overrides: Record<string, unknown> = {},
) {
  return {
    lemma,
    partOfSpeech: "noun",
    gender: "neuter",
    article: "das",
    plural: null,
    conjugation: null,
    senses: [{ translation, examples: [{ text: `Das ${lemma}.`, translation: `The ${lemma}.` }] }],
    ...overrides,
  };
}

/** A valid enrichment with a single entry. */
export function validEnrichment(
  lemma: string,
  translation?: string,
  overrides: Record<string, unknown> = {},
) {
  return { isValidWord: true, entries: [validEntry(lemma, translation, overrides)] };
}

/** A valid six-person conjugation table. */
export function validConjugation(prefix = "x") {
  const persons = ["ich", "du", "er/sie/es", "wir", "ihr", "sie"].map((pronoun, i) => ({
    pronoun,
    form: `${prefix}${i}`,
  }));
  return { present: persons, past: persons, perfect: `hat ${prefix}` };
}
