# Gothenburg IT & Business Job Discovery Platform

## 1. Project Overview

Build a job-discovery platform that consolidates relevant job openings into one searchable, reviewable interface. The project extends an earlier Devies concept initiated by Axel: reduce the need to manually check many job boards, company career pages, and social channels every day.

The initial geographic focus is **Gothenburg, Sweden**, and the initial domain focus is **IT and business-related roles**. The system must support both Swedish and English location spellings because sources may use either:

- `Göteborg`
- `Gothenburg`

The platform should collect, normalize, deduplicate, store, and display job openings from known APIs and websites. It should be designed so additional data sources can be added without rewriting core business logic.

## 2. Primary Goals

1. Run a job-discovery process at least once per day.
2. Find active or recently expired IT/business job openings relevant to Gothenburg.
3. Aggregate openings from multiple sources into a single normalized database.
4. Display the available information from each source as completely as possible.
5. Preserve provenance: every displayed job must identify its source and original URL.
6. Deduplicate the same vacancy when it appears on multiple sources.
7. Use minimal external dependencies where reasonable.
8. Build the system test-first using TDD.
9. Make it easy to run either as a hosted application or locally.

## 3. Non-Goals for the MVP

- Automatically applying to jobs.
- Sending unsolicited messages or connection requests through LinkedIn.
- Circumventing platform restrictions, authentication controls, robots.txt, rate limits, or terms of service.
- Treating social-media posts as authoritative job records when an official company/ATS application page is available.
- Building a generic nationwide or global job platform before the Gothenburg flow is reliable.

## 4. Target Users

- A person looking for IT and business roles in Gothenburg.
- Potentially, Devies colleagues who want a shared, curated overview of local opportunities.

## 5. Functional Requirements

### 5.1 Job collection

The collector must support pluggable source adapters. Each adapter is responsible for retrieving raw data from one provider and mapping it into the project’s canonical job format.

Initial source priority:

1. **Cinode** — first implementation priority.
2. **TheirStack** — optional direct API integration or optional Composio/MCP integration.
3. **jobspipe** — evaluate as an aggregator source.
4. Public company careers pages and public ATS boards.
5. Additional Sweden/Gothenburg job boards listed in the reference section.
6. Public LinkedIn posts/pages only through compliant discovery methods, such as search-engine indexing and official links; not through unauthorised scraping or unsupported LinkedIn feed access.

### 5.2 Cinode filtering rules (MVP-critical)

For Cinode, retrieve job openings matching either location term:

- `Göteborg`
- `Gothenburg`

Only include an opening when at least one of these conditions is true:

- It is marked as active/open by the source.
- Its application deadline is no more than 7 calendar days before the current date.
- Its deadline is today or in the future.
- The source provides no deadline but clearly indicates the position is still active/open.

Exclude an opening if:

- The source marks it inactive, closed, cancelled, filled, or otherwise unavailable.
- A known application deadline is more than 7 calendar days in the past.

Date interpretation must be explicit and timezone-aware. Use the `Europe/Stockholm` timezone for filtering, scheduled execution, and UI timestamps.

### 5.3 Data display

The website must show all information reasonably available from a source, including raw-source payload access where safe and useful. At minimum, display:

- Job title
- Company/employer name
- Source name
- Source job ID, if supplied
- Original listing URL
- Official application URL, if different
- Location and normalized location
- Remote/hybrid/on-site status, if known
- Employment type
- Seniority level
- Contract type and duration, if known
- Salary/rate and currency, if known
- Publication date
- Application deadline
- Active/closed/unknown status
- Job description
- Requirements/skills
- Benefits, if supplied
- Recruiter/contact details, if public and provided by the source
- Technologies/keywords
- First seen date
- Last seen date
- Last verified date
- Collection source and collection timestamp

The UI should show normalized fields by default and make source-specific/raw fields available in an expandable details panel or dedicated job-detail page.

### 5.4 Search, filtering, and review

MVP interface capabilities:

- List jobs ordered by recency, with newest/most recently verified first.
- Filter by source.
- Filter by location.
- Filter by employment type, work model, seniority, and job status when data exists.
- Search by title, company, description, and technology/keyword.
- Open the original listing and official application URL in a new tab.
- Show why a role was included, e.g. `Matched Gothenburg location`, `Active source status`, or `Deadline within grace period`.
- Mark a job as reviewed, saved, hidden, or applied-to locally. This is optional for the initial ingestion-only MVP but should be anticipated in the schema.

