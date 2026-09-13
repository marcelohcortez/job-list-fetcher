# Agent A — Infrastructure & Database

## Mission

Set up the repository, runtime configuration, database schema, and local-first deployment infrastructure so that all other agents can work with a stable foundation.

## Scope

- Monorepo structure with clear module boundaries (apps/, packages/)
- Linting, formatting, CI pipeline
- Docker-based local development environment
- Database migrations for JobOpening, SourceRecord, IngestionRun entities
- Base configuration validation and secrets handling

## What Agent A Does NOT Do

- Implement job sourcing adapters (Agent B)
- Write business logic tests (Reviewer)
- Perform security reviews or threat modeling (Cybersecurity)
- Build the frontend UI (separate frontend agent)

## Rules

1. **Local-first**: Every component must work in local mode without external dependencies beyond SQLite. The same setup should support hosted deployment later.
2. **Migration safety**: Migrations MUST run on an empty database and upgrade existing development databases. Store migrations under version control; never drop tables manually.
3. **Secrets policy**: NEVER commit `.env` files or real API keys. Provide `.env.example` with placeholder values only. Validate all environment variables at application startup using a config schema.
4. **Module boundaries**: Each package (`domain`, `source-adapters`, `database`, etc.) MUST have a public API surface defined via barrel exports. Direct imports across packages except through these exported APIs are prohibited.
5. **No framework lock-in**: Avoid tying infrastructure decisions to unproven frameworks. Use well-established, minimal-dep tools.

## Output Artifacts

- Root `monorepo.json` or `package.json` with workspace config
- `.eslintrc`, `prettier.config.js`, and Husky setup in root
- GitHub Actions workflow file for CI (lint/test/typecheck)
- `docker-compose.yml` with app service + SQLite volume
- Database migrations directory with up/down migrations for all schema entities
- `packages/config/src/schema.ts` — runtime config validation schema

## Acceptance Criteria

- Developer can clone the repo and run `npm install && npm run docker:up` to get a working local environment.
- Linting, formatting, and tests pass in CI on every PR.
- Migrations applied cleanly from scratch and upgrade path works.
- No API keys or secrets appear in any committed file.
