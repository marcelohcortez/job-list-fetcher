# Devies Tools Integration Plan

## Decisions (locked)

- **Audience**: all employees — no scope gating beyond "logged in". Menu item visible to everyone.
- **Manual CV upload**: removed entirely. All candidates come from the Devies MCP server.
- **Office scoping**: every office — the service account is not restricted to a subset of offices.
- **Hosting**: native route at `/cv-matches` inside Devies Tools Frontend, not a separate subdomain.
- **Navigation**: a dedicated left-menu block/section with sub-items: **Matches, Applied, Saved, Openings, History, Configuration**.
- **Reuse over duplication**: wherever Devies Tools already has the data, auth, or UI infrastructure, job-list-fetcher uses it rather than keeping a second copy/implementation.
- **Sanitization**: CVs fetched from MCP still go through the existing sanitize pipeline (`packages/semantic-match` `processCandidate`) — MCP is a new _source_ of raw CV data, not a replacement for the sanitize step.
- **LLM: local Ollama → cloud Claude API**: a locally-hosted model can't serve the whole company, so all chat/extraction calls (`sanitizeCandidate`, `sanitizeJob`, CV refactor, Laya reasoning) move to the **Claude API** (`claude-sonnet-5`, via `ANTHROPIC_API_KEY`). Embeddings move separately to **Azure OpenAI** (`text-embedding-3-large`) since the Claude API has no embeddings endpoint. See "LLM migration" below.
- **Multi-version CVs per person**: kept exactly as today — dedup is by `(candidateName, candidateTitle)` (`findSanitizedCandidateByNameAndTitle`), so the same person with two resumes for different roles (e.g. "Backend Developer" vs "Solutions Architect") stays as two separate matchable candidate profiles.
- **Access scope**: no new Keycloak/menu scope — access is `mustBeLoggedIn` only, same as "all employees."
- **History page**: identical to today's — seen and dead (expired/closed, past-grace-period) openings, sourced from the existing `seen-jobs`/`dead-jobs` tables, no new concept.
- **Menu placement**: a new `DrawerSections` block, positioned after "People" and before "Admin" (`Frontend/src/components/drawerSections.ts` currently: MyPages 0, Sales 1, Delivery 2, People 3, Economy 4, Admin 5).
- **Ingestion scope**: all registered CVs company-wide — every employee's resume(s), no exclusion list.
- **Refresh trigger**: event-driven, reusing Devies Tools' existing resume change-feed notification (no new webhook built in the Devies backend) — see "Refresh mechanism" below.

## Goal

Make job-list-fetcher available to every Devies employee as a native section of the Devies Tools Frontend (`/cv-matches`, with sub-pages for Matches/Applied/Saved/Openings/History/Configuration), sourcing candidates exclusively from real employee CVs via the Devies MCP server, and bringing the codebase in line with Devies Tools engineering policy.

## Current state (job-list-fetcher)

- Node/TS monorepo: [apps/api](apps/api) (API, SQLite via `packages/database`), [apps/web](apps/web) (standalone React SPA), `packages/semantic-match` (Chroma embeddings + matching today — see vector-store migration below), `packages/source-adapters` (Greenhouse/Lever/board scrapers for job openings).
- Candidates today come from **manual CV upload** ([apps/web/src/UploadCvsTab.tsx](apps/web/src/UploadCvsTab.tsx) → local Ollama sanitize into a Candidate row, per [CONTEXT.md](../CONTEXT.md)). This path is being removed.
- No auth layer — single-user local tool.
- Own [docker-compose.yml](../docker-compose.yml), own UI shell/CSS, own tab-based nav (`App.tsx`).

## Target state (Devies Tools)

