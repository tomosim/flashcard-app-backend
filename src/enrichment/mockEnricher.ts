import type { Conjugation, Enricher, EnrichInput, Enrichment, Entry } from "./types.js";

/** The `model` stored in enrichment_cache for mock results. */
export const MOCK_MODEL = "mock";

/** Input that the mock treats as gibberish, to exercise the NOT_A_WORD path. */
export const MOCK_INVALID_INPUT = "xxinvalid";

const PRONOUNS = ["ich", "du", "er/sie/es", "wir", "ihr", "sie"];

/** A fixed, obviously fake conjugation table for a mock verb. */
export function mockConjugation(lemma: string): Conjugation {
  return {
    present: PRONOUNS.map((pronoun) => ({ pronoun, form: `[mock] ${lemma} present` })),
    past: PRONOUNS.map((pronoun) => ({ pronoun, form: `[mock] ${lemma} past` })),
    perfect: `[mock] hat ${lemma}`,
  };
}

type EntryHead = Omit<Entry, "senses">;

const noun = (lemma: string, article: string, gender: Entry["gender"], plural: string) =>
  ({ lemma, partOfSpeech: "noun", gender, article, plural, conjugation: null }) as EntryHead;
const verb = (lemma: string): EntryHead => ({
  lemma,
  partOfSpeech: "verb",
  gender: null,
  article: null,
  plural: null,
  conjugation: mockConjugation(lemma),
});
const other = (lemma: string, partOfSpeech: Entry["partOfSpeech"] = "other"): EntryHead => ({
  lemma,
  partOfSpeech,
  gender: null,
  article: null,
  plural: null,
  conjugation: null,
});

/**
 * A few inputs the mock knows, so the "inflected input saves the lemma" and
 * "one input, several parts of speech" paths can be exercised without an LLM.
 */
const KNOWN: Record<string, EntryHead[]> = {
  stehen: [verb("stehen")],
  stand: [verb("stehen")],
  gehen: [verb("gehen")],
  ging: [verb("gehen")],
  häuser: [noun("Haus", "das", "neuter", "Häuser")],
  beeindruckt: [other("beeindruckt", "adjective"), verb("beeindrucken")],
};

function withMockSense(head: EntryHead, input: string): Entry {
  return {
    ...head,
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

/** Free, deterministic enricher for development and tests. */
export class MockEnricher implements Enricher {
  readonly model = MOCK_MODEL;

  async enrich({ text }: EnrichInput): Promise<Enrichment> {
    const input = text.trim();
    const key = input.toLowerCase();

    if (key === MOCK_INVALID_INPUT) {
      return {
        isValidWord: false,
        entries: [
          {
            ...other(input),
            senses: [
              { translation: "[mock] invalid", examples: [{ text: input, translation: input }] },
            ],
          },
        ],
      };
    }

    const heads = KNOWN[key] ?? [other(input)];
    return { isValidWord: true, entries: heads.map((h) => withMockSense(h, input)) };
  }
}
