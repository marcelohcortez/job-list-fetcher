# Job List Fetcher

Gothenburg IT & Business job discovery platform. Aggregates job openings from multiple sources, deduplicates them into canonical JobOpenings, and serves them through a local-first API.

For a full walkthrough of how a candidate gets matched to a job — every stage of the pipeline, and which file to edit to change each one — see [Docs/matching_pipeline.md](Docs/matching_pipeline.md).

## Repository layout

Monorepo with npm workspaces:

- `apps/api` — Hono API, ingestion runner, manual run trigger
- `apps/web` — React + Vite frontend: job list with original-post links, a refresh button, and CV upload/matching tabs
- `packages/domain` — canonical types, location matcher, deadline filter, deduplication
- `packages/semantic-match` — local Ollama + Chroma pipeline: sanitizes job ads/CVs into a shared schema, embeds them, and matches candidates to openings by vector similarity
- `packages/source-adapters` — JobTech Dev, Greenhouse, Lever, TheirStack, Cinode Market and Cinode API adapters
- `packages/database` — Kysely schema, migrations, repositories
- `packages/config` — runtime env validation (Zod)
- `packages/test-utils` — fixtures and factories for tests

## Requirements

- Node.js 20+
- npm 10+

## Getting started

```bash
git clone https://github.com/marcelohcortez/job-list-fetcher.git
cd job-list-fetcher

npm install
cp .env.example .env   # every key is optional; the app runs keyless
```

The app is two processes. Start each in its own terminal:

```bash
# terminal 1 — API on http://localhost:4000
npm run dev

# terminal 2 — frontend on http://localhost:4001
npm run web
```

Then open **http://localhost:4001**. The frontend proxies `/api/*` to the API on port 4000, so the API must be running for the page to show anything.

The **Upload CV**, **Upload CVs** and **Matches** tabs need a local Ollama and Chroma running (see "Local semantic matching" below) — the **Openings** tab and ingestion work without them. Run Ollama natively on the host, not in Docker — a containerized (CPU-only) Ollama is ~15x slower (see "Docker local dev").

Nothing is ingested at startup. Press **Refresh** in the UI (or `curl -X POST http://localhost:4000/api/ingestion/run`) to run the sources and populate the list; the first run takes a couple of minutes.

If you change `PORT`, update `server.proxy` in `apps/web/vite.config.ts` to match — the proxy targets port 4000 by default.

Typecheck, tests and lint: `npm test`, `npm run typecheck`, `npm run lint`.

## Sources

| Source                               | Key required               | Notes                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **JobTech Dev** (Arbetsförmedlingen) | No                         | Default source. Public Swedish job search; returns postings from **all employers**, filtered by municipality code + free-text title queries.                                                                                                                                                                                                                                                             |
| **Greenhouse**                       | No                         | Public Job Board API; ~34 verified board slugs (Nordics, European, remote-heavy employers).                                                                                                                                                                                                                                                                                                              |
| **Lever**                            | No                         | Public Postings API (global + EU instances); ~24 verified board slugs.                                                                                                                                                                                                                                                                                                                                   |
| TheirStack                           | Yes (`THEIRSTACK_API_KEY`) | Enabled only when a key is set.                                                                                                                                                                                                                                                                                                                                                                          |
| **Cinode Market**                    | No                         | Public assignment board at market.cinode.com. Scraped from the same HTML the site's own "load more" uses; no credentials needed. Toggle with `CINODE_MARKET_ENABLED`.                                                                                                                                                                                                                                    |

Greenhouse and Lever boards are configured with `GREENHOUSE_BOARDS` / `LEVER_BOARDS` (comma-separated slugs, e.g. `wolt,truecaller`); when unset, the built-in verified board lists in `packages/source-adapters/src/boards.ts` are used. All sources are then filtered by job title + location, not employer.

## Cinode

