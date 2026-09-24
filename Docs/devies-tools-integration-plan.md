# Devies Tools Integration Plan

## Goal

Make job-list-fetcher available to all Devies employees as a new left-side-menu section inside the Devies Tools Frontend, using real employee CVs pulled from the company's Devies MCP server (`tools.devies.se/mcp`) instead of manual CV upload, and bring the codebase in line with Devies Tools engineering policy.

## Current state (job-list-fetcher)

- Node/TS monorepo: [apps/api](apps/api) (Express-style API, Postgres via `packages/database`), [apps/web](apps/web) (React SPA), `packages/semantic-match` (Chroma embeddings), `packages/source-adapters` (Greenhouse/Lever/board scrapers).
- Candidates today come from **manual CV upload** ([apps/web/src/UploadCvsTab.tsx](apps/web/src/UploadCvsTab.tsx) → local Ollama sanitize, per [CONTEXT.md](../CONTEXT.md)).
- No auth layer — single-user local tool.
- Deployed via its own [docker-compose.yml](../docker-compose.yml).

## Target state (Devies Tools)

- **Frontend**: React+Vite, react-router-dom v5, `Frontend/src/components/MenuItems.tsx` (left nav, scope-gated), `Frontend/src/components/routes.ts` (scope-gated routes), feature folders under `Frontend/src/crm_new/<feature>/`.
- **Backend**: single .NET solution, Cosmos DB, thin controllers/MCP tools over service layer. External systems integrate as **sidecar services** (see `EmployeeTool.Integrations/`), not as C# code — confirmed by architecture (Backend/docs/architecture.md), so job-list-fetcher stays Node/TS and is not ported into the .NET solution.
- **Auth**: single Keycloak realm. Frontend uses OIDC Authorization Code flow (`oidc-client-ts`), Backend validates the same JWTs (`Keycloak.AuthServices.Authentication` + token introspection). MCP endpoint (`/mcp`) requires a Bearer JWT from the same realm; interactive clients use the `devies-mcp` public client, service-to-service clients use a confidential client with `serviceAccountsEnabled: true` (pattern: `backend-service`).
- **CV/candidate data**: available via MCP tools in `EmployeeTool.DomainLogic/AI/Tools/` — `ListCandidates`, `GetCandidate`, `ListResumes`, `GetResume`, `search_resumes` (semantic), `get_composed_resume` (MCP-only). No delete tools exist by design — deletion stays UI/REST-only.

## Architecture decision: sidecar, not a rewrite

job-list-fetcher keeps its own stack (Node/API, Postgres, Chroma) and runs as an independently deployed service, reachable at its own subdomain (e.g. `jobs.devies.se` or `tools.devies.se/job-fetcher`). It is embedded in the Devies Tools left menu two possible ways:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Iframe embed (recommended, Phase 1)** | New menu item + route in Frontend renders `<iframe src="https://jobs.devies.se/embed">`, pass the user's Keycloak access token via `postMessage` on load | Fast, zero risk to existing Frontend bundle/build, job-list-fetcher stays independently deployable/testable | Iframe UX seams (no shared shell chrome, separate scroll), needs token-refresh bridging |
| **B. Native port into `crm_new/`** | Rewrite apps/web UI as a `crm_new/job-fetcher/` feature folder calling the Node API directly | Fully native UX | Full UI rewrite in Devies Frontend's stack/conventions (React 18 + MUI + bun), duplicated maintenance, largest effort |

Recommendation: ship Option A first to get the "everyone can use it" goal live quickly; revisit Option B only if iframe UX proves insufficient.

## Phased plan

### Phase 0 — Access & environment setup (Devies-side, manual/ops)
1. Register a new confidential Keycloak client for job-list-fetcher's API (service account enabled, scoped to `candidates:read`, `resumes:read` or equivalent minimum scopes) — mirrors `backend-service` in `keycloak-e2e-realm.json`.
2. Confirm with Devies platform owner which office(s)/scope the service account should see — MCP auto-injects `officeId` per caller, so the service account's assigned offices determine visible candidates.
3. Decide subdomain/hosting for job-list-fetcher (e.g. `jobs.devies.se`) and get it added to Keycloak's allowed redirect/CORS origins and to the Frontend's CSP if one exists.

### Phase 1 — MCP-backed candidate ingestion (job-list-fetcher API)
1. Add a Devies MCP client to `apps/api`: OAuth2 client-credentials against Keycloak (service account from Phase 0) → Bearer token → call `tools.devies.se/mcp`.
2. New ingestion path parallel to today's manual upload: pull candidates via `list_candidates` / `search_resumes` / `get_resume` / `get_composed_resume`, map Devies resume shape into the existing Candidate normalized shape ([CONTEXT.md](../CONTEXT.md) `Candidate` entity), feed into the existing sanitize → match pipeline (`packages/semantic-match`).
3. Keep manual upload (`UploadCvsTab`) as a fallback/testing path unless product decides to retire it.
4. Respect the "no delete via MCP" policy — any candidate removal/archival in job-list-fetcher must not assume it can delete the source resume via MCP; it only affects job-list-fetcher's own local copy.