### 5.5 Scheduling and execution

The collection pipeline must be runnable in two modes:

1. **Hosted mode**
   - Scheduled execution at least daily.
   - A Vercel Cron Job is an acceptable option if its plan limits, execution duration, and external API needs are compatible.
   - The system must be idempotent: a repeated run must not create duplicate jobs.

2. **Local mode**
   - Manual execution via a UI button or CLI command.
   - Optional local scheduler via cron, Docker Compose, or a task runner.

Every run must create an ingestion-run record with:

- Run ID
- Start and end timestamps
- Source(s) processed
- Counts fetched, accepted, rejected, created, updated, deduplicated, and failed
- Error summaries
- Rate-limit or quota information when available

## 6. Architecture Principles

- Use a modular, adapter-based architecture.
- Keep source-specific API details isolated from domain and UI logic.
- Prefer direct, documented APIs over scraping.
- Use Composio/MCP only where it has a clear benefit over direct integration.
- Avoid unnecessary framework or vendor dependencies.
- Keep credentials exclusively in environment variables or a secrets manager.
- Design each collection source so it can be disabled without breaking the rest of the system.
- Treat external inputs as untrusted.
- Preserve the original source URL and source identity for auditability.

### 6.1 Proposed components

- **Web application:** React + Vite.
- **Backend/API:** Node.js + TypeScript preferred.
- **Database:**
  - Hosted option: Turso (SQLite/libSQL).
  - Local option: SQLite stored in a Docker-managed volume.
  - PostgreSQL may be considered later if query volume, multi-user use, or hosting needs justify it.
- **Job runner:** backend command/service invoked by Vercel Cron, a provider scheduler, Docker cron, or manually.
- **Source adapters:** one module per provider, e.g. `cinode`, `theirstack`, `jobspipe`, `company-careers`, `search-discovery`.
- **Normalization service:** maps raw source records to canonical job records.
- **Deduplication service:** detects identical or near-identical jobs across sources.
- **Observability:** structured logs, ingestion-run records, error tracking, and basic metrics.

### 6.2 Suggested repository layout

```text
apps/
  web/                  # React + Vite frontend
  api/                  # Node.js + TypeScript API and ingestion runner
packages/
  domain/               # Canonical types, business rules, validation
  source-adapters/      # Provider-specific clients and mappers
  database/             # Schema, migrations, repositories
  test-utils/           # Fixtures, mocks, factories
  config/               # Shared configuration validation
```

A monorepo is optional. A simpler single TypeScript repository is acceptable for the MVP if clear module boundaries are retained.

## 7. Canonical Data Model

The system must not force every source into an identical shape by throwing data away. It should maintain normalized fields plus a source payload.

### 7.1 Core entities

#### JobOpening

```ts
type JobOpening = {
  id: string;
  canonicalKey: string;
  title: string;
  companyName: string | null;
  description: string | null;
  requirements: string | null;
  benefits: string | null;

  locationText: string | null;
  normalizedLocation: string | null;
  countryCode: string | null;
  workModel: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  employmentType: string | null;
  seniority: string | null;
  contractType: string | null;
  contractDuration: string | null;

  salaryText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;

  publishedAt: Date | null;
  deadlineAt: Date | null;
  status: 'active' | 'expired_grace_period' | 'closed' | 'unknown';

  sourceName: string;
  sourceJobId: string | null;
  sourceUrl: string;
  applicationUrl: string | null;
  rawPayload: unknown;

  firstSeenAt: Date;
  lastSeenAt: Date;
  lastVerifiedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};
```

#### JobSourceRecord

Stores the link between a canonical job and an original record from a particular source. This supports multi-source deduplication and preserves all source-specific data.

```ts
type JobSourceRecord = {
  id: string;
  jobOpeningId: string;
  sourceName: string;
  sourceJobId: string | null;
  sourceUrl: string;
  rawPayload: unknown;
  fetchedAt: Date;
  sourcePublishedAt: Date | null;
  sourceDeadlineAt: Date | null;
  sourceStatus: string | null;
};
```

#### IngestionRun

Tracks pipeline execution, observability, failures, quotas, and result counts.

