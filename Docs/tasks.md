# Job List Fetcher — Tasks

## agent-a

### Infrastructure Setup

1. **Set up monorepo structure**
   - Create `apps/web/`, `apps/api/`, `packages/domain/`, `packages/source-adapters/`, `packages/database/`, `packages/test-utils/` directories
   - Configure workspaces in root `package.json`

2. **Configure linting and formatting**
   - ESLint config following project's TypeScript conventions
   - Prettier config with consistent quoting, trailing commas, and 2-space indentation
   - Husky pre-commit hooks for lint/staged files

3. **CI pipeline**
   - GitHub Actions workflow: run lints, type check, unit tests on PRs
   - Matrix: Node LTS stable versions

4. **Base configuration validation**
   - Runtime config schema (Zod or equivalent) for `.env` variables and deployment configs
   - Provide `.env.example` with ONLY placeholder values

5. **Docker local dev**
   - `docker-compose.yml` with app service + SQLite volume
   - Local run instructions in the root README

### Database

6. **Schema design and migrations**
   - Migration system initialized (e.g., Prisma, Drizzle, Kysely)
   - Migrations for: `JobOpening`, `SourceRecord`, `CanonicalKey` index, `IngestionRun`
   - Verify migrations run cleanly on empty DB and upgrade dev DB

---

## agent-b

### Core Domain Logic

7. **Canonical domain model**
   - Implement TypeScript types matching the spec's `JobOpening`, `SourceRecord`, `CanonicalKey`, and `IngestionRun`
   - Runtime validation (Zod schemas) for external inputs at every boundary

8. **Location matching service**
   - Case-insensitive, accent-insensitive matching for `Gothenburg` / `Göteborg`
   - Whitespace normalization
   - Unit-tested with variants: "gothenburg", "GÖTEBORG", " go the borg ", etc.

9. **Deadline/status eligibility service**
   - Include active jobs or jobs with deadline up to 7 days in the past (Europe/Stockholm)
   - Include jobs with deadlines today or in the future
   - Exclude closed jobs regardless of deadline
   - Use deterministic clocks for testing; test boundary at exactly ±7 days

10. **Deduplication service**
    - Exact match: `sourceName + sourceJobId` and canonical application URL normalization
    - Candidate match: normalized title + company + location within publication window
    - Preserve both records on uncertain matches; flag confidence level

### Source Adapters

11. **Cinode adapters (MVP priority)** — done; see `Docs/adr/0003-cinode-access-strategy.md`
    - Cinode has no job-ad endpoint and no location query parameter, so location is
      filtered in the domain layer like every other source
    - `cinode`: exchange credentials for a bearer token at `GET /token`, then read the
      network-requests-received and project-roles feeds; skip a feed that is not entitled
    - `cinode-market`: public board at market.cinode.com, no credentials, paginated with
      the site's own `X-Next-Cursor` contract
    - Respect rate limits, pagination, and API authentication
    - Map raw response to `SourceRecord` schema
    - Store raw payload alongside normalized data

12. **TheirStack adapter**
    - Location search (Sweden/Gothenburg)
    - Tech-keyword slug resolution where required
    - Search with restrictive filters to minimize credit usage

### Ingestion Pipeline

13. **Ingestion runner**
    - Orchestrate adapters, normalization, validation, deduplication, and persistence in order
    - Per-adapter retries with exponential backoff for transient failures
    - Idempotent: repeated runs produce no duplicate canonical jobs
    - Create `IngestionRun` record on each execution

14. **Backend API**
    - Read endpoints for the frontend (list jobs, filters, search, detail view)
    - Controlled endpoint for triggering manual ingestion runs (local mode only)
    - No secrets or credentials returned in any response body

---

## reviewer

### Testing Infrastructure

15. **Test pyramid setup**
    - Configure unit test runner (Vitest/Jest)
    - Configure integration test layer with mocked external APIs
    - Configure Playwright E2E for frontend critical paths

16. **Test factories and fixtures**
    - Generate realistic `SourceRecord` fixtures mimicking Cinode and TheirStack responses
    - Fixtures covering: duplicate jobs, expired/close status, malformed records, empty fields
    - Timezone-aware date helpers using deterministic clocks in tests

### Required Test Cases

17. **Domain rule tests**
    - Job with location `Göteborg` included
    - Job with location `Gothenburg` included
    - Case/accent/whitespace variants handled
    - Active job with no deadline included when status supports it
    - Deadline exactly 7 days in the past: INCLUDED
    - Deadline more than 7 days in the past: EXCLUDED
    - Closed job excluded regardless of deadline
    - Timezone boundary `Europe/Stockholm` correct

18. **Deduplication tests**
    - Re-running same source record produces no duplicate canonical job
    - Equivalent from two sources linked or flagged appropriately
    - Exact source identity match and URL normalization match

19. **Integration tests**
    - Source adapter HTTP behavior with mocked responses
    - Database repository queries and migrations
    - Backend API contract validation (schema, error shapes)
    - Ingestion runner idempotency under retry scenarios

20. **E2E tests (Playwright)**
    - Load jobs list: visible loading, empty, and failure states
    - Filter by source, location, employment type, seniority
    - Open job detail view; inspect source link opens in new tab
    - Search by title/keyword returns expected subset

---

## conflicts

These tasks have dependencies that prevent safe parallelization. Resolve them in order:

| Depends On           | Blocking Task                                                                   | Reason                                                                                |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| #4 → #6, #10         | Base config validation must exist before schema design and adapter work         | Adapters need validated `.env` at startup; DB needs base config for connection string |
| #6 → #10, #13        | Schema/migrations required before adapter persistence and ingestion pipeline    | Ingestion runner writes `SourceRecord`; adapters must persist to the correct tables   |
| #10 → #13, #7(dedup) | Canonical types + deduplication logic must exist before ingestion orchestration | Pipeline orchestrates normalization and dedup across sources                          |
| #16 → #20            | Unit/integration tests require production code in place                         | E2E requires deployed API; backend endpoints needed for Playwright                    |

**Safe parallelization groups:**

- **Group A (agent-a):** Tasks #1, #2, #3, #4 can proceed in parallel.
- **Group B (agent-b):** Task #7(types), #11(Cinode adapter) can start once #6 is done; task #8(location matching) and #9(deadline logic) are independent of each other.
- **Group C (reviewer):** Tasks #15(test infra setup) can run in parallel with #6 or later tasks.
