import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import { isTestRuntime } from "../lib/runtime.js";
import { ENRICH_TIMEOUT_MS } from "./run.js";
import {
  EnrichmentSchema,
  TransientEnrichmentError,
  type Enricher,
  type EnrichInput,
  type EnrichOptions,
} from "./types.js";

export const CLAUDE_MODEL = "claude-haiku-5-5";
const TOOL_NAME = "save_word";

const LANGUAGE_NAMES: Record<string, string> = {
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  nl: "Dutch",
  pt: "Portuguese",
  en: "English",
};

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code;
}

function systemPrompt(language: string): string {
  return `You are a bilingual lexicographer building flashcards for an English-speaking
learner at roughly B1–B2 level. You will receive a word or short phrase in
${language}. It may be inflected (e.g. a conjugated verb or a plural noun).

Return, via the save_word tool:
- isValidWord: false if the input is not a real ${language} word or phrase.
- entries: one entry per distinct part of speech the input form is commonly
  used as, most common first (at most 3). For example, German "beeindruckt" is
  both the adjective "beeindruckt" and a form of the verb "beeindrucken", so it
  gets two entries. A participle that is also a common adjective counts as both.
  Most words have a single entry; do not add entries for rare or archaic uses.

Each entry has:
- lemma: the dictionary form for that part of speech. Capitalise nouns where
  the language requires it.
- partOfSpeech, and for nouns: gender, definite article, and plural form
  (otherwise null).
- conjugation: for verbs only (null for every other part of speech):
  - present: the 6 present-tense forms, each { pronoun, form }, with the
    ${language} pronoun, in standard order: 1st, 2nd, 3rd person singular, then
    1st, 2nd, 3rd person plural (for German: ich, du, er/sie/es, wir, ihr, sie).
    "form" is the verb form alone, without the pronoun; separable verbs keep
    the particle (e.g. "fange an").
  - past: the same 6 persons in the simple past (German: Präteritum).
  - perfect: the 3rd person singular perfect with its auxiliary
    (e.g. "hat beeindruckt", "ist gegangen").
- senses: 1–4 distinct, common meanings for that part of speech, most frequent
  first. Each has a concise English translation (several synonyms
  comma-separated are fine) and 1–2 natural, everyday example sentences in
  ${language}, 6–14 words long, each with an English translation. Use the lemma
  in a natural inflected form.
Do not invent rare or archaic meanings.`;
}

function toolInputSchema(): Anthropic.Tool.InputSchema {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(EnrichmentSchema, { io: "input" });
  return schema as Anthropic.Tool.InputSchema;
}

/** Enriches words with Claude Haiku via a forced `save_word` tool call. */
export class ClaudeEnricher implements Enricher {
  readonly model = CLAUDE_MODEL;
  private readonly client: Anthropic;
  private readonly tool: Anthropic.Tool;

  constructor(apiKey: string) {
    if (isTestRuntime()) {
      throw new Error("ClaudeEnricher must never be used in tests; use MockEnricher");
    }
    // Timeouts and retries are handled by runEnricher, so the SDK doesn't retry.
    this.client = new Anthropic({ apiKey, timeout: ENRICH_TIMEOUT_MS, maxRetries: 0 });
    this.tool = {
      name: TOOL_NAME,
      description: "Save the dictionary entry for the given word.",
      input_schema: toolInputSchema(),
    };
  }

  async enrich({ text, language }: EnrichInput, options: EnrichOptions = {}): Promise<unknown> {
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create(
        {
          model: CLAUDE_MODEL,
          // Two entries plus conjugation tables can exceed 1024 tokens.
          max_tokens: 2500,
          // No `temperature`: claude-haiku-5-5 rejects non-default sampling parameters.
          system: systemPrompt(languageName(language)),
          tools: [this.tool],
          tool_choice: { type: "tool", name: TOOL_NAME },
          messages: [{ role: "user", content: `Word: "${text}"` }],
        },
        { signal: options.signal },
      );
    } catch (err) {
      if (
        err instanceof Anthropic.APIConnectionError ||
        err instanceof Anthropic.InternalServerError
      ) {
        throw new TransientEnrichmentError("Claude request failed", { cause: err });
      }
      throw err;
    }

    logger.info(
      {
        model: CLAUDE_MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        stopReason: response.stop_reason,
      },
      "Claude enrichment call",
    );

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME,
    );
    if (!toolUse) {
      throw new Error(
        `Claude returned no ${TOOL_NAME} call (stop_reason: ${response.stop_reason})`,
      );
    }
    // Validated with EnrichmentSchema by the caller.
    return toolUse.input;
  }
}
