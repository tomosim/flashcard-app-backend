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

export const EnrichmentSchema = z.object({
  isValidWord: z.boolean(),
  lemma: z.string().trim().min(1),
  partOfSpeech: z.enum(PARTS_OF_SPEECH),
  gender: z.enum(GENDERS).nullable(),
  article: z.string().nullable(),
  plural: z.string().nullable(),
  senses: z.array(SenseSchema).min(1).max(4),
});

export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];
export type Gender = (typeof GENDERS)[number];
export type Example = z.infer<typeof ExampleSchema>;
export type Sense = z.infer<typeof SenseSchema>;
export type Enrichment = z.infer<typeof EnrichmentSchema>;

export type EnrichInput = { text: string; language: string; targetLanguage: string };

export interface Enricher {
  /** Identifies the source of results, stored in enrichment_cache.model. */
  readonly model: string;
  enrich(input: EnrichInput): Promise<Enrichment>;
}
