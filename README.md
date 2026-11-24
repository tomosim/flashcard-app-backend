# Vocab App – Backend (v1 prototype)

A Node + TypeScript REST API for saving foreign-language words. You send a word and its language; the server fills in the lemma, grammar, translations and example sentences using an LLM (or a free mock), and serves random flashcard batches.

See [SPEC.md](SPEC.md) for the full product spec.

**Stack:** Node 22+, TypeScript (strict, ESM), Express 5, Zod, Drizzle ORM on Postgres 16, argon2 + JWT auth, the Anthropic SDK (`claude-haiku-5-5`), Vitest + Supertest.

## Setup

Prerequisites: Node 22 or later, and Docker.

```bash
npm install
cp .env.example .env          # then set JWT_SECRET to a random string of 32+ characters
docker compose up -d          # Postgres for dev (port 5432) and tests (port 5433)
npm run db:migrate            # create the tables
npm run db:seed               # optional: demo user and 15 German words
npm run dev                   # http://localhost:3000/api/v1
```

The seed creates `demo@example.com` with password `demo-password`. It is safe to run more than once.

**Port clashes.** If something else already uses port 5432 or 5433 (another Postgres, for example), set `DB_PORT` and/or `TEST_DB_PORT` in `.env` to free ports, update `DATABASE_URL` / `TEST_DATABASE_URL` to match, and run `docker compose up -d` again.

## Scripts

| Script                            | What it does                                                             |
| --------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                     | Start the API with live reload (tsx watch)                               |
| `npm run build`                   | Compile to `dist/` (and copy the migrations)                             |
| `npm start`                       | Run the compiled build                                                   |
| `npm run typecheck`               | Type-check without emitting                                              |
| `npm run lint`                    | ESLint                                                                   |
| `npm run format` / `format:check` | Prettier write / check                                                   |
| `npm test`                        | Run the test suite once (needs the test database running)                |
| `npm run test:watch`              | Run tests in watch mode                                                  |
| `npm run db:generate`             | Generate a new migration after editing `src/db/schema.ts`                |
| `npm run db:migrate`              | Apply migrations to the dev database                                     |
| `npm run db:migrate:test`         | Apply migrations to the test database (tests also do this automatically) |
| `npm run db:studio`               | Open Drizzle Studio to browse the dev database                           |
| `npm run db:seed`                 | Create the demo user and words                                           |

## Environment variables

All variables are parsed with Zod at startup; the app exits with a clear message if one is missing or invalid.

| Variable                   | Required               | Default             | Description                                                |
| -------------------------- | ---------------------- | ------------------- | ---------------------------------------------------------- |
| `PORT`                     | No                     | `3000`              | HTTP port                                                  |
| `DATABASE_URL`             | Yes                    |                     | Dev/production Postgres connection string                  |
| `TEST_DATABASE_URL`        | Yes                    |                     | Postgres used by the tests (always, under the test runner) |
| `JWT_SECRET`               | Yes                    |                     | HS256 signing secret, at least 32 characters               |
| `JWT_EXPIRES_IN`           | No                     | `7d`                | Access token lifetime                                      |
| `ENRICHER`                 | No                     | `mock`              | `mock` (free, fixed data) or `claude`                      |
| `ANTHROPIC_API_KEY`        | When `ENRICHER=claude` |                     | Anthropic API key                                          |
| `SUPPORTED_LANGUAGES`      | No                     | `de,fr,es,it,nl,pt` | Comma-separated ISO 639-1 allow-list                       |
| `CORS_ORIGIN`              | Yes                    |                     | Allowed browser origin, e.g. `http://localhost:5173`       |
| `DB_PORT` / `TEST_DB_PORT` | No                     | `5432` / `5433`     | Host ports used by `docker-compose.yml` only               |

## Enrichment

Adding a word runs it through an enricher, which returns the lemma, part of speech, gender, article, plural and 1–4 senses with example sentences.

- `ENRICHER=mock` returns fixed data such as `"[mock] Haus"`. It knows a few inflected forms (`stand` → `stehen`, `ging` → `gehen`, `Häuser` → `Haus`), and treats `xxinvalid` as not a word.
- `ENRICHER=claude` calls Claude Haiku 5.5 (about $0.0002 per word) with a forced `save_word` tool call. Each call has a 15-second timeout and one retry on network, timeout or 5xx errors, and every response is validated with Zod.
- Results are cached in `enrichment_cache`, shared by all users, so each word is only paid for once.
- If enrichment fails, the word is still saved with `enrichmentStatus: "failed"` and empty senses; `POST /words/:id/re-enrich` retries it. Failed words are left out of study batches.