#### UserJobState

Optional initial implementation; reserve for saved/reviewed/hidden/applied user actions.

### 7.2 Deduplication approach

Deduplicate using a staged strategy:

1. Exact source identity: `sourceName + sourceJobId`.
2. Canonical application URL after URL normalization.
3. Strong exact match: normalized company + normalized title + normalized location + similar deadline/publication window.
4. Fuzzy candidate match requiring review-safe thresholds: title similarity, company similarity, location, and description fingerprint.

Never silently merge uncertain matches. Preserve both source records and flag the grouping confidence.

## 8. Source Strategy

### 8.1 Cinode — MVP source

Use the documented Cinode API. Implement a dedicated `CinodeSourceAdapter`.

Required behavior:

- Query/filter for both `Göteborg` and `Gothenburg`.
- Retrieve job status and deadline where available.
- Apply the active/deadline rule in the domain layer, not only in API query parameters.
- Store the raw source record for traceability.
- Respect rate limits, pagination, authentication requirements, and API terms.

### 8.2 TheirStack

TheirStack supports job search using posting-date or company filtering and can be refined by title, location, seniority, salary, industry, and technology.

Integration choice:

- Prefer the direct TheirStack API if the project only needs specific documented endpoints and direct API access keeps the dependency footprint lower.
- Use Composio only if it materially simplifies authentication, scheduling, tool access, or multi-agent orchestration.

Expected logical workflow:

1. Resolve `Sweden`, `Gothenburg`, and optionally `Göteborg` through location search.
2. Resolve relevant technology keywords where the API requires canonical keyword slugs.
3. Search recent jobs with restrictive date, location, title, and technology criteria.
4. Minimize result pages because job records consume credits.
5. Store source IDs, canonical source URLs, and all returned metadata.

### 8.3 jobspipe

Evaluate jobspipe as a source adapter subject to its API documentation, coverage, terms, rate limits, and quota.

Known constraints supplied for evaluation:

- 1,000 results per month.
- 2 requests per second.

Do not embed the supplied API key in code, documentation, test fixtures, client-side code, commits, logs, screenshots, or generated files. Rotate it immediately if it has been exposed in a public repository, issue tracker, screenshot, or shared AI prompt.

### 8.4 Public careers pages and ATS boards

Use official employer career pages or public ATS pages as the canonical application target whenever possible.

Potential implementation paths:

- Public APIs from providers such as Greenhouse, Lever, or Ashby where available and permitted.
- Structured data extraction from public pages, such as `JobPosting` JSON-LD.
- Targeted page extraction through a compliant third-party service only where terms and robots policies permit it.

### 8.5 LinkedIn-related discovery

Do not assume access to LinkedIn jobs or a person/company feed through an MCP. Use LinkedIn only as a supplementary discovery/enrichment channel where permitted.

Acceptable discovery pattern:

- Search-engine queries targeting publicly indexed LinkedIn post URLs, company career pages, official ATS pages, and supported job-board APIs.
- Extract the job opening from an official career/ATS URL when the LinkedIn post links to one.
- Store LinkedIn post URLs as discovery evidence, not necessarily as the canonical job record.

Example discovery query concept:

```text
site:linkedin.com/posts ("hiring" OR "we are hiring" OR "job opening")
("Gothenburg" OR "Göteborg")
("software" OR "developer" OR "IT" OR "business")
```

The application must comply with LinkedIn policies, applicable terms, rate limits, and data-protection requirements. It must not scrape authenticated feeds or bypass access controls.

### 8.6 Other candidate sources

Assess these sources for API availability, terms, robots policy, legal constraints, data quality, duplicate rate, and Gothenburg coverage before implementation:

- Silicon Valhalla (Gothenburg)
- Uptrail (IT jobs in Göteborg)
- The Hub (Gothenburg, Sweden)
- Nordic Tech Jobs (Sweden)

## 9. TDD Requirements

This project must follow **test-driven development**:

1. Write a failing test that expresses the required behavior.
2. Implement only enough production code to make the test pass.
3. Refactor while maintaining a passing test suite.
4. Do not add functionality without tests.

### 9.1 Test pyramid

