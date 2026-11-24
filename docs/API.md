# Vocab App API Reference (v1)

This is a reference for building a frontend against the Vocab App backend. It describes every endpoint, the exact JSON shapes, the validation rules, and the behaviour the UI needs to handle.

## What the app does

Learners save foreign-language words they come across, for example while reading an article. They send the word and its language, and the server **enriches** it with an LLM. Enrichment works out the dictionary form (lemma), the part of speech, gender, article and plural, and 1–4 senses (meanings), each with an English translation and example sentences. Learners can then browse, search, edit and tag their words, and study them as random flashcard batches for one language.

- Translations are always into **English**.
- Supported source languages are `de`, `fr`, `es`, `it`, `nl` and `pt` by default. There is no endpoint that lists them (see [Gaps](#gaps-and-things-the-api-does-not-do)).
- Each user sees only their own words.

## Basics

| Item          | Value                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| Base URL      | `http://localhost:3000/api/v1`                                                              |
| Format        | JSON request and response bodies, camelCase field names                                     |
| Content type  | Send `Content-Type: application/json` on requests that have a body                          |
| CORS          | Only the origin in the server's `CORS_ORIGIN` is allowed (dev: `http://localhost:5173`)     |
| Body limit    | 100 kB                                                                                      |
| IDs           | UUID strings                                                                                |
| Timestamps    | ISO 8601 UTC strings, e.g. `"2026-11-24T15:15:48.470Z"`                                     |
| Language code | Two-letter lowercase ISO 639-1 code. Input is trimmed and lowercased, so `" DE "` is valid. |

## Authentication

- `POST /auth/register` and `POST /auth/login` return a JWT access token.
- Send it on every other request (everything except `/health`, `/auth/register` and `/auth/login`) as `Authorization: Bearer <token>`.
- Tokens last **7 days** by default. There is no refresh token and no logout endpoint. To log out, the client discards the token.
- Any `401 UNAUTHORIZED` from an authenticated route means the token is missing, invalid or expired, or the user no longer exists. The client should clear the token and send the user to the login screen.
- **Rate limit:** every `/auth/*` route, including `/auth/me`, is limited to **10 requests per minute per IP**. Going over returns `429 RATE_LIMITED`. Responses carry standard `RateLimit` and `RateLimit-Policy` headers (IETF draft-8), e.g. `RateLimit: "10-in-1min"; r=9; t=60`. Avoid calling `/auth/me` on every page load. Call it once at startup and keep the user in client state.

## Errors

Every error response has this shape:

```ts
type ApiError = {
  error: {
    code: ErrorCode;
    message: string; // human-readable, safe to show
    details?: { path: string; message: string }[]; // only on VALIDATION_ERROR from field checks
  };
};
```

`details[].path` is the dotted field path, such as `"email"` or `"senses.0.examples.1.text"`. It is `""` for errors about the whole body, such as `"No fields to update"`. Map `details` to inline form errors.

| Status | Code                   | When                                                                                                                    |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`     | Invalid body, query or path id (`details` lists fields), malformed JSON (`"Malformed JSON body"`) or body over 100 kB   |
| 401    | `UNAUTHORIZED`         | Missing, invalid or expired token (`"Missing or invalid access token"`), or wrong login (`"Invalid email or password"`) |
| 404    | `NOT_FOUND`            | Unknown word id, a word that belongs to another user (`"Word not found"`), or an unknown route (`"Route not found"`)    |
| 409    | `EMAIL_TAKEN`          | Registering an email that already has an account                                                                        |
| 409    | `DUPLICATE_WORD`       | Renaming (PATCH) or re-enriching a word into one the user already has in that language                                  |
| 422    | `NOT_A_WORD`           | The enricher says the input isn't a real word in that language                                                          |
| 422    | `UNSUPPORTED_LANGUAGE` | A well-formed language code that isn't in the server's supported list, e.g. `"Language \"en\" is not supported"`        |
| 429    | `RATE_LIMITED`         | More than 10 `/auth/*` requests per minute from one IP                                                                  |
| 502    | `ENRICHMENT_FAILED`    | Re-enrich failed (LLM error or timeout). The word is unchanged.                                                         |
| 500    | `INTERNAL`             | Anything unexpected                                                                                                     |

Example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "path": "word", "message": "Too small: expected string to have >=1 characters" },
      { "path": "language", "message": "Must be a two-letter ISO 639-1 language code" }
    ]
  }
}
```

## Types

```ts
type User = {
  id: string; // UUID
  email: string; // always lowercase
  displayName: string | null;
};

type AuthResponse = {
  token: string; // JWT
  user: User;
};

type PartOfSpeech = "noun" | "verb" | "adjective" | "adverb" | "phrase" | "other";
type Gender = "masculine" | "feminine" | "neuter";

type Example = {
  text: string; // sentence in the word's language
  translation: string; // English translation of the sentence
};

type Sense = {
  translation: string; // English meaning
  note?: string; // optional usage note, e.g. "informal"; key is absent when there is none
  examples: Example[]; // 1–3
};

type Word = {
  id: string; // UUID
  word: string; // the lemma (dictionary form), e.g. "stehen"
  sourceForm: string | null; // what the user typed if it differs from `word`, e.g. "stand"; else null
  language: string; // e.g. "de"
  targetLanguage: string; // always "en" in v1
  partOfSpeech: PartOfSpeech;
  gender: Gender | null; // mostly nouns in gendered languages
  article: string | null; // e.g. "das", "la"
  plural: string | null; // e.g. "Häuser"
  senses: Sense[]; // 1–4 when enrichmentStatus is "ok"; [] when "failed"
  notes: string | null; // user's own notes
  tags: string[]; // user's tags, may be []
  sourceUrl: string | null; // where the user found the word
  enrichmentStatus: "ok" | "failed";
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
};

type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number; // total matching items across all pages
};

type LanguageCount = { language: string; count: number };
```

Example `Word` (illustrative, as the real enricher would return it). This one was saved from the input `"Häuser"`, so `word` holds the lemma and `sourceForm` holds the typed form:

```json
{
  "id": "8ec1574b-e20b-452d-8a27-cc2e4460d2f3",
  "word": "Haus",
  "sourceForm": "Häuser",
  "language": "de",
  "targetLanguage": "en",
  "partOfSpeech": "noun",
  "gender": "neuter",
  "article": "das",
  "plural": "Häuser",
  "senses": [
    {
      "translation": "house",
      "examples": [
        { "text": "Das Haus ist sehr alt.", "translation": "The house is very old." },
        { "text": "Wir bauen ein neues Haus.", "translation": "We are building a new house." }
      ]
    },
    {
      "translation": "household, family",
      "note": "figurative",
      "examples": [
        { "text": "Sie kommt aus gutem Haus.", "translation": "She comes from a good family." }
      ]
    }
  ],
  "notes": null,
  "tags": ["news"],
  "sourceUrl": "https://example.com/article",
  "enrichmentStatus": "ok",
  "createdAt": "2026-11-24T15:15:48.560Z",
  "updatedAt": "2026-11-24T15:15:48.560Z"
}
```

## Endpoints

### Summary

| Method | Path                   | Auth | Success                          |
| ------ | ---------------------- | ---- | -------------------------------- |
| GET    | `/health`              | No   | 200 `{ ok: true }`               |
| POST   | `/auth/register`       | No   | 201 `AuthResponse`               |
| POST   | `/auth/login`          | No   | 200 `AuthResponse`               |
| GET    | `/auth/me`             | Yes  | 200 `{ user: User }`             |
| POST   | `/words`               | Yes  | 201 `Word` or 200 duplicate      |
| GET    | `/words`               | Yes  | 200 `Paginated<Word>`            |
| GET    | `/words/:id`           | Yes  | 200 `Word`                       |
| PATCH  | `/words/:id`           | Yes  | 200 `Word`                       |
| POST   | `/words/:id/re-enrich` | Yes  | 200 `Word`                       |
| DELETE | `/words/:id`           | Yes  | 204, no body                     |
| DELETE | `/words`               | Yes  | 200 `{ deleted: number }`        |
| GET    | `/study/batch`         | Yes  | 200 `{ items: Word[] }`          |
| GET    | `/languages`           | Yes  | 200 `{ items: LanguageCount[] }` |

All words endpoints return `404 NOT_FOUND` for a word id that doesn't exist or belongs to someone else, and `400 VALIDATION_ERROR` for an id that isn't a UUID.

---

### `GET /health`

Returns `200 { "ok": true }`. No auth required.

---

### `POST /auth/register`

Creates an account and logs the user in.

Body:

| Field         | Type   | Required | Rules                                              |
| ------------- | ------ | -------- | -------------------------------------------------- |
| `email`       | string | Yes      | Valid email. Trimmed and lowercased before saving. |
| `password`    | string | Yes      | 8–256 characters                                   |
| `displayName` | string | No       | 1–100 characters after trimming                    |

Response: `201 AuthResponse`.

Errors: `400 VALIDATION_ERROR` (e.g. `"Password must be at least 8 characters"`), `409 EMAIL_TAKEN`, `429 RATE_LIMITED`.

---

### `POST /auth/login`

Body: `{ "email": string, "password": string }`

Response: `200 AuthResponse`.

Errors: `401 UNAUTHORIZED` with `"Invalid email or password"`. The same error is used for an unknown email and a wrong password. Also `400 VALIDATION_ERROR` and `429 RATE_LIMITED`.

---

### `GET /auth/me`

Response: `200 { "user": User }`.

Errors: `401 UNAUTHORIZED`, `429 RATE_LIMITED`.

---

### `POST /words`

Adds a word. The server enriches it, which **can take several seconds** (see [Behaviour](#behaviour-the-ui-should-handle)).

Body:

| Field       | Type           | Required | Rules                                                                     |
| ----------- | -------------- | -------- | ------------------------------------------------------------------------- |
| `word`      | string         | Yes      | 1–80 characters after trimming. Can be an inflected form, e.g. `"stand"`. |
| `language`  | string         | Yes      | Supported language code                                                   |
| `sourceUrl` | string \| null | No       | Valid URL, max 2048 characters. `""` and `null` are stored as `null`.     |
| `tags`      | string[]       | No       | Max 20 tags, each 1–40 characters after trimming. Duplicates are removed. |
| `notes`     | string \| null | No       | Max 2000 characters. Empty or whitespace-only is stored as `null`.        |

Responses:

- `201 Word`: a new word was saved.
- `200 Word & { "duplicate": true }`: the user already has this lemma in this language. The response is the **existing** word, unchanged, so the `tags`, `notes` and `sourceUrl` sent with this request are **not** applied. For example, adding `"stehen"` after `"stand"` returns the existing `stehen` word.

If enrichment fails (LLM error or timeout), the word is **still saved** and returned with `201`, `enrichmentStatus: "failed"`, `senses: []`, `partOfSpeech: "other"`, `word` set to the trimmed input and `gender`, `article`, `plural` and `sourceForm` set to `null`.

Errors: `400 VALIDATION_ERROR`, `422 NOT_A_WORD`, `422 UNSUPPORTED_LANGUAGE`.

---

### `GET /words`

Lists the user's words, one page at a time.

Query parameters (all optional):

| Param      | Type   | Default     | Rules                                                                                         |
| ---------- | ------ | ----------- | --------------------------------------------------------------------------------------------- |
| `language` | string |             | Supported language code. Without it, words in all languages are returned.                     |
| `search`   | string |             | 1–80 characters. Case-insensitive substring match on `word` **or** any sense's `translation`. |
| `tag`      | string |             | 1–40 characters. Exact, case-sensitive match on one tag.                                      |
| `page`     | int    | `1`         | ≥ 1                                                                                           |
| `pageSize` | int    | `20`        | 1–100                                                                                         |
| `sort`     | enum   | `createdAt` | `createdAt` (newest first) or `word` (alphabetical, case-insensitive)                         |

`search` matches `word` (the lemma), not `sourceForm`, so searching `"stand"` won't find `stehen`.

Response: `200 Paginated<Word>`. A page past the end returns `items: []` with the real `total`.

```json
{ "items": [/* Word, … */], "page": 1, "pageSize": 20, "total": 15 }
```

Errors: `400 VALIDATION_ERROR`, `422 UNSUPPORTED_LANGUAGE`.

---

### `GET /words/:id`

Response: `200 Word`.

Errors: `400 VALIDATION_ERROR` (not a UUID), `404 NOT_FOUND`.

---

### `PATCH /words/:id`

Edits a word. Send **at least one** of the fields below. Any other field, such as `language` or `id`, is rejected with `400` (`Unrecognized key: "language"`). The language of a word can't be changed. To move a word to another language, delete it and add it again.

| Field          | Type           | Rules                                                                                                            |
| -------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `word`         | string         | 1–80 characters after trimming                                                                                   |
| `partOfSpeech` | PartOfSpeech   |                                                                                                                  |
| `gender`       | Gender \| null |                                                                                                                  |
| `article`      | string \| null | Max 20 characters. `""` becomes `null`.                                                                          |
| `plural`       | string \| null | Max 80 characters. `""` becomes `null`.                                                                          |
| `senses`       | Sense[]        | 1–4 senses, each with a non-empty `translation`, optional `note` and 1–3 examples. **Replaces the whole array.** |
| `notes`        | string \| null | Max 2000 characters. `""` becomes `null`.                                                                        |
| `tags`         | string[]       | Max 20, each 1–40 characters. **Replaces the whole array.** Duplicates are removed.                              |

Sending `senses` also sets `enrichmentStatus` to `"ok"`. This is how a user can fix a failed word by hand, and it makes the word eligible for study.

Response: `200 Word` (the updated word).

Errors: `400 VALIDATION_ERROR` (including `"No fields to update"` for `{}`), `404 NOT_FOUND`, `409 DUPLICATE_WORD` (renaming to a word the user already has in that language, case-insensitive).

---

### `POST /words/:id/re-enrich`

Runs enrichment again on the word (using `sourceForm` if there is one, else `word`), skipping the cache. On success it **overwrites** `word`, `sourceForm`, `partOfSpeech`, `gender`, `article`, `plural` and `senses`, and sets `enrichmentStatus: "ok"`. It does not change `notes`, `tags` or `sourceUrl`. Any manual edits to the overwritten fields are lost, so ask the user to confirm first if the word was edited. No body.

Response: `200 Word`.

Errors: `404 NOT_FOUND`, `409 DUPLICATE_WORD` (the new lemma matches another of the user's words), `422 NOT_A_WORD`, `502 ENRICHMENT_FAILED` (the word is left unchanged and the user can try again later).

---

### `DELETE /words/:id`

Response: `204`, empty body.

Errors: `400 VALIDATION_ERROR`, `404 NOT_FOUND`.

---

### `DELETE /words`

Deletes **all** of the user's words, in every language. This can't be undone, so the UI should ask the user to confirm first. No body or query parameters.

Response: `200 { "deleted": number }`, the number of words removed (`0` if the user had none).

Errors: `401 UNAUTHORIZED`.

---

### `GET /study/batch`

Returns up to `limit` random words in one language for a flashcard session. Only words with `enrichmentStatus: "ok"` are included.

| Param      | Type   | Required | Default | Rules                   |
| ---------- | ------ | -------- | ------- | ----------------------- |
| `language` | string | Yes      |         | Supported language code |
| `limit`    | int    | No       | `10`    | 1–50                    |

Response: `200 { "items": Word[] }`. It may contain fewer than `limit` words, or none. Each call returns a new random selection, so the same word can appear in consecutive batches.

Errors: `400 VALIDATION_ERROR` (missing `language`), `422 UNSUPPORTED_LANGUAGE`.

---

### `GET /languages`

The languages the user has words in, with counts, most words first (ties sorted by code). Counts include failed words. A new user gets `items: []`.

Response:

```json
{
  "items": [
    { "language": "de", "count": 15 },
    { "language": "fr", "count": 3 }
  ]
}
```

## Behaviour the UI should handle

- **Adding a word is slow on a cache miss.** With the real LLM enricher, each attempt has a 15-second timeout and one retry, so in the worst case `POST /words` and `POST /words/:id/re-enrich` can take around 30 seconds. Show a pending state and don't block the rest of the UI. Words that any user has added before are cached on the server and return almost instantly.
- **The saved word may differ from what was typed.** The server saves the lemma. Typing `"stand"` saves `word: "stehen"` with `sourceForm: "stand"`. Show the user what was saved, e.g. "Saved **stehen** (you typed _stand_)".
- **Duplicates are not errors on create.** A `200` with `duplicate: true` means "you already have this". Show the existing word (and maybe link to it) rather than an error.
- **Failed enrichment.** A word with `enrichmentStatus: "failed"` has no senses and is left out of study batches. Mark it in lists and offer two fixes: **Retry** (`POST /words/:id/re-enrich`) or **Add meanings by hand** (`PATCH` with `senses`).
- **Not a word.** `422 NOT_A_WORD` on create means nothing was saved. Treat it as an inline form error ("Check the spelling").
- **Grammar fields are often null.** `gender`, `article` and `plural` mostly apply to nouns, and not every language uses all three. Hide empty fields rather than showing "null".
- **Display a noun with its article** when there is one: `das Haus`, plural `Häuser`.
- **Flashcards.** A natural card shows `article` + `word` (plus `sourceForm` if any) on the front and the senses' translations with examples on the back. Each example's `translation` can be shown on demand.
- **Ownership.** Another user's word id returns `404`, the same as a missing one.

## Gaps and things the API does not do

Design around these, or flag them as needed backend work:

- **No supported-languages endpoint.** The default list is `de, fr, es, it, nl, pt`. Hard-code it in the client for now and treat `422 UNSUPPORTED_LANGUAGE` as the source of truth. `GET /languages` lists only the languages the user already has words in.
- **No spaced repetition or progress tracking.** Study batches are random. There is no endpoint to record answers, so any score or session state is client-side only.
- **No tag list endpoint.** To suggest existing tags, collect them from words the client has loaded.
- **No account management.** There is no profile update, password change or reset, account deletion, refresh token or logout.
- **Few bulk operations.** Words are added and edited one at a time. The only bulk action is deleting all of a user's words (`DELETE /words`); there is no delete-by-language or delete-selected.
- **No cursor pagination.** Use `page` and `pageSize`. `total` lets you compute the page count: `ceil(total / pageSize)`.

## Local development notes

- Run the backend with `npm run dev`. It listens on `http://localhost:3000/api/v1`. The frontend dev server should run on `http://localhost:5173` (Vite's default) to pass CORS, or change `CORS_ORIGIN` in the backend's `.env`.
- `npm run db:seed` creates a demo account, `demo@example.com` / `demo-password`, with 15 German words.
- By default the backend uses a **mock enricher** that returns instantly and doesn't call an LLM. Its output looks like `"[mock] Haus"` and `"[mock] Ein Beispiel mit Haus."`. It knows a few inflected forms (`stand` → `stehen`, `ging` → `gehen`, `Häuser` → `Haus`) for testing the lemma display, and treats `xxinvalid` as not a word, for testing `422 NOT_A_WORD`.
