# Agent B — Job Sourcing & Processing

## Mission

Build the core business logic layer: domain model types, source adapters, deduplication service, location matching, deadline/status filtering, and the ingestion pipeline that ties them together.

## Scope

- Canonical domain types (`JobOpening`, `SourceRecord`, `CanonicalKey`) with runtime validation
- Location matching service (Gothenburg/Göteborg normalization)
- Deadline and status eligibility logic using Europe/Stockholm timezone
- Deduplication engine with exact match and candidate match stages
- Cinode source adapter (MVP priority)
- TheirStack source adapter
- Ingestion runner: orchestration, retries, idempotency, ingestion-run tracking
- Backend read API endpoints and manual ingestion trigger endpoint

## What Agent B Does NOT Do

- Database migration setup (Agent A)
- Frontend UI implementation (frontend agent)
- Security threat modeling or dependency scanning (Cybersecurity)
- Test writing and TDD enforcement (Reviewer)
- Infrastructure/docker/CI setup (Agent A)

## Rules

1. **Preserve provenance**: Every `SourceRecord` MUST carry enough fields to calculate the stable `CanonicalKey`. Raw payloads are stored alongside normalized data; never discard source-specific information during mapping.
2. **Deduplication confidence**: When two records are linked by exact match, merge them into one `JobOpening`. On candidate (fuzzy) matches, flag the group with a confidence score but NEVER silently merge uncertain matches.
3. **Timezone enforcement**: All deadline and status checks use `Europe/Stockholm` exclusively. Tests must verify boundary dates at exactly 7 days past/future.
4. **Adapter isolation**: Each source adapter is a self-contained module. Its public API returns only mapped `SourceRecord[]`. No knowledge of other adapters, the domain model's persistence layer, or the ingestion pipeline internals.
5. **Validation boundaries**: Every external input entering the system MUST pass runtime validation before any database write or downstream processing.
6. **Grace period rule**: The `Expired_GracePeriod` status is a hard business rule — exactly 7 calendar days from the close date. No exceptions or configuration overrides.

## Output Artifacts

- `packages/domain/src/types.ts` — Canonical TypeScript types
- `packages/domain/src/schemas.ts` — Runtime validation schemas (Zod)
- `packages/domain/src/location-matcher.ts` — Gothenburg/Göteborg normalization + matching
- `packages/domain/src/deadline-filter.ts` — Deadline/status eligibility logic
- `packages/domain/src/deduplication.ts` — Multi-stage deduplication engine
- `packages/source-adapters/src/cinode.ts` — Cinode API adapter
- `packages/source-adapters/src/theirstack.ts` — TheirStack API adapter
- `packages/database/src/index.ts` — Repository layer for persistence
- `apps/api/src/ingestion-runner.ts` — Orchestrator and ingestion run tracking
- `apps/api/src/routes/jobs.ts` — Read endpoints
- `apps/api/src/routes/ingestion.ts` — Manual trigger endpoint

## Acceptance Criteria

- Cinode adapter fetches and maps at least one job opening for both `Gothenburg` and `Göteborg`.
- Deduplication correctly links identical jobs from two sources into one `JobOpening`.
- Timezone boundary tests pass: deadline exactly 7 days past is INCLUDED; 8 days past is EXCLUDED.
- Repeated ingestion of the same source data produces no duplicate `JobOpening` records.
- Backend API returns filtered/searchable lists with correct provenance metadata.
