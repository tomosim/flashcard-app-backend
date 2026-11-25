import { z } from "zod";

export const PARTS_OF_SPEECH = ["noun", "verb", "adjective", "adverb", "phrase", "other"] as const;
export const GENDERS = ["masculine", "feminine", "neuter"] as const;

export const ExampleSchema = z.object({
  text: z.string().trim().min(1),
  translation: z.string().trim().min(1),
});

export const SenseSchema = z.object({
  translation: z.string().trim().min(1),
  note: z.string().trim().min(1).optional(),
  examples: z.array(ExampleSchema).min(1).max(3),
});

export const ConjugatedFormSchema = z.object({
  pronoun: z.string().trim().min(1),
  form: z.string().trim().min(1),
});

/** Six persons in standard order: 1st/2nd/3rd singular, then 1st/2nd/3rd plural. */
const PersonForms = z.array(ConjugatedFormSchema).length(6);

export const ConjugationSchema = z.object({
  present: PersonForms,
  /** Simple past, e.g. German Präteritum. */
  past: PersonForms,
  /** Third person singular perfect with its auxiliary, e.g. "hat beeindruckt". */
  perfect: z.string().trim().min(1),
});

export const EntrySchema = z.object({
  lemma: z.string().trim().min(1),
  partOfSpeech: z.enum(PARTS_OF_SPEECH),
  gender: z.enum(GENDERS).nullable(),
  article: z.string().nullable(),
  plural: z.string().nullable(),
  conjugation: ConjugationSchema.nullable(),
  senses: z.array(SenseSchema).min(1).max(4),
});

export const EnrichmentSchema = z.object({
  isValidWord: z.boolean(),
  /** One entry per part of speech the input can be, most common first. */
  entries: z.array(EntrySchema).min(1).max(3),
});

export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];
export type Gender = (typeof GENDERS)[number];
export type Example = z.infer<typeof ExampleSchema>;
export type Sense = z.infer<typeof SenseSchema>;
export type ConjugatedForm = z.infer<typeof ConjugatedFormSchema>;
export type Conjugation = z.infer<typeof ConjugationSchema>;
export type Entry = z.infer<typeof EntrySchema>;
export type Enrichment = z.infer<typeof EnrichmentSchema>;

export type EnrichInput = { text: string; language: string; targetLanguage: string };

export type EnrichOptions = { signal?: AbortSignal };

export interface Enricher {
  /** Identifies the source of results, stored in enrichment_cache.model. */
  readonly model: string;
  /**
   * Returns the enricher's raw result. Callers must validate it with
   * EnrichmentSchema: LLM output is untrusted.
   */
  enrich(input: EnrichInput, options?: EnrichOptions): Promise<unknown>;
}

/** A network, timeout or 5xx failure worth retrying once. */
export class TransientEnrichmentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransientEnrichmentError";
  }
}
