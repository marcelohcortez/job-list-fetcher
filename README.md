# Job List Fetcher

Gothenburg IT & Business job discovery platform. Aggregates job openings from multiple sources, deduplicates them into canonical JobOpenings, and serves them through a local-first API.

## Repository layout

Monorepo with npm workspaces:

- `apps/api` — Hono API, ingestion runner, manual run trigger
- `apps/web` — React + Vite frontend: job list with original-post links, a refresh button, and a CV-matching tab
- `packages/domain` — canonical types, location matcher, deadline filter, deduplication
- `packages/cv-match` — CV text tokenizer, skill-phrase extraction and relevance scoring
- `packages/source-adapters` — JobTech Dev, Greenhouse, Lever, TheirStack and Cinode adapters
- `packages/database` — Kysely schema, migrations, repositories
- `packages/config` — runtime env validation (Zod)
- `packages/test-utils` — fixtures and factories for tests

## Requirements

- Node.js 20+
- npm 10+

## Getting started

> Note: the repository has **no git remote configured and no commits yet** — before anyone else can clone it, you must `git add`/`git commit` and push it to your own hosted repository (GitHub, GitLab, …). The instructions below then apply:

```bash
git clone <your-repo-url>
cd job-list-fetcher

npm install
cp .env.example .env   # all keys are optional

# run the API (http://localhost:3000)
npm run dev

# run the frontend (http://localhost:5173, proxies /jobs, /ingestion, /cv to the API)
npm run web
```

Run `npm run web` in a second terminal tab alongside the API. Typecheck, tests and lint: `npm test`, `npm run typecheck`, `npm run lint`.

## Sources

| Source                               | Key required               | Notes                                                                                                                                        |
| ------------------------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **JobTech Dev** (Arbetsförmedlingen) | No                         | Default source. Public Swedish job search; returns postings from **all employers**, filtered by municipality code + free-text title queries. |
| **Greenhouse**                       | No                         | Public Job Board API; ~34 verified board slugs (Nordics, European, remote-heavy employers).                                                  |
| **Lever**                            | No                         | Public Postings API (global + EU instances); ~24 verified board slugs.                                                                       |
| TheirStack                           | Yes (`THEIRSTACK_API_KEY`) | Enabled only when a key is set.                                                                                                              |
| Cinode                               | Yes (`CINODE_API_KEY`)     | Adapter available but not wired in; Cinode's REST API is a paid feature.                                                                     |

Greenhouse and Lever boards are configured with `GREENHOUSE_BOARDS` / `LEVER_BOARDS` (comma-separated slugs, e.g. `wolt,truecaller`); when unset, the built-in verified board lists in `packages/source-adapters/src/boards.ts` are used. All sources are then filtered by job title + location, not employer.

## Configuration

Everything is configured through `.env` (copy from `.env.example`). All values are optional — the app runs out-of-the-box keyless:

| Variable                    | Default           | Purpose                                                                                                                |
| --------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `3000`            | API port.                                                                                                              |
| `DATABASE_PATH`             | `./data/jobs.db`  | SQLite file location. Relative paths resolve from `apps/api` when run via `npm run dev`, i.e. `apps/api/data/jobs.db`. |
| `JOBTECH_QUERIES`           | built-in set      | Comma-separated JobTech Dev title queries.                                                                             |
| `JOBTECH_MUNICIPALITY_CODE` | `1480` (Göteborg) | JobTech municipality code filtering all JobTech postings.                                                              |
| `GREENHOUSE_BOARDS`         | built-in 34 slugs | Comma-separated Greenhouse board slugs to fetch.                                                                       |
| `LEVER_BOARDS`              | built-in 24 slugs | Comma-separated Lever board slugs to fetch.                                                                            |
| `THEIRSTACK_API_KEY`        | unset             | Enables the TheirStack source when set.                                                                                |
| `CINODE_API_KEY`            | unset             | Cinode adapter exists but is not wired in.                                                                             |

## Customizing

