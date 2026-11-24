import { logger } from "../lib/logger.js";
import {
  EnrichmentSchema,
  TransientEnrichmentError,
  type Enricher,
  type EnrichInput,
  type Enrichment,
} from "./types.js";

export const ENRICH_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2; // one retry

export type EnrichOutcome = { status: "ok"; enrichment: Enrichment } | { status: "failed" };

async function attempt(enricher: Enricher, input: EnrichInput, timeoutMs: number) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TransientEnrichmentError(`Enrichment timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([enricher.enrich(input, { signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls the enricher with a timeout and one retry on transient errors, then
 * validates the output with Zod. Never throws: any failure is `{ status: "failed" }`.
 */
export async function runEnricher(
  enricher: Enricher,
  input: EnrichInput,
  { timeoutMs = ENRICH_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<EnrichOutcome> {
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    let raw: unknown;
    try {
      raw = await attempt(enricher, input, timeoutMs);
    } catch (err) {
      const retry = err instanceof TransientEnrichmentError && i < MAX_ATTEMPTS;
      logger.warn({ err, attempt: i, retry, input }, "Enrichment call failed");
      if (retry) continue;
      return { status: "failed" };
    }

    const parsed = EnrichmentSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn({ issues: parsed.error.issues, input }, "Enrichment output failed validation");
      return { status: "failed" };
    }
    return { status: "ok", enrichment: parsed.data };
  }
  return { status: "failed" };
}