- **Unit tests:** domain filtering, date logic, location matching, normalizers, URL normalization, deduplication, mapping, validation, and error handling.
- **Integration tests:** source adapter HTTP behavior using mocked provider responses, database repositories, migrations, scheduled runner, and API endpoints.
- **End-to-end tests:** React UI flows and critical user journeys using Playwright.

### 9.2 Mandatory test cases

- A Cinode job with location `Göteborg` is included.
- A Cinode job with location `Gothenburg` is included.
- Case, accent, and whitespace variants are handled appropriately.
- Active jobs are included even with no deadline, when source status supports that conclusion.
- A job with a deadline exactly 7 days in the past is included.
- A job with a deadline more than 7 days in the past is excluded.
- A job marked closed is excluded even if its deadline is recent.
- Timezone boundaries use `Europe/Stockholm` correctly.
- Re-running the same source record does not create a duplicate canonical job.
- Equivalent job postings from two sources are linked or flagged according to the deduplication confidence rules.
- External API failure does not corrupt existing data.
- Credentials are never returned by backend endpoints or displayed by the frontend.

## 10. Technology Choices

### Frontend

- React
- Vite
- TypeScript
- A lightweight accessible component/styling approach selected by the frontend agent
- Playwright for end-to-end testing

Frontend requirements:

- Semantic HTML and keyboard-accessible interactions.
- Responsive layout.
- Visible loading, empty, and failure states.
- Clear source and freshness metadata.
- No secrets, provider keys, or privileged API calls in browser code.

### Backend

Preferred stack:

- Node.js
- TypeScript
- A lightweight HTTP framework, selected after comparing Fastify, Hono, Express, or a Vite-compatible API setup
- Runtime schema validation, e.g. Zod or an equivalent
- A database layer/ORM/query builder selected for minimal complexity and robust migrations

The backend must own all provider credentials, ingestion logic, validation, filtering, normalization, scheduling triggers, and database writes.

### Database

- Hosted: Turso/libSQL is the preferred initial option.
- Local: SQLite in a persistent Docker volume.
- Use migrations from day one.
- Back up database data and ensure migrations are repeatable in development, CI, and production.

## 11. Security and Privacy Requirements

- Store secrets in environment variables or a managed secret store only.
- Never commit `.env` files or real API keys.
- Provide `.env.example` with placeholder values only.
- Rotate any key that may have been included in a public or externally shared context.
- Apply least privilege to all API keys and database credentials.
- Validate all external API responses at runtime before persistence.
- Treat job descriptions, URLs, HTML, and raw payloads as untrusted data.
- Sanitize or safely render rich content to prevent XSS.
- Restrict CORS to expected origins.
- Add rate limiting and request-size limits to public backend endpoints.
- Implement authentication before exposing personal saved/applied/review state in a hosted multi-user deployment.
- Log securely: redact secrets, authorization headers, personally identifiable information, and full sensitive payloads.
- Use dependency scanning, lockfiles, and automated security updates where practical.
- Follow source terms, copyright rules, GDPR, and data-minimization principles.

## 12. Required Agent Profiles

The project should define four specialized agents. They can collaborate, but each must have clear responsibilities and boundaries.

### 12.1 Frontend Agent

**Mission:** Build an accessible, fast, maintainable React + Vite interface for reviewing collected job openings.

**Responsibilities:**

- Implement the job list, filters, search, job-detail view, source metadata, loading states, errors, and empty states.
- Consume backend APIs; never call privileged third-party job providers directly from the browser.
- Create accessible UI behavior using semantic HTML, keyboard navigation, visible focus states, proper labels, and appropriate ARIA only when semantic HTML is insufficient.
- Ensure responsive behavior for desktop and mobile.
- Write unit/component tests before implementation where the selected frontend test stack supports it.
- Add and maintain Playwright E2E coverage for core journeys.
- Keep raw source content safe: do not inject untrusted HTML without sanitization and a documented rendering policy.

**Best practices:**

- Prefer small, composable components and explicit TypeScript types.
- Keep server/data-state logic separate from presentational components.
- Show data provenance and timestamps to avoid implying stale data is current.
- Use stable selectors for E2E tests, without making selectors the primary accessibility mechanism.
- Avoid premature design-system complexity.
- Verify typography and font fallbacks; do not assume a font is available in every environment.

**Definition of done:**

- Relevant tests pass.
- Critical paths are covered by Playwright.
- No accessibility regressions in keyboard navigation and basic automated checks.
- No secret or privileged logic appears in the client bundle.
- The UI accurately represents unknown, missing, and stale source data.

