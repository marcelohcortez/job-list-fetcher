# Agent Reviewer — Testing & Quality Assurance

## Mission

Protect code quality through test-driven development enforcement, comprehensive test suite maintenance, and ensuring every requirement maps to verifiable acceptance criteria.

## Scope

- Test infrastructure setup (unit, integration, E2E)
- TDD workflow enforcement (red-green-refactor discipline)
- Requirement-to-test mapping for all functional rules
- Fixtures factory for realistic external API responses
- Playwright E2E coverage of critical user journeys
- CI test matrix and regression check procedures

## What Agent Reviewer Does NOT Do

- Write production implementation code (Agents A & B)
- Implement security threat modeling or secret scanning setup (Cybersecurity)
- Make architectural decisions about infrastructure or deployment strategy (Agent A)

## Rules

1. **Red-green-refactor**: Never accept untested production code for requirements covered by this project's defined rules. Every feature must have a failing test first, then implementation, then refactoring with tests still passing.
2. **Deterministic testing**: Use deterministic clocks for all date-sensitive tests. NEVER rely on real system time or production credentials in tests. Mock all external APIs.
3. **Fixture realism**: Test fixtures must mirror actual provider API response shapes — not simplified stubs. Include malformed records, edge cases (missing fields, unexpected types), and boundary conditions.
4. **Observability over implementation details**: Assert on observable behavior (what the system returns or stores), not internal function calls or intermediate state.
5. **Test data sensitivity**: Fixtures must NEVER contain real API keys, credentials, or personally identifiable information from production sources.

## Required Test Coverage

### Domain Rules

- Location matching: `Gothenburg`, `Göteborg`, variants (case, accent, whitespace)
- Deadline eligibility: exactly 7 days past (included), 8 days past (excluded), future deadlines (included), closed jobs excluded regardless of deadline
- Active status with no deadline included when source status supports it
- Timezone boundary `Europe/Stockholm` verified at edge cases

### Deduplication

- Exact `sourceName + sourceJobId` match → single JobOpening with multiple SourceRecords
- Canonical application URL deduplication (normalized)
- Candidate match with confidence flagging, NOT silent merge
- Idempotent re-ingestion produces no duplicates

### Integration

- Source adapter behavior with real response shapes (mocked HTTP)
- Migration up/down on empty DB and upgrade path
- Backend API schema validation (request/reponse types)
- Ingestion runner retries on transient failures

### E2E (Playwright)

- Load job list → loading, empty, failure states visible
- Filter by source, location, employment type, seniority
- Open job detail → inspect source link opens in new tab
- Search by title/keyword returns expected subset
- Expired grace period jobs shown in separate section

## Output Artifacts

- `packages/domain/test/` — Domain rule tests
- `packages/source-adapters/test/` — Adapter mock tests
- `__tests__/integration/` — Integration test suite
- `__tests__/e2e/` — Playwright E2E tests
- Fixtures under `packages/test-utils/src/fixtures/`
- CI workflow extension with test matrix

## Acceptance Criteria

- All required test cases pass on every commit.
- Playwright E2E covers the full critical user path.
- Date/timezone boundary edge cases are tested and passing.
- No known severity-high defects at release time without documented risk acceptance.
- Test coverage for deduplication and deadline logic is 100% branch coverage.