- **Frontend**: React+Vite, react-router-dom v5, `Frontend/src/components/MenuItems.tsx` (left nav, scope-gated), `Frontend/src/components/drawerSections.ts` (section grouping), `Frontend/src/components/routes.ts` (scope-gated routes), feature folders under `Frontend/src/crm_new/<feature>/`, shared UI/utilities in `crm_new/shared/`, shared `httpClient` (axios, auto Bearer token) in `Frontend/src/api/`.
- **Backend**: single .NET solution, Cosmos DB is the system of record for candidates/resumes/employees. Controllers/MCP tools are thin, logic lives in services. External systems integrate as sidecar services, not as C# code.
- **Auth**: single Keycloak realm. Frontend: OIDC Authorization Code flow (`oidc-client-ts`), token in `localStorage`, auto-attached by `httpClient`. Backend/MCP: JWT bearer validated against the same realm; service-to-service calls use a confidential client with `serviceAccountsEnabled: true` (pattern: `backend-service`), modeled as a Cosmos `ApplicationUser` with `IsServiceAccount=true`.
- **CV/candidate data**: served via MCP tools in `EmployeeTool.DomainLogic/AI/Tools/` — `ListCandidates`, `GetCandidate`, `ListResumes`, `GetResume`, `search_resumes` (semantic, relevance-scored), `get_composed_resume` (MCP-only, structured shape). No delete tools exist by design — deletion stays UI/REST-only in EmployeeTool itself.

## Architecture decision: native page, thin sidecar API

Two earlier options were weighed (iframe embed vs. full native port). The confirmed 6-item sub-navigation (Matches/Applied/Saved/Openings/History/Configuration) settles it: that's a real multi-page section, not a single embedded widget, and an iframe would mean rebuilding tab navigation, auth bridging, and theming a second time inside a box — itself a duplication. **Decision: native port.**

