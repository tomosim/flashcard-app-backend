# Vocab App – Backend Product Spec (v1 prototype)

Nov 24, 2026 · @tom

## Overview

Build a Node + TypeScript REST API where each logged-in user saves foreign-language words. The server fills in translations, grammar and example sentences automatically with an LLM, and serves random flashcard batches filtered by language.

**In scope for v1**

- Email and password registration and login (JWT)
- Add a word by sending only `word` + `language`; the server enriches it
- Browse, edit and delete your own words
- Random study batches (default 10) for one language
- List the languages a user has words in, with counts

**Out of scope for v1**

- Spaced repetition and review scheduling
- iPhone Shortcut capture and personal API tokens
- Base languages other than English (all translations are into English)
- Import and export, stats, social features
- The React + Vite frontend (separate spec)

## Tech stack and project structure

Use Express 5 with TypeScript, Zod for validation, Drizzle ORM on Postgres 16, and the Anthropic TypeScript SDK for enrichment.

| Concern            | Choice                                         |
| ------------------ | ---------------------------------------------- |
| Runtime            | Node 22 LTS, TypeScript strict mode, ESM       |
| HTTP               | Express 5                                      |
| Validation         | Zod (request bodies, query params, LLM output) |
| Database           | Postgres 16 via Docker Compose locally         |
| ORM and migrations | Drizzle ORM + drizzle-kit                      |
| Auth               | argon2 password hashing, jsonwebtoken (JWT)    |
| LLM                | @anthropic-ai/sdk, model `claude-haiku-5-5`    |
| Testing            | Vitest + Supertest, separate test database     |
| Dev tooling        | tsx watch, ESLint, Prettier, dotenv            |

Folder layout (routes call services, and services call the database; no SQL in routes):

```
src/
  app.ts              # builds the Express app (no listen), for tests
  server.ts           # listen()
  config.ts           # env vars parsed with Zod
  db/
    schema.ts         # Drizzle tables
    client.ts
    migrations/
  middleware/
    auth.ts           # requireAuth, sets req.user
    validate.ts       # Zod validation helper
    errorHandler.ts
  modules/
    auth/   (routes.ts, service.ts, schemas.ts)
    words/  (routes.ts, service.ts, schemas.ts)
    study/  (routes.ts, service.ts)
    languages/ (routes.ts, service.ts)
  enrichment/
    types.ts          # Enricher interface + Zod schema
    claudeEnricher.ts
    mockEnricher.ts
    index.ts          # picks enricher from config
  lib/errors.ts       # AppError classes
tests/
docker-compose.yml
.env.example
```

## Data model

Use three tables: `users`, `words` (one row per user per word) and `enrichment_cache` (shared across users, so a word is only paid for once). Meanings and examples are stored as a JSONB array on the word. They are always read and edited together, so separate tables would add joins for no benefit in v1.

**users**

| Column         | Type        | Notes                     |
| -------------- | ----------- | ------------------------- |
| id             | uuid PK     | `gen_random_uuid()`       |
| email          | text        | unique, stored lowercased |
| password\_hash | text        | argon2id                  |
| display\_name  | text        | nullable                  |
| created\_at    | timestamptz | default now()             |

**words**

| Column                    | Type               | Notes                                                     |
| ------------------------- | ------------------ | --------------------------------------------------------- |
| id                        | uuid PK            |                                                           |
| user\_id                  | uuid FK → users.id | on delete cascade, indexed                                |
| word                      | text               | dictionary form (lemma), e.g. `stehen`                    |
| source\_form              | text               | nullable; what the user typed if it differs, e.g. `stand` |
| language                  | text               | ISO 639-1 code of the word, e.g. `de`                     |
| target\_language          | text               | default `en` (fixed in v1)                                |
| part\_of\_speech          | text               | `noun`, `verb`, `adjective`, `adverb`, `phrase`, `other`  |
| gender                    | text               | nullable; `masculine`, `feminine`, `neuter`               |
| article                   | text               | nullable; e.g. `der`, `die`, `das`                        |
| plural                    | text               | nullable                                                  |
| conjugation               | jsonb              | nullable; `Conjugation`, verbs only, see below            |
| senses                    | jsonb              | `Sense[]`, see below                                      |
| notes                     | text               | nullable, user's own notes                                |
| tags                      | text\[\]           | default `{}`                                              |
| source\_url               | text               | nullable, where the word was found                        |
| enrichment\_status        | text               | `ok`, `failed`                                            |
| created\_at / updated\_at | timestamptz        |                                                           |