**Tests never call the Claude API.** Under the test runner the app always uses the mock enricher, whatever `ENRICHER` or `ANTHROPIC_API_KEY` say, and requests to `anthropic.com` are blocked.

## API

All routes are under `/api/v1` and use JSON with camelCase fields. Every route except health, register and login needs `Authorization: Bearer <token>`.

Errors always look like this:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "email", "message": "Invalid email address" }]
  }
}
```

| Status | Code                   | When                                                       |
| ------ | ---------------------- | ---------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`     | Invalid body, query or id; `details` lists the fields      |
| 401    | `UNAUTHORIZED`         | Missing, invalid or expired token, or wrong email/password |
| 404    | `NOT_FOUND`            | Unknown id, or a word that belongs to another user         |
| 409    | `EMAIL_TAKEN`          | Registering an email that already exists                   |
| 409    | `DUPLICATE_WORD`       | Renaming or re-enriching a word into one you already have  |
| 422    | `NOT_A_WORD`           | The enricher says the input isn't a real word              |
| 422    | `UNSUPPORTED_LANGUAGE` | Language not in `SUPPORTED_LANGUAGES`                      |
| 429    | `RATE_LIMITED`         | More than 10 `/auth/*` requests per minute from one IP     |
| 502    | `ENRICHMENT_FAILED`    | Re-enrich failed; the word is unchanged                    |
| 500    | `INTERNAL`             | Anything else                                              |

### Examples

```bash
API=http://localhost:3000/api/v1
```

**Health**

```bash
curl $API/health
# {"ok":true}
```

**Register** (201) and **log in** (200). Both return `{ token, user }`.

```bash
curl -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"tom@example.com","password":"min-8-chars","displayName":"Tom"}'

curl -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"demo-password"}'

# Save the token for the requests below
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@example.com","password":"demo-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
AUTH="Authorization: Bearer $TOKEN"
```

**Current user**

```bash
curl $API/auth/me -H "$AUTH"
# {"user":{"id":"…","email":"demo@example.com","displayName":"Demo"}}
```

**Add a word.** Only `word` and `language` are required. Returns 201 with the enriched word, or 200 with `"duplicate": true` if you already have that lemma.

```bash
curl -X POST $API/words -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"word":"stand","language":"de","sourceUrl":"https://example.com/article","tags":["news"]}'
```

**List and search words.** Optional query: `language`, `search` (word or any translation), `tag`, `page` (default 1), `pageSize` (default 20, max 100), `sort` (`createdAt`, newest first, or `word`).

```bash
curl "$API/words?language=de&search=steh&sort=word&page=1&pageSize=20" -H "$AUTH"
# {"items":[…],"page":1,"pageSize":20,"total":1}
```

**Get one word**

```bash
curl $API/words/$WORD_ID -H "$AUTH"
```

**Edit a word.** Send any of `word`, `partOfSpeech`, `gender`, `article`, `plural`, `senses`, `notes`, `tags`. Sending `senses` replaces the whole array.

```bash
curl -X PATCH $API/words/$WORD_ID -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"notes":"Seen in Der Spiegel","senses":[{"translation":"to stand","examples":[{"text":"Er steht an der Tür.","translation":"He is standing at the door."}]}]}'
```

**Re-enrich a word.** Skips the cache, overwrites the word and the cache entry.

```bash
curl -X POST $API/words/$WORD_ID/re-enrich -H "$AUTH"
```

**Delete a word** (204)

```bash
curl -X DELETE $API/words/$WORD_ID -H "$AUTH"
```

**Study batch.** `language` is required; `limit` defaults to 10 (max 50). Returns random words with `enrichmentStatus: "ok"`.

```bash
curl "$API/study/batch?language=de&limit=10" -H "$AUTH"
# {"items":[…]}
```

**Languages** with word counts, most words first

```bash
curl $API/languages -H "$AUTH"
# {"items":[{"language":"de","count":15}]}
```

## Project layout

```
src/
  app.ts              # builds the Express app (no listen), used by tests
  server.ts           # listen()
  config.ts           # env vars parsed with Zod
  db/                 # Drizzle schema, client, migrations, migrate + seed scripts
  middleware/         # requireAuth, validate, errorHandler, rate limiting
  modules/            # auth, words, study, languages: routes -> service -> db
  enrichment/         # Enricher interface, mock + Claude enrichers, cache, retry/timeout
  lib/                # errors, logger, JWT, languages
tests/                # Vitest + Supertest against a real test database
```

Routes validate input and call services; services own all database access and map rows to camelCase responses. Every word query is scoped to the authenticated user.