- **Frontend** (`Frontend/src/crm_new/cv-matches/`): 6 page components (`MatchesPage`, `AppliedPage`, `SavedPage`, `OpeningsPage`, `HistoryPage`, `ConfigurationPage`) reusing Devies Tools' existing MUI components, `httpClient`, `ScopeProvider`/`useScopes`, and OIDC session — no new auth code, no new design system, no new CSS framework. `apps/web` (job-list-fetcher's standalone SPA) is retired once parity is reached; its component logic (JobCard, MatchesTab, ConfigTab, format.ts) is ported/adapted into the new page components rather than rewritten from scratch.
- **API** (`apps/api`): stays a separate Node service — it owns logic nothing else in Devies Tools has: job-opening ingestion from external boards (Greenhouse/Lever/etc.), canonicalization/dedup, and the Candidate↔JobOpening matching engine (`packages/semantic-match`). This is genuinely new capability, not a duplicate of anything in EmployeeTool. It is called directly by the new Frontend pages (same-origin or reverse-proxied path, e.g. `/api/cv-matches/*`), the same way other Devies Tools features call their own API surfaces.
- **What gets deleted, not duplicated**: only the manual-upload _entry point_ and its raw-file storage (PDF bytes/extracted text arriving from a browser upload). The Ollama sanitize pipeline itself stays — it now runs on CV text fetched from MCP instead of CV text extracted from an uploaded PDF. Devies Tools remains the authoritative source for _raw_ resume content (`get_composed_resume`); job-list-fetcher still derives its own sanitized/matchable shape from that raw content, same as it does today from an upload, preserving the existing multi-version-per-person dedup logic. See "Data flow" below for exactly what gets cached locally.
- **Relational store stays exactly what it is today**: **SQLite** (`better-sqlite3`, via `packages/database`) — unchanged, same engine job-list-fetcher already uses for JobOpenings, Candidates, Applied/Saved/History.
- **Vector store migrates from Chroma to Azure Cosmos DB vector search**, since Devies Tools runs on Azure. Checked whether Devies Tools already has a vector DB we could reuse as-is: it does, but it's a different thing — `search_resumes` is backed by Microsoft **Kernel Memory**, a remote service Devies calls over HTTP (`EmployeeTool.DomainLogic/Services/KernelMemoryService.cs`) indexing only `candidates`/`resumes`. It has no concept of JobOpenings (external job-board postings), which is what job-list-fetcher's vector index is actually for — so this isn't a duplicate, it's a different index for content Devies doesn't have at all. Kernel Memory is not reused.
  - Instead of standing up Chroma as a new product for ops to run, `packages/semantic-match`'s vector store is re-implemented against **Cosmos DB for NoSQL's native vector search (DiskANN indexing)** — same DB family already running the rest of Devies Tools, in its own container (not shared with EmployeeTool's data), so no brand-new infra product is introduced.
  - Code impact: `VectorStore` interface in `packages/semantic-match` gets a Cosmos-backed implementation replacing the Chroma client; JobOpening/target-role/candidate-skill embeddings (currently in Chroma, per `packages/semantic-match/src/chroma.ts`) move to Cosmos vector-indexed containers. The matching algorithm itself (`pipeline.ts`) is unchanged — only the storage/query layer swaps.
  - `docker-compose.yml`'s local Chroma service is replaced with the Cosmos DB emulator (or a dev-tier Cosmos account) for local dev, matching how the rest of Devies Tools already does local development against Cosmos.

## Data flow (avoiding duplicate storage)

1. Job-list-fetcher's SQLite DB keeps owning **JobOpenings** (source: external job boards — nothing else in Devies Tools has this data, no duplication concern).
2. On ingestion, `apps/api` calls MCP (`list_candidates`/`list_resumes`, `get_composed_resume` per resume) to pull each employee's raw resume content — this replaces the browser-upload entry point as the _source_ of raw CV text, nothing else changes about what happens next.
3. That raw content is run through the existing sanitize pipeline (`processCandidate`, Ollama) exactly as an upload is today, producing `sanitized.candidateName` / `sanitized.title` / skills/experience, and the existing dedup check (`findSanitizedCandidateByNameAndTitle`) still applies — so a person with multiple Devies resumes (different target roles) still lands as multiple candidate profiles, matching current behavior.
4. The resulting Candidate rows (sanitized JSON, embeddings, skill links) are stored locally in job-list-fetcher's own SQLite DB exactly as they are today — this is not new duplication, it's the same storage model job-list-fetcher already has, just fed from MCP instead of an upload form. Re-ingestion (e.g. on a schedule, or when a resume is updated in Devies) re-fetches from MCP and re-sanitizes rather than trusting a stale local copy indefinitely.
5. **Applied / Saved / History** are job-list-fetcher-native concepts (a candidate's application/save state against a JobOpening, and seen/dead JobOpening tracking) that don't exist in EmployeeTool — these stay as job-list-fetcher's own tables, unchanged.
6. This resolves the earlier "data residency" open question: Devies Tools/Cosmos DB remains the source of truth for raw resume content; job-list-fetcher's local store holds only its own derived sanitized/matching data, the same shape and same storage model it already has today for uploaded CVs — no new PII surface is introduced, just a new (trusted, authenticated) input source.

### Refresh mechanism (reusing an existing resource, not building a new one)

Devies Tools has no outbound webhook system today, but it does already broadcast resume changes: `EmployeeTool.FunctionApp/SyncHubFunctions.cs` is a Cosmos DB change-feed trigger that fires a `sync:Resume`/`deleted:Resume` SignalR message to `SyncHub` (`EmployeeTool.Server/Hubs/SyncHub.cs`) on **any** Resume document write (create/update/publish), to any authenticated client holding `ResumesRead` scope, grouped by scope not by being the frontend specifically.

- job-list-fetcher's `apps/api` service account (from Phase 0, granted `ResumesRead`) connects to `SyncHub` as a SignalR **client**, the same way the Devies Frontend does, and listens for `sync:Resume`/`deleted:Resume`.
- On a `sync:Resume` event for a given resume ID, job-list-fetcher re-fetches that resume via `get_composed_resume` and re-runs it through the sanitize/dedup pipeline (Phase 1) — no polling, no new backend endpoint, no webhook infrastructure to build on the Devies side.
- Fallback: on job-list-fetcher API startup (or after any SyncHub disconnect/reconnect gap), do one full `list_candidates`/`list_resumes` reconciliation pass to catch anything missed while disconnected.

## LLM migration: local Ollama → cloud

Today's Ollama usage (`packages/semantic-match`) has two distinct jobs that need two distinct replacements, since only one of them has a cloud equivalent from the same vendor:

| Today (Ollama, local)                                        | Used by                                                                                       | Moves to                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sanitizeCandidate` / `sanitizeJob` chat calls (`ollama.ts`) | CV/job structured extraction (title, skills, experience)                                      | **Claude API**, `claude-sonnet-5`                                                                                                                      |
| CV refactor chat call (`refactor.ts`)                        | Rewrites CV text before embedding                                                             | **Claude API**, `claude-sonnet-5`                                                                                                                      |
| Laya reasoning chat call (`laya.ts`, `createOllamaReasoner`) | Generates fit/mismatch reasoning text (Laya's own BERT classifier is separate and unaffected) | **Claude API**, `claude-sonnet-5`                                                                                                                      |
| `embed()` (`ollama.ts`)                                      | All vector embeddings feeding the (now Cosmos DB) vector store                                | **Azure OpenAI**, `text-embedding-3-large` — Claude API has no embeddings endpoint, so this is a separate provider regardless of the chat-model choice |

**Why cloud is required, not optional**: local Ollama only works because today's tool runs on one person's machine. Once this is a shared Devies Tools feature used by every employee, there's no single laptop/GPU to host the model against — it has to be a callable API both the ingestion pipeline and (potentially) interactive flows can reach from wherever `apps/api` is deployed.

**Why Sonnet 5, not Opus 5**: this is high-volume structured extraction/classification (the "Classification, summarization, extraction, Q&A" workload shape), not frontier reasoning — Sonnet 5 ($2/$10 per MTok) is built for exactly this and costs 4x less than Opus 5 for it.

**Cost estimate — grounded in the real local dev DB** (`apps/api/data/jobs.db`), not a blind guess: CVs average 14,232 chars raw (~3,558 tokens), the refactored/anchor CV used for matching averages 2,893 chars (~723 tokens), job descriptions average 3,328 chars (~832 tokens), Laya's reasoning+mismatch output averages ~357 tokens, `LAYA_TOP_K=10` is the configured fan-out. Real headcount is **~50 employees**, most with **2–3 CV versions** each (matches the multi-version-per-person decision above) → **~125 candidate profiles** to backfill, not the 13 in this pilot DB or an inflated headcount guess.

Per-call cost at these real sizes: candidate sanitize **$0.013**, job sanitize **$0.0052**, CV refactor **$0.015**, Laya evaluation **$0.0072**.

**One-time catch-up vs. steady state matters here, and the raw ingestion-run average conflates them.** Breaking real `job_openings.first_seen_at` down by day shows two clear catch-up spikes (day 1: 80 new jobs; a later run: 75 new jobs from the same source set as every other run, not a newly-added board) against a genuinely steady trickle on the other days (7, 9, 16 → **~11/day, ~320–450/month**). A blended monthly average across the whole 8-day sample (~1,300/month) overstates steady-state cost by roughly 3x — it's counting backfill volume as if it recurred every month.

The cost driver worth calling out explicitly: Laya evaluation fans out in **both directions** — a new candidate gets evaluated against its top-10 matching jobs, but every newly-ingested job _also_ gets evaluated against its top-10 matching candidates (`evaluateLayaForNewJob` in `apps/api/src/laya-runner.ts`). At steady-state ingestion volume this is still the dominant line, just smaller than the blended figure suggested:

| Line                                                                                                                               | Driver (steady-state, measured)                                                            | Monthly cost   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------- |
| Job sanitize                                                                                                                       | ~375/month                                                                                 | ~$1.95         |
| Job-triggered Laya (×10 candidates each — pool of ~125 profiles, unaffected by the 50-employee headcount since 125 > `LAYA_TOP_K`) | ~375/month × 10                                                                            | **~$27**       |
| Candidate sanitize + refactor + candidate-triggered Laya                                                                           | ~5 CV updates/month (realistic churn at 50 employees, not the earlier 20/month guess) × 10 | ~$0.50         |
| **Ongoing total (steady state)**                                                                                                   |                                                                                            | **~$29/month** |

**One-time backfill/catch-up** (initial import across all 6 job-board sources + ~125 candidate profiles from 50 employees at 2–3 CV versions each): jobs ≈ $14, candidates ≈ 125 × $0.10/profile ≈ $12.50 → **~$27 total**, one-time, not recurring. Total first-month cost ≈ backfill + one month of steady state ≈ **~$56**, dropping to **~$29/month** every month after.

This should be re-measured against `response.usage` once live rather than trusted indefinitely — it's a grounded estimate, not a bill.

### Code changes

1. **New implementation, same interfaces** — `SanitizerClient` (`sanitizeJob`, `sanitizeCandidate`, `embed`), `CvRefactorClient` (`refactorCv`), and the Laya reasoner's interface in `laya.ts` are already narrow, swappable interfaces (built for testability with fakes). Add `createClaudeSanitizer(config)`, a Claude-backed `refactorCv`, and a Claude-backed reasoner implementing the same shapes — call sites in `apps/api/src/index.ts` (`createOllamaSanitizer`, `createOllamaCvRefactor`, `createOllamaReasoner`) swap to the new factories, nothing downstream changes.
2. **Structured extraction via `output_config.format`** — `sanitizeJob`/`sanitizeCandidate` already define JSON schemas (`PROFILE_JSON_SCHEMA`/`CANDIDATE_JSON_SCHEMA` in `ollama.ts`) and validate with `SanitizedJobSchema`/`SanitizedCandidateSchema` (zod) after parsing — this maps directly onto Claude's structured outputs, keeping the same schemas and the same zod validation as a safety net.
3. **New `embed()` implementation** — Azure OpenAI `text-embedding-3-large` via the Azure OpenAI SDK/REST endpoint, requiring an Azure OpenAI resource + API key/Entra ID auth (Devies' Azure subscription — same one hosting the new Cosmos vector store, so provisioning can happen together).
4. **Env vars**: add `ANTHROPIC_API_KEY` and `AZURE_OPENAI_*` (endpoint, key or Entra ID, deployment name) to `.env`/`.env.example` (both root and `apps/api/`), replacing `OLLAMA_HOST`/`OLLAMA_CHAT_MODEL`/`OLLAMA_EMBED_MODEL`/`OLLAMA_NUM_CTX`/`OLLAMA_NUM_PREDICT`.
5. **Remove local-only plumbing**: `createOllamaFetch()`'s extended-timeout workaround (`ollama.ts`) existed specifically because a local 7B model can take minutes to first-token — no longer needed against a cloud API. The `ollama` npm dependency and the "Ollama runs natively on the host" note in [docker-compose.yml](../docker-compose.yml) are removed once the swap is complete.
6. **Secrets, not plaintext env**: `ANTHROPIC_API_KEY`/Azure OpenAI credentials belong in whatever secret store Devies' Azure deployment already uses for the Keycloak client secret/Cosmos connection string (Key Vault, per `Backend/appsettings.*.json`'s `#POPULATED_BY_KEY_VAULT#` convention) — not committed to `.env`, matching how the rest of this plan's credentials are handled.

## Phased plan

### Phase 0 — Access & environment setup (Devies-side, ops)

1. Register a confidential Keycloak client for job-list-fetcher's API (service account enabled, scoped to `candidates:read`, `ResumesRead`, all offices — no office restriction) — mirrors `backend-service` in `keycloak-e2e-realm.json`. `ResumesRead` is also what's needed to join `SyncHub` for the refresh mechanism below.
2. No new scope is added to the catalog — access is "all logged-in employees," gated by `mustBeLoggedIn` only.
3. Decide reverse-proxy path for `apps/api` (e.g. `/api/cv-matches/*` behind the same origin as the Frontend) so no new subdomain/CORS surface is needed.

### Phase 1 — MCP-backed candidate ingestion (job-list-fetcher API)

1. Add a Devies MCP client to `apps/api`: OAuth2 client-credentials against Keycloak (service account from Phase 0) → Bearer token → call `tools.devies.se/mcp`.
2. Initial full sync: `list_candidates`/`list_resumes` to enumerate **every** registered employee resume company-wide, `get_composed_resume` per resume for the raw structured content, feeding each one into the **existing, unchanged sanitize pipeline** (`processCandidate` → Ollama) and the **existing, unchanged dedup logic** (`findSanitizedCandidateByNameAndTitle`) — so multiple resume versions per employee (different target roles) keep landing as multiple candidate profiles, same as today. This fully replaces `UploadCvsTab`'s role as the candidate source.
3. **Delete** [apps/web/src/UploadCvsTab.tsx](apps/web/src/UploadCvsTab.tsx), its route/tab in `App.tsx`, and the browser-upload-only API surface (raw PDF upload endpoint/multipart handling) — while keeping the sanitize/dedup/matching code paths they used to feed, now fed by MCP instead.
4. Add the SignalR `SyncHub` client (per "Refresh mechanism" above) for ongoing event-driven updates, plus a startup/reconnect reconciliation pass to catch anything missed while disconnected.
5. Respect the "no delete via MCP" policy — job-list-fetcher never assumes it can delete a source resume; a `deleted:Resume` event or a resume disappearing from `list_resumes` only clears the local cache/Applied-Saved-History state for that candidate.

### Phase 2 — Auth alignment (job-list-fetcher API)

1. Add Keycloak JWT validation middleware to `apps/api`, validating tokens from the same realm/audience the rest of Devies Tools uses — since the Frontend is now native (same session), the API just needs to accept the same Bearer token the Frontend's `httpClient` already attaches. No separate login flow, no token bridge, no `oidc-client-ts` needed in job-list-fetcher's own code.
2. Since scope is "all employees," authorization is simple: valid Devies JWT = access granted. No per-office filtering needed on the job-list-fetcher side (office scoping decision = every office).

### Phase 3 — Native frontend port (Devies Tools Frontend repo)

1. Add a new `DrawerSections` entry (e.g. `CvMatches`) positioned after `People` (order 3) and before `Admin`, in `Frontend/src/components/drawerSections.ts`. Since `Economy` currently sits at order 4 between them, renumber: `CvMatches: { order: 4 }`, `Economy: { order: 5 }`, `Admin: { order: 6 }`.
2. Add 6 menu entries in `Frontend/src/components/MenuItems.tsx` — Matches, Applied, Saved, Openings, History, Configuration — all under the new section, gated only by `mustBeLoggedIn`. No scope.
3. Add 6 routes under `/cv-matches/*` in `Frontend/src/components/routes.ts` (e.g. `/cv-matches/matches`, `/cv-matches/applied`, `/cv-matches/saved`, `/cv-matches/openings`, `/cv-matches/history`, `/cv-matches/configuration`) pointing at new components in `Frontend/src/crm_new/cv-matches/`.
4. Port existing UI logic from job-list-fetcher's `apps/web` into the new page components, adapting to MUI + the Devies Tools component conventions instead of `apps/web/src/styles.css`:
   - `MatchesTab.tsx` → `MatchesPage.tsx`
   - New `AppliedPage.tsx`, `SavedPage.tsx` (currently no direct equivalent — "saved jobs" migration exists per `packages/database/src/migrations/016-saved-jobs.ts`, reuse that data model)
   - New `OpeningsPage.tsx` (job openings list/browse — check `apps/web/src/App.tsx` for existing openings view to port)
   - New `HistoryPage.tsx` — direct port of the current History view: seen and dead (expired/closed) openings, from `job-marks`/`seen-jobs`/`dead-jobs` tables, no new concept
   - `ConfigTab.tsx` → `ConfigurationPage.tsx`
   - `JobCard.tsx`, `format.ts` → move into `crm_new/cv-matches/` or `crm_new/shared/` if reusable elsewhere.
5. Point the ported pages' data calls at `apps/api` via the shared `httpClient` (same Bearer-attach, same base URL conventions as other Devies Tools features) instead of job-list-fetcher's standalone `api.ts`.
6. Run `bun run tsc --noEmit` and `bun run lint:check` clean per Frontend/CLAUDE.md before commit; this repo stays bun-only.
7. Once parity is confirmed, delete `apps/web` (the standalone SPA) and its Dockerfile references — it's fully superseded by the native pages.

### Phase 4 — Deployment

1. `apps/api` deploys as a sidecar service reachable only from the Devies Tools origin (internal network or path-based reverse proxy `/api/cv-matches/*`) — no public subdomain needed since there's no separate SPA anymore.
2. Keep SQLite + the new Cosmos DB vector container as `apps/api`'s own datastores for JobOpenings, matching artifacts, and Applied/Saved/History — this data (and the vector container itself) has no equivalent in EmployeeTool's Cosmos containers, so it isn't a duplication; only candidate/resume source data is fetched live from MCP rather than stored. Requires its own Cosmos DB account/database in Devies' Azure subscription (or a dedicated container within the existing account, per infra team preference) plus a service principal/connection string for `apps/api`.
3. Update [docker-compose.yml](../docker-compose.yml) to drop the `apps/web` service once Phase 3 deletes it.

## Policy compliance checklist (from Backend/CLAUDE.md, Frontend/CLAUDE.md, AGENTS.md)

- [ ] Surgical changes only in the Devies Frontend repo — touch only MenuItems/drawerSections/routes/new `crm_new/cv-matches/` folder, no unrelated refactors.
- [ ] Frontend changes pass `bun run tsc --noEmit` + `bun run lint:check`.
- [ ] No new scope added to the catalog — access stays `mustBeLoggedIn` only, per the "no scope needed" decision.
- [ ] No new Delete-capable MCP tool added or assumed for candidates/resumes.
- [ ] Service account modeled as a Cosmos `ApplicationUser` with `IsServiceAccount=true`, explicit minimal scopes (all-offices read, per the office-scoping decision, but still not write/delete).
- [ ] Sanitize pipeline and multi-version-per-person dedup logic (`findSanitizedCandidateByNameAndTitle`) are preserved unchanged — MCP only replaces the raw-CV-text source, not the processing logic.
- [ ] Any bug/wrong assumption discovered while doing this integration gets generalized back into `Backend/CLAUDE.md`/`Frontend/CLAUDE.md`/skills per the AGENTS.md "lesson capture" rule.
- [ ] job-list-fetcher's API (`apps/api`) stays npm-based (its own repo/deployable) — the bun requirement applies only to the Devies Tools Frontend repo itself.

## Decisions confirmed

- Menu block label: **"CV Matches"**.
- `SyncHub` (browser-facing SignalR hub, previously only consumed by human-user sessions in the Devies Frontend) is approved as a consumer for job-list-fetcher's service account, gated by the same `ResumesRead` scope any client needs — no new backend work required. If this turns out to be a problem in practice (ops pushback, hub not built to handle a long-lived non-UI connection well), fall back to polling `list_resumes`/`list_candidates` on a schedule instead.

## Effort summary

| Phase | Repo                  | Rough size                                                  |
| ----- | --------------------- | ----------------------------------------------------------- |
| 0     | devies-tools (ops)    | Keycloak client + scope + reverse-proxy path                |
| 1     | job-list-fetcher      | MCP client, delete upload path, add embedding cache, medium |
| 2     | job-list-fetcher      | JWT validation middleware, small                            |
| 3     | devies-tools/Frontend | 6 pages ported + menu/route/scope wiring, largest phase     |
| 4     | infra                 | Sidecar API deploy, drop standalone SPA, small              |