### Phase 2 — User auth alignment (job-list-fetcher API + web)
1. Add Keycloak JWT validation middleware to `apps/api` (same realm, same validation approach as EmployeeTool.Server) so job-list-fetcher's own endpoints are gated by company identity, not open.
2. `apps/web` adopts `oidc-client-ts` (or receives a forwarded token from the iframe host) instead of being unauthenticated.
3. Enforce per-user visibility if needed (e.g. a recruiter only sees candidates from their own office) — reuse the same office/claims model the MCP server already applies, rather than inventing a new one.

### Phase 3 — Frontend embed (Devies Tools Frontend repo)
1. Add a new `DrawerSections` entry or reuse an existing section (likely `Delivery` or a new `Recruitment` section) in `Frontend/src/components/drawerSections.ts`.
2. Add a menu item in `Frontend/src/components/MenuItems.tsx` gated by a new scope (e.g. `jobfetcher:read`) added to the scope catalog (`EmployeeTool.Core/Authorization/Scopes.cs`) and regenerated into `Frontend/src/auth/scopes.generated.ts` via the existing `scripts/generate-scopes.ts`.
3. Add a route in `Frontend/src/components/routes.ts` → new `crm_new/job-fetcher/JobFetcherPage.tsx` that renders the iframe and bridges the access token via `postMessage`, following the existing feature-folder + barrel-export pattern.
4. Run `bun run tsc --noEmit` and `bun run lint:check` clean per Frontend/CLAUDE.md before commit; do not use npm/yarn in that repo.

### Phase 4 — Deployment
1. Containerize job-list-fetcher for the shared infra (Dockerfile already exists) and deploy alongside Devies Tools (own docker-compose/K8s manifest, not inside `Backend/Dockerfile*`).
2. Reverse-proxy `jobs.devies.se` (or path prefix) with TLS matching the rest of `*.devies.se`.
3. Point job-list-fetcher's Postgres/Chroma at dedicated infra — do not share Cosmos DB; it stays a separate datastore per the sidecar decision above.

## Policy compliance checklist (from Backend/CLAUDE.md, Frontend/CLAUDE.md, AGENTS.md)

- [ ] Surgical changes only in the Devies Frontend repo — touch only MenuItems/routes/scopes/new feature folder, no unrelated refactors.
- [ ] Frontend changes pass `bun run tsc --noEmit` + `bun run lint:check`.
- [ ] New scope(s) added through the real scope catalog (`Scopes.cs` → generated `scopes.generated.ts`), not hardcoded strings.
- [ ] No new Delete-capable MCP tool added for candidates/resumes (deletion stays UI/REST-only, matches existing product policy).
- [ ] Service account follows the "service accounts are flagged users" model — created as a Cosmos `ApplicationUser` with `IsServiceAccount=true` and explicit minimal scopes, not a superuser token.
- [ ] Any bug/wrong assumption discovered while doing this integration gets generalized back into `Backend/CLAUDE.md`/`Frontend/CLAUDE.md`/skills per the AGENTS.md "lesson capture" rule.
- [ ] job-list-fetcher's own CLAUDE.md/AGENTS conventions (npm-based, not bun) stay as-is since it remains a separate deployable — do not force bun tooling onto this repo.

## Open questions (need a decision from a Devies Tools owner, not inferable from code)

1. Target audience/scope name: is this literally "everyone" (any logged-in employee) or gated to recruiters/People team? Determines which scope(s) gate the menu item.
2. Subdomain vs path prefix for hosting (`jobs.devies.se` vs `tools.devies.se/job-fetcher`) — affects CORS/CSP/reverse-proxy config.
3. Should manual CV upload be retired once MCP ingestion works, or kept as a permanent side channel for non-employee/candidate CVs (external hires)?
4. Data residency: is a separate Postgres/Chroma instance for job-list-fetcher acceptable, or must all data live in Cosmos DB eventually (would require porting into the access-graph system once it's live)?
5. Office scoping: should the service account see all offices, or should ingestion run per-office to match the per-user visibility model the rest of the platform uses?

## Effort summary

| Phase | Repo | Rough size |
|---|---|---|
| 0 | devies-tools (ops) | Keycloak client + DNS/CORS config |
| 1 | job-list-fetcher | New MCP client + ingestion adapter, medium |
| 2 | job-list-fetcher | Auth middleware + web SSO bridge, medium |
| 3 | devies-tools/Frontend | Menu/route/scope wiring + iframe page, small |
| 4 | infra | Deploy + reverse proxy, small–medium |