Unique index on `(user_id, language, lower(word), part_of_speech)`, so the verb `laufen` and the noun `Laufen` can coexist, plus an index on `(user_id, language)` for study queries.

**Sense shape (JSONB)**

```ts
type Sense = {
  translation: string; // "to stand"
  note?: string; // "physical position"
  examples: {
    text: string; // "Er steht an der Tür."
    translation: string; // "He is standing at the door."
  }[]; // 1–3 per sense
};
// a word has 1–4 senses
```

**Conjugation shape (JSONB, verbs only)**

```ts
type Conjugation = {
  present: { pronoun: string; form: string }[]; // 6 persons: 1st/2nd/3rd sg, 1st/2nd/3rd pl
  past: { pronoun: string; form: string }[]; // 6 persons, simple past (German Präteritum)
  perfect: string; // 3rd sg with auxiliary, e.g. "hat beeindruckt"
};
// e.g. present[2] = { pronoun: "er/sie/es", form: "steht" }
```

**enrichment\_cache**

| Column           | Type        | Notes                                 |
| ---------------- | ----------- | ------------------------------------- |
| language         | text        | part of PK                            |
| target\_language | text        | part of PK                            |
| lookup           | text        | part of PK; lowercased, trimmed input |
| result           | jsonb       | validated `Enrichment` object         |
| model            | text        | e.g. `claude-haiku-5-5` or `mock`     |
| created\_at      | timestamptz |                                       |

API responses use camelCase (`sourceForm`, `partOfSpeech`); map from snake\_case in the service layer.

## Auth

Auth uses stateless JWTs with email and password. Every route except register, login and health requires `Authorization: Bearer <token>`.

- Passwords: argon2id, minimum 8 characters, validated with Zod.
- Access token: JWT signed with HS256 using `JWT_SECRET`, payload `{ sub: userId }`, expires in 7 days. There are no refresh tokens in v1.
- `requireAuth` middleware verifies the token and sets `req.user = { id }`. It returns 401 if the token is missing, invalid or expired.
- Every word query is scoped by `user_id = req.user.id`. Another user's word returns 404, not 403, so ids can't be probed.
- Login returns the same 401 message for a wrong email or a wrong password.
- Rate-limit `/auth/*` with express-rate-limit (10 requests per minute per IP).
- Later: personal API tokens for the iPhone Shortcut, and refresh tokens in httpOnly cookies for the web app.

## API endpoints

All routes are under `/api/v1`, take and return JSON, and use camelCase. Supported languages are an allow-list in config, initially `de, fr, es, it, nl, pt`.

| Method | Path                 | Auth | Purpose                                              |
| ------ | -------------------- | ---- | ---------------------------------------------------- |
| GET    | /health              | No   | Liveness check, returns `{ ok: true }`               |
| POST   | /auth/register       | No   | Create a user, return token + user                   |
| POST   | /auth/login          | No   | Return token + user                                  |
| GET    | /auth/me             | Yes  | Current user                                         |
| POST   | /words               | Yes  | Add a word; the server enriches it                   |
| GET    | /words               | Yes  | List and search the user's words, paginated          |
| GET    | /words/:id           | Yes  | One word                                             |
| PATCH  | /words/:id           | Yes  | Edit any field, including senses                     |
| POST   | /words/:id/re-enrich | Yes  | Run enrichment again and overwrite                   |
| DELETE | /words/:id           | Yes  | Delete, returns 204                                  |
| DELETE | /words               | Yes  | Delete all the caller's words, returns `{ deleted }` |
| GET    | /study/batch         | Yes  | Random flashcard batch for one language              |
| GET    | /languages           | Yes  | The user's languages with word counts                |