**Cinode Market** (`cinode-market`) is the public assignment board at [market.cinode.com](https://market.cinode.com), where consultancies announce open assignments. It needs no credentials and is **on by default**. There is no documented API, so the adapter reads the same HTML the site's own "load more" button does — the list returns a card fragment for an `X-Requested-With: XMLHttpRequest` request and hands back the next page's cursor in an `X-Next-Cursor` response header. Being HTML, this is the most fragile source in the repo: a restyle of the card markup stops it parsing, which shows up as zero listings rather than an error, so the adapter logs a warning when the first page yields no cards. `packages/source-adapters/test/cinode-market.test.ts` pins the markup it expects.

This is the only Cinode integration in the repo; the credentialed private-API adapter was removed as unneeded.

## Configuration

Everything is configured through `.env` (copy from `.env.example`). All values are optional — the app runs out-of-the-box keyless:

| Variable                    | Default           | Purpose                                                                                                                |
| --------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `4000`            | API port.                                                                                                              |
| `DATABASE_PATH`             | `./data/jobs.db`  | SQLite file location. Relative paths resolve from `apps/api` when run via `npm run dev`, i.e. `apps/api/data/jobs.db`. |
| `JOBTECH_QUERIES`           | built-in set      | Comma-separated JobTech Dev title queries.                                                                             |
| `JOBTECH_MUNICIPALITY_CODE` | `1480` (Göteborg) | JobTech municipality code filtering all JobTech postings.                                                              |
| `GREENHOUSE_BOARDS`         | built-in 34 slugs | Comma-separated Greenhouse board slugs to fetch.                                                                       |
| `LEVER_BOARDS`              | built-in 24 slugs | Comma-separated Lever board slugs to fetch.                                                                            |
| `THEIRSTACK_API_KEY`        | unset             | Enables the TheirStack source when set.                                                                                |
| `CINODE_MARKET_ENABLED`     | `true`            | Set to `false` to disable the public Cinode Market source.                                                             |
| `OLLAMA_HOST`               | `http://localhost:11434` | Local Ollama server used for sanitizing and embedding. Point this at a **natively installed** Ollama, not a containerized one — see "Local semantic matching".                                                          |
| `OLLAMA_CHAT_MODEL`         | `qwen2.5:7b`      | Model used to sanitize job ads/CVs into structured JSON.                                                               |
| `OLLAMA_EMBED_MODEL`        | `nomic-embed-text`| Model used to embed the sanitized anchor text.                                                                         |
| `CHROMA_HOST`               | `localhost`       | Local Chroma server host.                                                                                              |
| `CHROMA_PORT`                | `8000`            | Local Chroma server port.                                                                                              |
| `MATCH_TOP_K`               | unset (no limit)  | Max jobs the vector search considers per candidate before scoring/filtering. Unset means every stored job is considered. |
| `MATCH_MIN_SIMILARITY`      | `0.65`            | Minimum blended match score (0-1, skill coverage + semantic similarity) for a job to count as a match — see [Docs/matching_pipeline.md](Docs/matching_pipeline.md). |
| `ROLE_MATCH_MIN_SIMILARITY` | `0.85`            | Minimum cosine similarity (0-1) for the vector fallback that accepts a job title close to a known role phrase — see "Target profile" below. |
| `SKILL_MATCH_MIN_SIMILARITY`| `0.82`            | Minimum cosine similarity (0-1) for folding a raw extracted skill string into an existing canonical skill instead of minting a new one — see [ADR 0009](Docs/adr/0009-skill-taxonomy-and-weighted-matching.md). |
| `SKILL_OVERLAP_WEIGHT`      | `0.6`             | Weight (0-1) given to required-skill coverage in the match score; the rest goes to whole-document embedding similarity. |
| `ROLE_MISMATCH_PENALTY`     | `0.5`             | Multiplier applied to the match score when the job's and candidate's role categories are both known and incompatible (e.g. a designer CV against a product-manager job) — see [ADR 0012](Docs/adr/0012-candidate-role-category-and-mismatch-penalty.md). |
| `NO_REQUIRED_SKILLS_PENALTY`| `0.75`            | Multiplier applied to the match score when a job has zero extracted required skills, so scoring falls back to semantic similarity alone. |
| `OLLAMA_NUM_CTX`            | `8192`            | Context window (prompt + response, in tokens) for every Ollama call — see "Tuning Ollama's context/output limits" below. |
| `OLLAMA_NUM_PREDICT`        | `-1`              | Max tokens generated per Ollama call. `-1` is unbounded (Ollama's own default) — see "Tuning Ollama's context/output limits" below. |

## Customizing

- **Change the companies you track** — the easiest way is env vars: `GREENHOUSE_BOARDS=klarna,veriff`, `LEVER_BOARDS=spotify` etc. To make a company permanent for everyone, add/remove slugs in `DEFAULT_GREENHOUSE_BOARDS` / `DEFAULT_LEVER_BOARDS` inside `packages/source-adapters/src/boards.ts`. Board slugs come from the company's ATS: Greenhouse boards live at `https://boards.greenhouse.io/<slug>` and Lever at `https://jobs.lever.co/<slug>`.
- **Change the job titles** — edit the `TARGET_ROLES` vocabulary in `packages/domain/src/target-roles.ts` (add or remove exact role phrases). Matching is word-boundary aware, so `Software Engineer` matches "Senior Software Engineer" but not "Software Engineering Manager", and compound spellings are equalized. The list includes a curated set of Swedish equivalents (`Systemutvecklare`, `Mjukvaruutvecklare`, …) for boards that post in Swedish — see [ADR 0011](Docs/adr/0011-swedish-target-roles-seed.md). See "Target profile" below.
- **Change the location scope** — location rules and the non-EMEA remote denylist live in `packages/domain/src/target-filter.ts` (`matchesTargetLocation` / `NON_EMEA_LOCATION_RE`).
- **Change where JobTech looks** — set `JOBTECH_QUERIES` and `JOBTECH_MUNICIPALITY_CODE` (e.g. `0180` for Stockholm or `1280` for Malmö). Municipality codes are Swedish SCB codes.
- **Reset stored data** — listings, marks and candidates live in the SQLite file at `DATABASE_PATH`; stop the API, delete the file, and the next `npm run dev` recreates an empty database. Embedded vectors live separately in Chroma — `docker compose down -v` (or deleting the `chroma_data` volume) clears those.
- **Change match strictness** — `MATCH_TOP_K` and `MATCH_MIN_SIMILARITY` control how many/how close matches the Matches tab shows. `SKILL_OVERLAP_WEIGHT` controls how much of that score is required-skill coverage vs. whole-document similarity — see [Docs/matching_pipeline.md](Docs/matching_pipeline.md) for the full scoring breakdown, or [ADR 0009](Docs/adr/0009-skill-taxonomy-and-weighted-matching.md) for why it's designed this way.
- **Change which skills should count as similar/interchangeable** — edit `SKILL_RELATION_SEEDS` in `apps/api/src/skill-relations-seed.ts` (e.g. "Stakeholder Management" satisfying a "Customer-facing Experience" requirement). This is a small, hand-curated list, not something inferred automatically — see [ADR 0010](Docs/adr/0010-curated-skill-relations-and-umbrella-categories.md) for why.

## Target profile

At ingestion, every listing must pass the scope filter to be stored:

- **Title** — must match the declared role vocabulary (`packages/domain/src/target-roles.ts`, 209 roles: base through Head/Director levels for Full-Stack/Frontend, Tech Leads, Solutions Architects, AI/Cloud engineers, Data/ML engineers, Product/Engineering managers, plus a curated set of Swedish equivalents — `Systemutvecklare`, `Mjukvaruutvecklare`, `Lösningsarkitekt`, etc., and two bare generic-suffix entries (`Utvecklare`, `Konsult`) that match any hyphenated compound ending in them (e.g. "PHP-utvecklare") — for boards that post in Swedish, see [ADR 0011](Docs/adr/0011-swedish-target-roles-seed.md)). Matching is word-boundary aware, so `Software Engineer` matches "Senior Software Engineer" but not "Software Engineering Manager", and compound spellings are equalized (`Full-Stack` = `Full Stack` = `Fullstack`; `Front-End` = `Frontend` = `Front End`).

  A title that fails the exact match falls back to a vector check (see [ADR 0006](Docs/adr/0006-vector-role-scope-and-candidate-dedup.md), `apps/api/src/role-scope.ts`): the title is embedded and compared against the `target_role_phrases` collection (seeded from `TARGET_ROLES`, one phrase per row in the SQLite table of the same name). A hit at ≥ `ROLE_MATCH_MIN_SIMILARITY` (default `0.85`) accepts titles that are close variants of a known role but phrased differently (e.g. "Senior Fullstack Engineer II") — and folds that exact title back into `target_role_phrases` as a `learned` phrase, so the vocabulary grows from real postings without a code change. This fallback needs Ollama reachable; if it's down, only the exact regex match applies. In practice, this fallback alone did not bridge English↔Swedish at the default threshold — no Swedish title ever cleared it until Swedish anchor phrases were added to `TARGET_ROLES` directly (ADR 0011); it still handles phrasing variants within a language well.
- **Location** — must be Gothenburg/Göteborg, a Europe/EMEA-wide posting (e.g. "Global Europe", "Global EMEA"), a bare "Remote" posting, or a remote role tied to an explicitly European location (e.g. "Remote - Germany"). Remote roles tied to non-European regions (US, Canada, APAC, …) are rejected.

  A listing with no location at all is rejected, so adapters must report one. Partly remote roles ("Stockholm, 40% remote") report their city only — they still require presence there, and reporting them as remote would let any city through on the strength of the word alone.

Listings outside the profile are recorded as rejected in the ingestion run.

## Retargeting: different roles, different locations

Everything about *what counts as a match* — job titles and location — is code, not config, deliberately (see "Target profile" above): there's no env var for "only show Stockholm jobs" because the filter logic itself (which cities/regions count, which title phrasings count) has to change, not just a value passed into it. Retargeting the whole platform for a different role or city means editing these files directly, then restarting the API so it picks up the change (`npm run dev` is not a watch process — kill and re-run it after editing `packages/*`).

**1. Job titles — `packages/domain/src/target-roles.ts` (`TARGET_ROLES`)**

This is a flat array of exact-ish role phrases. Add a phrase to start accepting it, remove one to stop:

```ts
export const TARGET_ROLES: readonly string[] = [
  'Software Engineer',
  'Senior Software Engineer',
  // add your own, e.g.:
  'DevOps Engineer',
  'Site Reliability Engineer',
];
```

Matching is case-insensitive and word-boundary aware (`Software Engineer` matches "Senior Software Engineer" but not "Software Engineering Manager"), and common compound spellings are equalized (`Full-Stack` = `Full Stack` = `Fullstack`). You don't need every tense/seniority variant — a title that's a close-but-not-exact match to one of these phrases (e.g. "Senior Fullstack Engineer II") is still caught by a vector-similarity fallback seeded from this same list (`ROLE_MATCH_MIN_SIMILARITY`, see "Target profile" above and [ADR 0006](Docs/adr/0006-vector-role-scope-and-candidate-dedup.md)) — but that fallback only bridges *phrasing*, not *language*. If a source posts in a language other than English, add real phrases in that language too (see the Swedish entries already in the file and [ADR 0011](Docs/adr/0011-swedish-target-roles-seed.md)) — a foreign-language title needs its own anchor phrase; the vector fallback alone won't translate for you.

**2. Location — `packages/domain/src/target-filter.ts` (`matchesTargetLocation`)**

This is hardcoded to Gothenburg + Europe/EMEA-wide + Europe-tied-remote, unlike `JOBTECH_MUNICIPALITY_CODE` (below) which is a real env var. To retarget to a different city, edit the function directly:

```ts
export function matchesTargetLocation(location: string): boolean {
  const normalized = normalizeLocation(location).replace(/\./g, '');
  if (!normalized) return false;
  if (/\b(gothenburg|goteborg|gbg)\b/i.test(normalized)) return true; // <- swap for your city
  // ...
}
```

For a city (e.g. London), replace the regex on that line with your city's name(s)/abbreviations. For a country- or region-wide search instead of a single city, drop the city check and rely on the existing `hasEurope`/`NON_EMEA_LOCATION_RE` logic below it, or write an equivalent allow/deny pair for your target region. `NON_EMEA_LOCATION_RE` is the denylist that keeps a bare "Remote" posting tied to a non-European country from slipping through — if you retarget outside Europe, that list needs the same treatment (invert which regions are denied).

**3. Which companies/boards get fetched**

- **Greenhouse / Lever** — env vars `GREENHOUSE_BOARDS` / `LEVER_BOARDS` (comma-separated ATS slugs, e.g. `GREENHOUSE_BOARDS=klarna,veriff`) override the built-in lists for a single run without touching code. To change the defaults everyone gets, edit `DEFAULT_GREENHOUSE_BOARDS` / `DEFAULT_LEVER_BOARDS` in `packages/source-adapters/src/boards.ts`. Slugs come from the company's ATS URL: `https://boards.greenhouse.io/<slug>`, `https://jobs.lever.co/<slug>`.
- **Teamtailor** — no env var; edit `DEFAULT_TEAMTAILOR_BOARDS` in `packages/source-adapters/src/teamtailor.ts` (`{ host: 'career.example.com', name: 'Example' }` — host is the company's Teamtailor career-site domain).
- **JobTech Dev** (Sweden-only, Arbetsförmedlingen) — `JOBTECH_QUERIES` (comma-separated free-text search terms) and `JOBTECH_MUNICIPALITY_CODE` (a Swedish SCB code, e.g. `0180` Stockholm, `1280` Malmö) are real env vars, no code change needed. This adapter has no non-Swedish equivalent in the repo.
- **Keyman**, **Cinode Market** — single-source adapters (`packages/source-adapters/src/keyman.ts`, `cinode-market.ts`), nothing to configure beyond enabling/disabling them.

A city/region retarget almost always means changing **both** #1 (titles, if you're also changing role focus) and #2 (location) — changing only the board list still leaves every fetched posting run through the Gothenburg/EMEA + `TARGET_ROLES` filter in #1/#2.

## Local development

```bash
npm test
npm run typecheck
npm run lint
npm run format:check

npm run dev   # API on http://localhost:4000
npm run web   # frontend on http://localhost:4001
```

The API boots keyless and can immediately ingest real listings from JobTech Dev (Göteborg), Greenhouse and Lever (Gothenburg + remote/EMEA). A full run covers ~8,000 listings and typically stores a few hundred within the target profile. Ingestion is deduplicated by canonical key (Title + Company + Location) and by source record, so repeated runs never duplicate already-fetched jobs — unchanged listings are counted as `deduplicated`, not re-written.

## Docker local dev

```bash
npm run docker:up
```

Starts the API and Chroma, with the SQLite database and Chroma vectors each persisted in their own Docker volume. The API is on `http://localhost:4000`.

**Ollama is not in `docker-compose.yml`** — it runs natively on the host (see "Local semantic matching" below), because Docker Desktop can't pass the host GPU (Metal on Apple Silicon) through to a Linux container: a containerized `qwen2.5:7b` was measured at ~3.5 tokens/sec (CPU-only), against ~50+ tokens/sec for the same model natively — the difference between a CV upload sanitizing in minutes versus seconds. The `app` container reaches the host's native Ollama at `http://host.docker.internal:11434` by default (works out of the box on Docker Desktop for Mac/Windows; on Linux, set `OLLAMA_HOST` in `.env` to the host's bridge/LAN IP instead).

## API

- `GET /api/health`
- `GET /api/jobs` — list with `source`, `location`, `status`, `employmentType`, `seniority`, `query`, `limit`, `offset` filters. Each item includes `userMark`
- `GET /api/jobs/:id` — detail including `sourceRecords` and `userMark`
- `GET /api/jobs/search?query=...` — keyword search
- `PUT /jobs/:id/mark` — set `{ "mark": "applied" | "not_interested" | null }` (null clears)
- `POST /api/ingestion/run` — manual ingestion run
- `GET /api/ingestion/runs` — past ingestion runs
- `GET /api/candidates` — list uploaded candidates with sanitize status
- `GET /api/candidates/:id` — single candidate detail
- `POST /api/candidates` — multipart PDF upload (`file` field, `application/pdf`, ≤ 10 MB); extracts text, then sanitizes + embeds it locally
- `POST /api/candidates/batch` — multipart upload of several PDFs at once (`files` field, repeated); processed sequentially
- `POST /api/candidates/:id/resolve-duplicate` — resolve a `status = 'duplicate'` candidate with `{ "action": "ignore" | "replace" }` (`ignore` deletes the new upload, `replace` deletes the existing candidate it collided with and promotes the new one to `sanitized`)
- `DELETE /api/candidates/:id` — remove a candidate and its stored vector
- `GET /api/matches` — every sanitized candidate with their ranked, similarity-filtered job matches
- `GET /api/matches/candidates/:id` — matches for a single candidate

No provider credentials or secrets are ever returned by the API.

## Local semantic matching (Ollama + Chroma)

**Setup** — install Ollama natively (not the Docker image) so sanitizing/embedding runs on the host GPU (Metal on Apple Silicon) instead of CPU-only emulation:

```bash
brew install ollama          # macOS; see ollama.com/download for other platforms
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

`brew services start ollama` (or just running `ollama serve`) puts it on `http://localhost:11434`, which is the `OLLAMA_HOST` default — no `.env` change needed when running the API with `npm run dev`. Chroma still needs to run in Docker: `docker compose up chroma` starts just that service (use this alongside `npm run dev`/`npm run web`); `npm run docker:up` starts the API too, and reaches the host's native Ollama automatically (see "Docker local dev" above).

Uploaded CVs and ingested job openings are both run through the same local pipeline (`packages/semantic-match`), so they end up as comparable vectors:

1. **CV-refactor** (candidates only, see [ADR 0005](Docs/adr/0005-cv-refactor-gate.md), amended by [ADR 0008](Docs/adr/0008-remove-cv-refactor-score-gate.md), [ADR 0013](Docs/adr/0013-remove-cv-refactor-rewrite-step.md) and [ADR 0014](Docs/adr/0014-restore-cv-refactor-fix-deduplication-instead.md)) — before sanitizing, a candidate's extracted text is rewritten for clarity/ATS-alignment by the local chat model without inventing facts (`packages/semantic-match/src/refactor.ts`, the headless counterpart of the interactive `.claude/skills/cv-refactor` skill). There is no quality score or rejection gate — every rewritten CV proceeds to sanitize/embed regardless of how it reads. This step is explicitly **not** where deduplication happens: it's instructed to preserve every mention of every tool/technology exactly as the CV lists it, even when the same tool repeats across several job entries (a prior version of this prompt collapsed repeats and then a downstream sanitizer bug dropped the sole survivor entirely — see ADR 0014). Deduplication happens later, at skill-canonicalization time (see "Skill taxonomy" below), which resolves each extracted skill to one canonical id in a set. The rewritten text, not the original, is what gets sanitized next.
2. **Sanitize** — a local LLM (`OLLAMA_CHAT_MODEL`, default `qwen2.5:7b`) extracts a job ad or a CV into an identical structured shape: title, **hard/technical skills only** (`requiredSkills`), soft/behavioral skills (`softSkills`, kept separate — see below), experience profile, core responsibilities. Marketing fluff, benefits and formatting noise are dropped; a CV additionally yields the candidate's name (kept as metadata only — see below).
3. **Anchor** — the structured fields are rendered back into one plain, header-labelled paragraph (`packages/semantic-match/src/anchor.ts`), *not* raw JSON — JSON punctuation degrades embedding similarity. Job ads and CVs share the exact same headers, which is what makes a candidate vector and a job vector comparable at all. The candidate's name is deliberately never included in this text, so it can't skew the match score.
4. **Embed** — the anchor text is embedded with a local embedding model (`OLLAMA_EMBED_MODEL`, default `nomic-embed-text`) and upserted into one of two Chroma collections (`job_openings`, `candidates`), both using cosine similarity. Each extracted required skill is also resolved to a canonical skill (see "Skill taxonomy" below) and linked to the job/candidate.
5. **Match** — the **Matches** tab queries the `job_openings` collection with each candidate's stored vector for the top `MATCH_TOP_K` hits (unset by default — no limit), then blends each hit's raw similarity with required-skill coverage (see [Docs/matching_pipeline.md](Docs/matching_pipeline.md)) and keeps those scoring ≥ `MATCH_MIN_SIMILARITY` (default `0.65`).

**Skill taxonomy** (see [Docs/matching_pipeline.md](Docs/matching_pipeline.md) for the full walkthrough, [ADR 0009](Docs/adr/0009-skill-taxonomy-and-weighted-matching.md) for the original design, [ADR 0010](Docs/adr/0010-curated-skill-relations-and-umbrella-categories.md) for the curated-relations addition) — a raw skill string extracted in step 2 is resolved to a canonical skill in the `skills` table/Chroma collection before it's compared: formatting is normalized first (`Front-End`/`front end`/`FRONTEND` collapse for free), then an exact lookup, then — on a miss — a vector similarity check against existing canonical skills at ≥ `SKILL_MATCH_MIN_SIMILARITY` (default `0.82`). This is what folds synonyms, abbreviations, cross-language spellings, and duplicate mentions of the same tool (this is *the* deduplication point in the pipeline — see step 1 above) onto the same skill without a hand-maintained synonym table, the same self-growing pattern `target_role_phrases` uses for job titles. At match time, a job-required skill the candidate doesn't hold exactly can still earn partial/full credit via a small hand-curated `skill_relations` table (`apps/api/src/skill-relations-seed.ts`) — e.g. "Stakeholder Management" satisfying a "Customer-facing Experience" requirement. The match score is `SKILL_OVERLAP_WEIGHT * skillCoverage + (1 - SKILL_OVERLAP_WEIGHT) * semanticSimilarity`; a job with no extracted required skills falls back to pure semantic similarity.

Job openings are sanitized and embedded automatically right after each ingestion run stores them — a bad or unreachable LLM call marks that job's embedding as `failed` (see `job_embeddings` table) and logs a warning, without failing the whole ingestion run. Candidates are sanitized inline when uploaded via **Upload CV** or **Upload CVs**; a failed one keeps its `pending`/`failed` status visible in the upload tabs rather than silently dropping it.

**Tuning Ollama's context/output limits** (`OLLAMA_NUM_CTX`, `OLLAMA_NUM_PREDICT`) — every `client.chat()`/`embed()` call in this pipeline (`packages/semantic-match/src/ollama.ts`, `refactor.ts`) passes these two through as `options.num_ctx` / `options.num_predict`, the same knobs a tool like opencode exposes per-model in its own config file. There's no separate config file here — this project calls the `ollama` npm client directly from its own TypeScript, so the two env vars below (wired via `packages/config`, `apps/api/src/index.ts`) *are* that config, applied to every request:

| Env var | Ollama option | What it bounds | Default |
| --- | --- | --- | --- |
| `OLLAMA_NUM_CTX` | `num_ctx` | Context window — prompt + generated response, in tokens | `8192` |
| `OLLAMA_NUM_PREDICT` | `num_predict` | Max tokens *generated* in one response | `-1` (unbounded — matches Ollama's own default) |

Without these, a long CV/job ad (prompt + rewrite/JSON output together exceeding the ceiling, roughly 6,000+ words at the `8192` default) risks silent truncation, and a call that doesn't cleanly stop keeps generating at whatever tokens/sec the hardware gives (see [ADR 0007](Docs/adr/0007-native-ollama-not-containerized.md)) until it hits that ceiling — the multi-minute "hang" this pipeline could otherwise show. Adjust in `.env`:

- **Raise `OLLAMA_NUM_CTX`** (e.g. `16384`) if job ads/CVs longer than ~6,000 words start truncating. `nomic-embed-text`'s own max is a fixed `2048`, unaffected by this setting — it only ever embeds the short anchor text, never the raw CV/job text, so it's never at risk.
- **Lower `OLLAMA_NUM_PREDICT`** (e.g. `4096`) to bound worst-case latency instead of leaving generation unbounded. Trade-off: too tight a cap truncates legitimate long output — `refactorCv`'s CV rewrite is plain text, so a truncated one fails silently as bad data rather than a visible error, unlike the JSON extraction calls (`sanitizeJob`/`sanitizeCandidate`) where truncated output at least fails `JSON.parse`/a `zod` parse error. `warnIfSuspiciouslyEmpty` (`packages/semantic-match/src/pipeline.ts`) catches the most severe case (a schema-valid-but-empty extraction) but not a partially-truncated one. One value applies to every call; there's no separate per-call cap.

**Duplicate candidates** (see [ADR 0006](Docs/adr/0006-vector-role-scope-and-candidate-dedup.md)) — if a newly sanitized CV's extracted name matches an existing `sanitized` candidate's name, the new upload is stored as `status = 'duplicate'` (pointing at the existing row via `duplicate_of_id`) instead of becoming a second matchable profile. Both **Upload CV** and **Upload CVs** surface a resolution prompt for any `duplicate` candidate: **ignore** discards the new upload, **replace** deletes the existing candidate (and its vector) and promotes the new one to `sanitized`. See `POST /api/candidates/:id/resolve-duplicate` in the API section below.

Everything runs locally: no CV or job text leaves the machine (or the Docker network, if you run it via `docker compose up`).

## User marks

The frontend lets you mark a job as **applied** or **not interested** (click again to clear). Marks are stored in the app's local SQLite database (`apps/api/data/jobs.db`) and survive restarts. Both the database and the ingested job listings are excluded from version control — `.gitignore` ignores `data/` and `*.db`, and `.dockerignore` keeps the runtime volume image-safe, so no listings or marks are ever pushed to git.