### 12.2 Backend Agent

**Mission:** Build a robust Node.js + TypeScript backend that safely collects, normalizes, deduplicates, stores, and serves job data.

**Responsibilities:**

- Design the canonical domain model and migrations.
- Implement source adapters for Cinode first, then approved sources.
- Implement collection orchestration, retries, rate-limit handling, pagination, idempotency, and ingestion-run tracking.
- Implement Gothenburg/Göteborg matching and deadline/status eligibility logic in tested domain services.
- Build read APIs for the frontend and controlled endpoints for manual ingestion runs.
- Implement source-specific validation and preserve raw payloads safely.
- Design direct API versus Composio/MCP boundaries deliberately; do not add Composio unless it offers a measurable advantage.

**Best practices:**

- Use runtime input/output validation for all API boundaries.
- Separate provider clients, domain rules, persistence, and HTTP transport.
- Use transactions for multi-record updates where appropriate.
- Make ingestion idempotent and resilient to partial failures.
- Default to least data collection and avoid storing credentials in the database.
- Use structured logs and include ingestion-run correlation IDs.
- Enforce timezone behavior explicitly with `Europe/Stockholm`.

**Definition of done:**

- Tests cover normal and failure paths.
- Migrations run cleanly on an empty database and upgrade an existing development database.
- Repeated ingestion runs do not duplicate data.
- Failures are observable without exposing secrets.
- API contracts are documented and stable enough for frontend integration.

### 12.3 Tester / QA Agent

**Mission:** Protect behavior, data quality, and regressions through a practical TDD and quality strategy.

**Responsibilities:**

- Enforce the red-green-refactor workflow.
- Convert requirements into executable acceptance criteria.
- Build fixtures representing realistic external API responses, malformed records, duplicate jobs, expired jobs, and timezone edge cases.
- Maintain unit, integration, and Playwright E2E suites.
- Verify source filtering, deadline grace-period rules, data mapping, deduplication, UI filter behavior, and retry/error behavior.
- Run regression checks before releases and document known limitations.

**Best practices:**

- Mock external providers in automated tests; do not spend API credits or use production credentials in CI tests.
- Use deterministic clocks for date-sensitive tests.
- Keep test fixtures small, intentional, and anonymized.
- Test observable behavior rather than implementation details.
- Add tests for every defect before fixing it.
- Maintain a concise test matrix mapping important requirements to test coverage.

**Definition of done:**

- All required test layers run in CI.
- Playwright covers the critical user path: load jobs, filter/search, open detail, inspect source link.
- Date and timezone boundary cases are passing.
- No known severity-high defects are released without explicit acceptance.

### 12.4 Cybersecurity Agent

**Mission:** Reduce security, privacy, and supply-chain risk without blocking a pragmatic MVP.

**Responsibilities:**

- Produce a lightweight threat model for the frontend, backend, database, scheduler, provider integrations, and deployment.
- Review secret management, authorization boundaries, data validation, CORS, logging, dependency risk, and deployment configuration.
- Define safe handling for raw job data and externally supplied HTML/URLs.
- Review any scraping/extraction design for terms, consent, rate limits, robots directives, and legal/privacy risks.
- Establish security checks in CI, including dependency and secret scanning.
- Review security-sensitive pull requests and deployment changes.

**Best practices:**

- Assume all external inputs and web content are hostile until validated.
- Prevent SSRF when fetching user-controlled or discovered URLs: allowlist providers where feasible, resolve/reject private-network targets, limit redirects, timeouts, response sizes, and content types.
- Use parameterized queries or safe ORM/query-builder APIs.
- Enforce authentication and authorization for write/admin endpoints.
- Do not expose database administration, ingestion triggers, or provider credentials publicly.
- Pin dependencies and monitor advisories.
- Redact sensitive fields in logs and error messages.
- Require key rotation for potentially exposed credentials.

**Definition of done:**

- A threat model and security checklist exist.
- Secrets are absent from source control and client bundles.
- Basic automated secret/dependency scanning runs in CI.
- High-risk findings have fixes or explicit documented risk acceptance.
- Public endpoints have appropriate validation, rate limits, and access control.

## 13. Delivery Plan

### Phase 0 — Discovery and decisions