**POST /auth/register** and **/auth/login**

```json
// request
{ "email": "tom@example.com", "password": "min-8-chars", "displayName": "Tom" }
// 201 / 200 response
{ "token": "eyJ...", "user": { "id": "uuid", "email": "tom@example.com", "displayName": "Tom" } }
```

Register returns 409 if the email is taken. `displayName` is register-only and optional.

**POST /words**

```json
// request (only word + language are required)
{ "word": "stand", "language": "de", "sourceUrl": "https://...", "tags": ["news"], "notes": "" }
```

1. Validate the body. `word` is 1–80 characters after trimming.
2. Enrich (cache first, then the LLM). This yields one entry per part of speech, each with its lemma, for example `stand` → verb `stehen`, or `beeindruckt` → adjective `beeindruckt` + verb `beeindrucken`.
3. Insert one word per entry. An entry whose lemma and part of speech the user already has in that language is not inserted; the existing word is returned instead with `"duplicate": true`.
4. Return `{ items: (Word & { duplicate: boolean })[] }` in entry order: **201** if at least one word was inserted, **200** if all were duplicates.
5. If enrichment fails, still save one word with `senses: []` and `enrichmentStatus: "failed"`, and return 201. The user can retry with `/re-enrich`.

```json
// 201 response
{
  "items": [
    {
      "id": "uuid",
      "word": "stehen",
      "sourceForm": "stand",
      "language": "de",
      "targetLanguage": "en",
      "partOfSpeech": "verb",
      "gender": null,
      "article": null,
      "plural": null,
      "conjugation": {
        "present": [{ "pronoun": "ich", "form": "stehe" } /* …6 in total */],
        "past": [{ "pronoun": "ich", "form": "stand" } /* …6 in total */],
        "perfect": "hat gestanden"
      },
      "senses": [
        {
          "translation": "to stand",
          "examples": [
            { "text": "Er steht an der Tür.", "translation": "He is standing at the door." }
          ]
        },
        {
          "translation": "to stagnate, to be at a standstill",
          "examples": [
            { "text": "Die Verhandlungen stehen.", "translation": "The negotiations have stalled." }
          ]
        }
      ],
      "notes": null,
      "tags": ["news"],
      "sourceUrl": "https://...",
      "enrichmentStatus": "ok",
      "createdAt": "...",
      "updatedAt": "...",
      "duplicate": false
    }
  ]
}
```

**GET /words**: query `language?`, `search?` (case-insensitive match on the word or any translation), `tag?`, `page` (default 1), `pageSize` (default 20, max 100), `sort` (`createdAt` desc by default, or `word`). Response: `{ items: Word[], page, pageSize, total }`.

**PATCH /words/:id**: any subset of `word, partOfSpeech, gender, article, plural, conjugation, senses, notes, tags`. The whole `senses` array (and `conjugation` object) is replaced when sent. Validate with the same Zod schemas.

**GET /study/batch**: query `language` (required), `limit` (default 10, max 50). Returns up to `limit` random words with `enrichmentStatus = ok`, as `{ items: Word[] }`. Use `ORDER BY random()`, which is fine at this scale. Fewer words than `limit` returns what exists; zero returns an empty array.

**GET /languages**: `{ items: [{ language: "de", count: 42 }] }`, sorted by count descending.

## Enrichment

Enrichment sits behind one `Enricher` interface. `ENRICHER=mock` (the default in development, and always used in tests) returns fixed data at no cost. `ENRICHER=claude` calls Claude Haiku 5.5, which costs roughly $0.0002 per word.