- **Change the companies you track** — the easiest way is env vars: `GREENHOUSE_BOARDS=klarna,veriff`, `LEVER_BOARDS=spotify` etc. To make a company permanent for everyone, add/remove slugs in `DEFAULT_GREENHOUSE_BOARDS` / `DEFAULT_LEVER_BOARDS` inside `packages/source-adapters/src/boards.ts`. Board slugs come from the company's ATS: Greenhouse boards live at `https://boards.greenhouse.io/<slug>` and Lever at `https://jobs.lever.co/<slug>`.
- **Change the job titles** — edit the `TARGET_ROLES` vocabulary in `packages/domain/src/target-roles.ts` (add or remove exact role phrases). Matching is word-boundary aware, so `Software Engineer` matches "Senior Software Engineer" but not "Software Engineering Manager", and compound spellings are equalized. See "Target profile" below.
- **Change the location scope** — location rules and the non-EMEA remote denylist live in `packages/domain/src/target-filter.ts` (`matchesTargetLocation` / `NON_EMEA_LOCATION_RE`).
- **Change where JobTech looks** — set `JOBTECH_QUERIES` and `JOBTECH_MUNICIPALITY_CODE` (e.g. `0180` for Stockholm or `1280` for Malmö). Municipality codes are Swedish SCB codes.
- **Reset stored data** — all data (listings, marks, CV) lives in the SQLite file at `DATABASE_PATH`. Stop the API, delete the file, and the next `npm run dev` recreates an empty database.

## Target profile

At ingestion, every listing must pass the scope filter to be stored:

- **Title** — must match the declared role vocabulary (`packages/domain/src/target-roles.ts`, ~130 roles: base through Head/Director levels for Full-Stack/Frontend, Tech Leads, Solutions Architects, AI/Cloud engineers, Product/Engineering managers). Matching is word-boundary aware, so `Software Engineer` matches "Senior Software Engineer" but not "Software Engineering Manager", and compound spellings are equalized (`Full-Stack` = `Full Stack` = `Fullstack`; `Front-End` = `Frontend` = `Front End`).
- **Location** — must be Gothenburg/Göteborg, a Europe/EMEA-wide posting (e.g. "Global Europe", "Global EMEA"), a bare "Remote" posting, or a remote role tied to an explicitly European location (e.g. "Remote - Germany"). Remote roles tied to non-European regions (US, Canada, APAC, …) are rejected.

Listings outside the profile are recorded as rejected in the ingestion run.

## Local development

```bash
npm test
npm run typecheck
npm run lint
npm run format:check

npm run dev   # API on http://localhost:3000
npm run web   # frontend on http://localhost:5173
```

The API boots keyless and can immediately ingest real listings from JobTech Dev (Göteborg), Greenhouse and Lever (Gothenburg + remote/EMEA). A full run covers ~8,000 listings and typically stores a few hundred within the target profile. Ingestion is deduplicated by canonical key (Title + Company + Location) and by source record, so repeated runs never duplicate already-fetched jobs — unchanged listings are counted as `deduplicated`, not re-written.

## Docker local dev

```bash
npm run docker:up
```

Starts the API on `http://localhost:3000` with the SQLite database persisted in a Docker volume.

## API

- `GET /health`
- `GET /jobs` — list with `source`, `location`, `status`, `employmentType`, `seniority`, `query`, `limit`, `offset` filters. Each item includes `userMark`
- `GET /jobs/:id` — detail including `sourceRecords` and `userMark`
- `GET /jobs/search?query=...` — keyword search
- `PUT /jobs/:id/mark` — set `{ "mark": "applied" | "not_interested" | null }` (null clears)
- `POST /ingestion/run` — manual ingestion run
- `GET /ingestion/runs` — past ingestion runs
- `GET /cv` — current CV profile summary (404 until one is uploaded)
- `POST /cv` — multipart PDF upload (`cv` field, `application/pdf`, ≤ 10 MB); extracts text and stores the profile
- `DELETE /cv` — remove the stored CV
- `GET /cv/matches` — job openings scored against the CV (score, matched terms/phrases); 404 when no CV is set

No provider credentials or secrets are ever returned by the API.

## CV matching

Upload your CV as a PDF in the **CV matches** tab. Text is extracted server-side (`pdf-parse`), and the `cv-match` package scores every active opening by overlapping CV terms and skill phrases against the job title and description — title hits weigh more, and terms mentioned repeatedly in the CV weigh more. The result is a **separate** list sorted by relevance, leaving the main All jobs listing untouched. The PDF and its extracted text live in the same local SQLite database, so they are covered by the same `.gitignore`/`.dockerignore` guarantees below.

## User marks

The frontend lets you mark a job as **applied** or **not interested** (click again to clear). Marks are stored in the app's local SQLite database (`apps/api/data/jobs.db`) and survive restarts. Both the database and the ingested job listings are excluded from version control — `.gitignore` ignores `data/` and `*.db`, and `.dockerignore` keeps the runtime volume image-safe, so no listings or marks are ever pushed to git.
