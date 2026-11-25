import { z } from "zod";
import {
  ConjugationSchema,
  GENDERS,
  PARTS_OF_SPEECH,
  SenseSchema,
} from "../../enrichment/types.js";
import { LanguageCodeSchema } from "../../lib/languages.js";

const Tags = z
  .array(z.string().trim().min(1).max(40))
  .max(20)
  .transform((tags) => [...new Set(tags)]);

/** Empty or whitespace-only strings become null. */
const NullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((s) => (s ? s : null));

export const IdParamsSchema = z.object({ id: z.uuid() });

export const CreateWordSchema = z.object({
  word: z.string().trim().min(1).max(80),
  language: LanguageCodeSchema,
  sourceUrl: z
    .union([z.url().max(2048), z.literal("")])
    .nullish()
    .transform((s) => s || null),
  tags: Tags.optional(),
  notes: NullableText(2000).optional(),
});

export const UpdateWordSchema = z
  .object({
    word: z.string().trim().min(1).max(80),
    partOfSpeech: z.enum(PARTS_OF_SPEECH),
    gender: z.enum(GENDERS).nullable(),
    article: NullableText(20),
    plural: NullableText(80),
    conjugation: ConjugationSchema.nullable(),
    senses: z.array(SenseSchema).min(1).max(4),
    notes: NullableText(2000),
    tags: Tags,
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "No fields to update" });

export const ListWordsQuerySchema = z.object({
  language: LanguageCodeSchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["createdAt", "word"]).default("createdAt"),
});

export type CreateWordInput = z.infer<typeof CreateWordSchema>;
export type UpdateWordInput = z.infer<typeof UpdateWordSchema>;
export type ListWordsQuery = z.infer<typeof ListWordsQuerySchema>;