- Inspect the Cinode API documentation and confirm authentication, job-listing endpoints, location semantics, status fields, deadline fields, pagination, and rate limits.
- Inspect TheirStack and jobspipe API schemas, terms, pricing/credits, and Sweden/Gothenburg coverage.
- Confirm which sources permit API use or extraction.
- Choose direct API versus Composio per source.
- Define the canonical job schema, database schema, and API contract.

### Phase 1 — Cinode MVP

- Set up repository, linting, formatting, tests, CI, environment configuration, migrations, and Docker local development.
- Write tests for Gothenburg/Göteborg matching and 7-day deadline grace logic.
- Implement Cinode adapter and ingestion runner.
- Persist raw and normalized records.
- Build basic list/detail UI.
- Add manual run trigger for local development.
- Add Playwright critical-path coverage.

### Phase 2 — Scheduled hosted deployment

- Deploy frontend/backend/database.
- Configure daily scheduled ingestion.
- Add run monitoring, logs, failure alerts, and backup plan.
- Validate idempotency and quota handling in production-like conditions.

### Phase 3 — Additional sources

- Add TheirStack or jobspipe after cost/coverage validation.
- Add official company ATS/careers-page sources.
- Add compliant search-driven discovery and source validation.
- Improve deduplication and data-quality rules.

### Phase 4 — User workflow enhancements

- Saved/hidden/reviewed/applied status.
- Alerts/digests for new high-match openings.
- Match scoring against a configurable user profile.
- Search history, source health dashboards, and administrative controls.

## 14. Acceptance Criteria for MVP

The MVP is complete when:

- A developer can run the system locally using documented setup steps.
- The system fetches Cinode openings and evaluates both `Göteborg` and `Gothenburg`.
- The system includes active jobs and jobs with deadlines up to 7 calendar days in the past, using `Europe/Stockholm` time.
- The system excludes closed jobs and jobs with deadlines older than 7 calendar days.
- Jobs are persisted in SQLite/Turso with source provenance and raw data preserved safely.
- Repeated runs do not create duplicates.
- A React + Vite UI displays jobs, supports basic search/filtering, and presents job details and original links.
- The ingestion process is executable manually; daily scheduling is documented or implemented for the selected deployment mode.
- Unit, integration, and Playwright tests run successfully.
- No real API credentials appear in source code, tests, logs, or frontend bundles.

## 15. Reference Sources

Use these as starting points for implementation and evaluation. Verify documentation, terms, API availability, rate limits, and access requirements before building against them.

- Cinode API documentation: https://api.cinode.com/docs/index.html
- TheirStack OpenAPI: https://api.theirstack.com/openapi
- jobspipe dashboard: https://jobspipe.dev/dashboard
- ZenRows dashboard: https://app.zenrows.com/overview
- Silicon Valhalla, Gothenburg: https://siliconvalhalla.ai/cities/gothenburg/
- Uptrail, IT jobs in Göteborg: https://uptrail.com/job/it-job/goteborg?set_locale=en
- The Hub, Gothenburg, Sweden: https://thehub.io/jobs/location/sweden?location=Gothenburg%2C%20Sweden&countryCode=SE&sorting=newJobs
- Nordic Tech Jobs, Sweden: https://nordictechjobs.com/sweden

## 16. Open Questions to Resolve Before Implementation

1. Does Cinode provide public or authorized access to all required job-listing data, including status and deadlines?
2. Is this a personal local tool, an internal Devies tool, or a public/multi-user product? This affects authentication, privacy, deployment, and legal requirements.
3. Which sources have permitted APIs and viable Gothenburg coverage?
4. Is the desired schedule exactly once per day, or should it run more often for fresh postings?
5. What is the monthly budget for TheirStack/jobspipe/API usage and hosting?
6. Should expired-but-within-7-days openings be visually distinguished from currently active openings? Recommended: yes.
7. What is the expected definition of IT/business roles: title taxonomy, technology terms, industries, or a combination?
8. Should job recommendations be personalized using a profile/CV, and if so, where/how should that sensitive data be stored?
9. Is a Vercel-hosted architecture required, or can the backend use a separate worker/service better suited to long-running scheduled ingestion?
10. What is the acceptable policy for public-web extraction, including robots.txt, source terms, and geographic/legal constraints?
