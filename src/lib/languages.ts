import { z } from "zod";
import { config } from "../config.js";
import { UnsupportedLanguageError } from "./errors.js";

/** ISO 639-1 code shape; the allow-list is checked separately (422, not 400). */
export const LanguageCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/, {
    message: "Must be a two-letter ISO 639-1 language code",
  });

/** All translations are into English in v1. */
export const TARGET_LANGUAGE = "en";

export function assertSupportedLanguage(language: string): void {
  if (!config.supportedLanguages.includes(language)) {
    throw new UnsupportedLanguageError(language);
  }
}
