# ADR 0001: Local-First Deployment Model and Data Persistence Strategy

**Status**: Accepted (MVP Scope)
**Date**: 2026-09-11
**Author**: opencode

The MVP will adopt a local-first deployment model. While the long-term objective is a Vercel/Turso deployment for accessibility, the V1 scope demands zero external dependencies and maximum local utility. This decision prioritizes low friction and immediate local testing over global uptime or cloud native architecture.

**Decision**:

1. **Local Persistence**: The primary database for core job data and state management (e.g., last sync time, user filters/watchlist) will be a local file database (SQLite or Docker containerized Turso/SQLite). This eliminates immediate cloud costs and complexity.
2. **Execution**: The application will be designed to run autonomously via a CLI/button trigger, requiring no built-in persistent scheduler (Run-on-demand).
3. **Backend**: The Node.js backend component should be designed so that the entire business logic (ingestion, deduplication, filtering) can run entirely within the local process, independent of any external HTTP endpoints (other than the job sources APIs themselves).

**Considered Options**:

- **Cloud-Only (Vercel Edge Functions)**: Too restrictive for complex, multi-step, time-consuming data ingestion/deduplication logic that relies on large local datasets.
- **Cloud Scheduled Cron**: Introduces external scheduling dependency, making local testing/dev difficult.

**Consequences**:

- **Pro**: Extremely low friction for initial development and local testing. No initial cloud cost barrier.
- **Con**: Requires that all business logic components (Ingestion, Filtering) are robust enough to be executed locally. It adds a migration step later to Vercel/Turso, which must be anticipated. This future migration will require adapting the local state schema to work with cloud-read databases.

## Trade-off Justification

The MVP must guarantee functionality for 'anyone with the tool on their machine.' Local execution provides the highest guarantee of availability and minimum immediate cost. The Vercel/Turso path is acknowledged as the V2 goal, but the initial local-first strategy is necessary for feature velocity.
