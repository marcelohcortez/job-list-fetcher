# ADR 0006: Vector Fallback for Title Scope + Candidate Duplicate Detection

**Status**: Accepted; the title-scope decision (#1 below) is extended by [ADR 0011](0011-swedish-target-roles-seed.md) — the vector fallback alone did not bridge English↔Swedish titles at the default similarity threshold, so `TARGET_ROLES` now also carries curated Swedish anchor phrases.
**Date**: 2026-09-15
**Author**: Claude Sonnet 5

Two small extensions to the [semantic-matching pipeline](0004-semantic-matching-pipeline.md), both built on the same Ollama/Chroma primitives it introduced.

**Context**:

1. `matchesTargetTitle` (`packages/domain/src/target-roles.ts`) is a fixed regex over `TARGET_ROLES`. Real postings phrase titles in ways the list doesn't anticipate ("Senior Fullstack Engineer II"), and every miss requires a code change to the static list.
2. Multiple CVs for the same person (re-uploads, resubmissions, batch + single overlapping) were landing as independent `candidates` rows with no relationship between them, silently doubling that person's presence in Matches.

**Decision**:

1. **Title scope gets a vector fallback, not a replacement.** `matchesTargetTitle` still runs first and is authoritative when it matches. Only on a miss does `apps/api/src/role-scope.ts` embed the title and query a new `target_role_phrases` Chroma collection + SQLite table (migration `005-target-role-phrases`), seeded once at startup from `TARGET_ROLES` (`seedTargetRolePhrases`, idempotent). A hit at ≥ `ROLE_MATCH_MIN_SIMILARITY` (default `0.85`) accepts the title **and** writes it back into `target_role_phrases` as a `learned` phrase — the vocabulary grows from real postings it has already accepted, without a code change or a redeploy.
2. **Duplicate CVs are held, not merged or silently duplicated.** After sanitizing, if the extracted candidate name matches an existing `sanitized` candidate, the new row is stored as `status = 'duplicate'` with `duplicate_of_id` pointing at the existing one (migration `006-candidate-duplicates`, which also widens the `status` CHECK constraint — SQLite requires a table rebuild for this). Both upload tabs then prompt the user to resolve it explicitly: **ignore** (delete the new upload) or **replace** (delete the old candidate + its vector, promote the new one). `POST /candidates/:id/resolve-duplicate` carries the decision.

**Considered Options**:

- **Widen `TARGET_ROLES` by hand as gaps are found.** Rejected as an ongoing tax — the whole point of moving to embeddings elsewhere in this platform is to stop hand-maintaining phrase lists.
- **Match candidate duplicates by file hash instead of extracted name.** Rejected — two different PDF exports of the same CV (re-saved, re-formatted) hash differently but sanitize to the same name; name match survives that, file hash doesn't.
- **Auto-replace on duplicate instead of prompting.** Rejected — silently discarding one of two CVs risks losing a more current version without the user ever seeing it happened.

**Consequences**:

- **Pro**: Both features reuse existing injected interfaces (`VectorStore`, `Embed`) and the existing `candidates`/`job_embeddings` failure-visibility pattern — no new plumbing shape.
- **Pro**: The role-phrase vocabulary self-corrects toward whatever titles actually appear in ingested postings, instead of drifting out of date against a static list.
- **Con**: The title-scope fallback needs Ollama reachable at ingestion time; if it's down, only the exact regex applies for that run — it fails closed, so a title that would have cleared the vector fallback is simply excluded for that run rather than causing an error.
- **Con**: A `learned` phrase can only be as good as `ROLE_MATCH_MIN_SIMILARITY`'s threshold — too low admits titles that aren't real matches; too high defeats the point. `0.85` is a starting value, not a tuned one.
- **Con**: Duplicate detection is name-based only; two different people sharing an identical extracted name (rare but possible) would incorrectly trigger the duplicate flow, and the user's own manual resolution is the only correction.