```ts
interface Enricher {
  enrich(input: { text: string; language: string; targetLanguage: string }): Promise<Enrichment>;
}

const EntrySchema = z.object({
  lemma: z.string().min(1), // dictionary form
  partOfSpeech: z.enum(["noun", "verb", "adjective", "adverb", "phrase", "other"]),
  gender: z.enum(["masculine", "feminine", "neuter"]).nullable(),
  article: z.string().nullable(),
  plural: z.string().nullable(),
  conjugation: ConjugationSchema.nullable(), // verbs only; forced to null on save for other parts of speech
  senses: z.array(SenseSchema).min(1).max(4),
});

const EnrichmentSchema = z.object({
  isValidWord: z.boolean(), // false for gibberish or wrong language
  entries: z.array(EntrySchema).min(1).max(3), // one per part of speech, most common first
});
```

**Flow inside `wordsService.create`**

1. Normalise the input: trim it, then lowercase it for the cache key (keep the original casing for display; German nouns are capitalised).
2. Look up `enrichment_cache` by `(language, targetLanguage, lookup)`. Only an entry whose `model` matches the enricher in use counts as a hit, so mock data is never served when `ENRICHER=claude` (and vice versa). A real model's result can replace a mock entry, but a mock result never replaces a real model's entry.
3. On a miss, call the enricher with a 15-second timeout and one retry on network or 5xx errors.
4. Validate the result with `EnrichmentSchema`. If validation fails, the status is `failed`.
5. If `isValidWord` is false, return **422** `{ error: "NOT_A_WORD" }` and save nothing.
6. Write the result to the cache, then insert one word per entry.

**ClaudeEnricher**

- Model `claude-haiku-5-5`, `max_tokens: 2500` (two entries plus conjugation tables can exceed 1024).
- Force JSON by defining one tool, `save_word`, whose `input_schema` is the JSON Schema of `EnrichmentSchema` (generate it with `zod-to-json-schema`), and setting `tool_choice: { type: "tool", name: "save_word" }`. Read the tool call's `input` and validate it with Zod.
- Log input and output token counts for each call.

System prompt:

```text
You are a bilingual lexicographer building flashcards for an English-speaking
learner at roughly B1–B2 level. You will receive a word or short phrase in
{language}. It may be inflected (e.g. a conjugated verb or a plural noun).

Return, via the save_word tool:
- isValidWord: false if the input is not a real {language} word or phrase.
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
    {language} pronoun, in standard order: 1st, 2nd, 3rd person singular, then
    1st, 2nd, 3rd person plural (for German: ich, du, er/sie/es, wir, ihr, sie).
    "form" is the verb form alone, without the pronoun; separable verbs keep
    the particle (e.g. "fange an").
  - past: the same 6 persons in the simple past (German: Präteritum).
  - perfect: the 3rd person singular perfect with its auxiliary
    (e.g. "hat beeindruckt", "ist gegangen").
- senses: 1–4 distinct, common meanings for that part of speech, most frequent
  first. Each has a concise English translation (several synonyms
  comma-separated are fine) and 1–2 natural, everyday example sentences in
  {language}, 6–14 words long, each with an English translation. Use the lemma
  in a natural inflected form.
Do not invent rare or archaic meanings.
```

User message: `Word: "{text}"`.

**MockEnricher** returns a fixed, plausible result built from the input. For example, there is one entry whose lemma is the input, with one sense with translation `"[mock] {text}"`, and there is one example. The input `"xxinvalid"` returns `isValidWord: false`, so the 422 path can be tested. A few known inputs map to lemmas (`stand` → verb `stehen`, with a placeholder conjugation), and `beeindruckt` returns two entries (adjective + verb) to test multi-word creation.

## Config, errors and testing

**Environment variables** (parsed with Zod in `config.ts`; the app fails fast on startup if one is missing or invalid)

```bash
PORT=3000
DATABASE_URL=postgres://vocab:vocab@localhost:5432/vocab
TEST_DATABASE_URL=postgres://vocab:vocab@localhost:5433/vocab_test
JWT_SECRET=change-me-at-least-32-chars
JWT_EXPIRES_IN=7d
ENRICHER=mock            # mock | claude
ANTHROPIC_API_KEY=       # required only when ENRICHER=claude
SUPPORTED_LANGUAGES=de,fr,es,it,nl,pt
CORS_ORIGIN=http://localhost:5173
```

