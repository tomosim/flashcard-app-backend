import { describe, expect, it } from "vitest";
import { ClaudeEnricher, CLAUDE_MODEL } from "../src/enrichment/claudeEnricher.js";
import { runEnricher } from "../src/enrichment/run.js";
import { EnrichmentSchema, TransientEnrichmentError } from "../src/enrichment/types.js";
import { validEnrichment } from "./helpers/enrichers.js";

const input = { text: "stand", language: "de", targetLanguage: "en" };

/** A fake fetch that records the request and returns a canned Messages API response. */
function fakeFetch(respond: () => Response) {
  const requests: Record<string, unknown>[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return respond();
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

function messageResponse(content: unknown[], stop_reason = "tool_use") {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: CLAUDE_MODEL,
      content,
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 400, output_tokens: 120 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("ClaudeEnricher (fake HTTP, no API calls)", () => {
  it("forces the save_word tool and returns its input", async () => {
    const result = validEnrichment("stehen");
    const { fetch, requests } = fakeFetch(() =>
      messageResponse([{ type: "tool_use", id: "toolu_1", name: "save_word", input: result }]),
    );
    const enricher = new ClaudeEnricher("test-key", { fetch });

    await expect(enricher.enrich(input)).resolves.toEqual(result);

    const body = requests[0]!;
    expect(body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 1024,
      tool_choice: { type: "tool", name: "save_word" },
      messages: [{ role: "user", content: 'Word: "stand"' }],
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body.system).toContain("in\nGerman");
    const tool = (body.tools as Record<string, unknown>[])[0]!;
    expect(tool.name).toBe("save_word");
    expect(tool.input_schema).toMatchObject({ type: "object" });
    expect(tool.input_schema).not.toHaveProperty("$schema");
  });

  it("throws when the response has no save_word call", async () => {
    const { fetch } = fakeFetch(() => messageResponse([{ type: "text", text: "hi" }], "end_turn"));
    await expect(new ClaudeEnricher("k", { fetch }).enrich(input)).rejects.toThrow(/save_word/);
  });

  it("maps 5xx responses to a transient (retryable) error", async () => {
    const { fetch, requests } = fakeFetch(
      () => new Response(JSON.stringify({ type: "error" }), { status: 529 }),
    );
    const enricher = new ClaudeEnricher("k", { fetch });
    await expect(enricher.enrich(input)).rejects.toBeInstanceOf(TransientEnrichmentError);
    expect(await runEnricher(enricher, input)).toEqual({ status: "failed" });
    expect(requests).toHaveLength(3); // 1 direct + 2 attempts, SDK itself does not retry
  });

  it("does not retry 4xx responses", async () => {
    const { fetch } = fakeFetch(
      () => new Response(JSON.stringify({ type: "error" }), { status: 400 }),
    );
    const err = await new ClaudeEnricher("k", { fetch }).enrich(input).catch((e) => e);
    expect(err).not.toBeInstanceOf(TransientEnrichmentError);
  });
});

// Real API call: opt-in only, never part of a normal `npm test` run.
const runLive = process.env.RUN_CLAUDE_TESTS === "1" && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!runLive)("ClaudeEnricher (live API)", () => {
  it("enriches an inflected German verb", { timeout: 30_000 }, async () => {
    const enricher = new ClaudeEnricher(process.env.ANTHROPIC_API_KEY!);
    const outcome = await runEnricher(enricher, input);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(EnrichmentSchema.parse(outcome.enrichment)).toMatchObject({
      isValidWord: true,
      lemma: "stehen",
      partOfSpeech: "verb",
    });
  });
});
