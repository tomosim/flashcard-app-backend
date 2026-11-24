import type { Enricher, EnrichInput, Enrichment } from "./types.js";

/** Input that the mock treats as gibberish, to exercise the NOT_A_WORD path. */
export const MOCK_INVALID_INPUT = "xxinvalid";

/**
 * A few inflected forms the mock knows the lemma for, so the
 * "inflected input saves the lemma" path can be exercised without an LLM.
 */
const KNOWN_LEMMAS: Record<string, Omit<Enrichment, "isValidWord" | "senses">> = {
  stand: { lemma: "stehen", partOfSpeech: "verb", gender: null, article: null, plural: null },
  ging: { lemma: "gehen", partOfSpeech: "verb", gender: null, article: null, plural: null },
  häuser: {
    lemma: "Haus",
    partOfSpeech: "noun",
    gender: "neuter",
    article: "das",
    plural: "Häuser",
  },
};

/** Free, deterministic enricher for development and tests. */
export class MockEnricher implements Enricher {
  readonly model = "mock";

  async enrich({ text }: EnrichInput): Promise<Enrichment> {
    const input = text.trim();
    const key = input.toLowerCase();

    if (key === MOCK_INVALID_INPUT) {
      return {
        isValidWord: false,
        lemma: input,
        partOfSpeech: "other",
        gender: null,
        article: null,
        plural: null,
        senses: [
          { translation: "[mock] invalid", examples: [{ text: input, translation: input }] },
        ],
      };
    }

    const known = KNOWN_LEMMAS[key];
    return {
      isValidWord: true,
      ...(known ?? {
        lemma: input,
        partOfSpeech: "other",
        gender: null,
        article: null,
        plural: null,
      }),
      senses: [
        {
          translation: `[mock] ${input}`,
          examples: [
            {
              text: `[mock] Ein Beispiel mit ${input}.`,
              translation: `[mock] An example with ${input}.`,
            },
          ],
        },
      ],
    };
  }
}