**Error format**: every error response is `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details"?: ... } }`.

| Status | Code                  | When                                          |
| ------ | --------------------- | --------------------------------------------- |
| 400    | VALIDATION\_ERROR     | Zod failure; `details` holds the field issues |
| 401    | UNAUTHORIZED          | Missing or invalid token, or bad credentials  |
| 404    | NOT\_FOUND            | Unknown id, or a word owned by another user   |
| 409    | EMAIL\_TAKEN          | Register with an existing email               |
| 422    | NOT\_A\_WORD          | Enricher says the input isn't a real word     |
| 422    | UNSUPPORTED\_LANGUAGE | Language not in the allow-list                |
| 429    | RATE\_LIMITED         | Too many auth attempts                        |
| 500    | INTERNAL              | Anything else; log the stack, never return it |

Other middleware: helmet, cors (origin from config), `express.json({ limit: "100kb" })`, and pino-http request logging.

**Testing** (Vitest + Supertest against `app.ts`, with a real Postgres test database, migrated and truncated between tests, and the mock enricher)

- Auth: register, duplicate email, login with right and wrong password, `/me` with and without a token.
- Words: create; inflected input saves the lemma; a duplicate returns 200 with `duplicate: true`; 422 for an invalid word; list with pagination and search; PATCH senses; delete; user A can't read user B's word (404).
- Study: returns at most `limit` words, only in the requested language, only the caller's words, and an empty array when there are none.
- Enrichment: a cache hit skips the enricher (spy on it); a schema-invalid enricher output saves the word with `failed`.
- Tests never use the Claude API, with or without `ANTHROPIC_API_KEY`. Under the test runner the config forces `ENRICHER=mock` and drops the API key, `createEnricher` always returns the MockEnricher, the `ClaudeEnricher` constructor throws, and the test setup blocks any request to `anthropic.com`. Tests check that each of these guards holds. The ClaudeEnricher is checked by hand with `ENRICHER=claude npm run dev`.

## Milestones and instructions for Claude Code

Build in five milestones, in order. Each milestone ends with `npm run typecheck`, `npm run lint` and `npm test` passing, and a commit.

1. **Scaffold**: TypeScript project, ESLint and Prettier, `docker-compose.yml` (Postgres on port 5432 and a test database on 5433), `config.ts`, `app.ts` and `server.ts`, error handler, `GET /health` with a test.
2. **Database**: Drizzle schema for all three tables, first migration, npm scripts `db:generate`, `db:migrate`, `db:studio`, and a seed script that creates a demo user and about 15 German words via the mock enricher.
3. **Auth**: register, login, `/me`, `requireAuth`, rate limiting, tests.
4. **Words + enrichment**: Enricher interface, MockEnricher, cache, full words CRUD, re-enrich, tests. Then add ClaudeEnricher behind `ENRICHER=claude`.
5. **Study + languages**: `/study/batch` and `/languages`, tests, and a README covering setup, scripts, env vars and example curl commands for every endpoint.

**Instructions to paste into Claude Code**

```text
Read SPEC.md (this document). Build the backend it describes, one milestone
at a time. After each milestone, run typecheck, lint and tests, fix any
failures, commit, and stop to summarise what you did before starting the next.

Rules:
- Follow the folder layout and the routes -> services -> db layering.
- Validate every request and every LLM response with Zod.
- Scope every word query by the authenticated user's id.
- Use the mock enricher by default; never call the Anthropic API in tests.
- Do not add features outside the v1 scope. If something in the spec is
  unclear or contradictory, ask me instead of guessing.
```

**Open questions**

- Where will it be hosted later (for example Railway, Render or Fly.io, with Neon for Postgres)? This doesn't block the prototype.
- Should a word with failed enrichment show in study batches with a placeholder, or stay hidden? The spec says hidden.
