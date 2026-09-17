# ADR 0013: Remove the CV-Refactor Rewrite Step

**Status**: Accepted
**Date**: 2026-09-17
**Author**: Claude Sonnet 5

Amends [ADR 0005](0005-cv-refactor-gate.md) (which introduced the rewrite step) and [ADR 0008](0008-remove-cv-refactor-score-gate.md) (which removed its quality gate but explicitly kept the rewrite itself, decision #3).

**Context**:

Investigating why a candidate's skill count came out far lower than their CV supports (see the matches-scoring discussion this ADR follows on from — `SKILL_OVERLAP_WEIGHT`/`skill_relations` tuning), a specific extraction gap traced back further than expected: the candidate's CV literally listed "Git" six times across different roles, but it was silently absent from `requiredSkills` after sanitizing.

Reproduced deterministically (temperature 0, same model, same input) by tracing the candidate's raw CV text through both `processCandidate` stages independently:

1. **`refactorCv`** (the free-text rewrite pass) collapsed the CV's 6 "Git" mentions down to 1 in its output - a repeated tool mentioned under several job entries got deduplicated into a single mention, something the rewrite prompt was never asked to do and had no reason to do.
2. **`sanitizeCandidate`** then dropped that single remaining "Git" mention entirely, apparently conflating it with the also-present "GitOps" as redundant.

Tightening `sanitizeCandidate`'s prompt (base tool vs. compound term are distinct - see `ollama.ts`) fixed #2. Tightening `refactorCv`'s prompt (no deduplication, no summarization, cover every job entry at comparable detail) reduced but did not eliminate #1: on a retest against the same 10-job-entry CV, the strengthened prompt recovered "Git" and every other previously-extracted skill, but a full job entry (a role at a different employer, with its own `TOOLS:`/`TECHNOLOGIES:` list) was still missing from the rewritten output. Free-text generation has no structural guardrail against silently dropping a list item the way schema-constrained JSON output does - `sanitizeCandidate`/`sanitizeJob` fail loudly (bad JSON, `zod` parse error) on truncation or malformed output; a prose rewrite that drops a paragraph looks like well-formed output either way.

**Decision**:

Remove the rewrite step from the automated pipeline rather than continue tuning its prompt:

1. `processCandidate` (`packages/semantic-match/src/pipeline.ts`) now calls `sanitizer.sanitizeCandidate(rawText)` directly on the raw extracted CV text - no intermediate rewrite.
2. `packages/semantic-match/src/refactor.ts` (`CvRefactorClient`, `createOllamaCvRefactor`) is deleted, not deprecated in place - it had no consumer left once removed from `processCandidate` (confirmed by search: nothing else in the codebase called it).
3. Added a lightweight completeness guardrail in `pipeline.ts` (`warnIfSuspiciouslyEmpty`, applies to both `processJobOpening` and `processCandidate`): if the source text is long (≥ 800 chars) but extraction yields zero `requiredSkills` **and** zero `softSkills`, log a warning. This doesn't fix a bad extraction, but it turns a silent failure into a visible one - the actual failure mode this ADR responds to (Git disappearing) produced no error and no log line anywhere.
4. New script `apps/api/src/scripts/backfill-cvs.ts` (`npm run backfill:cvs`) - there was no candidate-side equivalent of `backfill-skills.ts` before this (a known gap noted in `Docs/matching_pipeline.md`'s "Known limitations"). Re-runs `sanitize -> skill-canonicalize` for every already-`sanitized` candidate against the current pipeline/prompts. Run once against all existing candidates as part of this change.

**Considered Options**:

- **Keep tuning the rewrite prompt further** (chunk-and-merge per job entry, or a stronger/larger model for this one call). Rejected for now - more code/latency/Ollama load for a step that, per the "no consumer left" check above, existed only to feed `sanitizeCandidate` and had no other purpose in this codebase. Fixing the failure mode is worth less than removing the component that has it.
- **Keep the rewrite step and add the verification-guardrail idea against *its* output specifically** (diff company/job-entry count between raw and rewritten text, fall back to raw on mismatch). Rejected as a permanent design - once the rewrite step is gone, there is nothing for that guardrail to protect against; it would be solving a problem this ADR's decision removes at the root. The completeness guardrail in decision #3 is the generically useful piece of that idea, kept independent of any rewrite step.
- **Leave `refactor.ts` in the tree, unused, in case a future feature wants it.** Rejected - dead code with no current caller is a maintenance liability (it would silently rot, untested against prompt/schema drift elsewhere), and it's a two-line git revert away if actually needed again.

**Consequences**:

- **Pro**: Removes the exact mechanism that caused the silent skill loss - `sanitizeCandidate`'s schema-constrained output is already robust to messy/plain raw CV text (see `PROFILE_JSON_SCHEMA`), so the rewrite was net risk for no measured extraction-quality benefit.
- **Pro**: One fewer sequential Ollama call per candidate upload (`processCandidate` is now sanitize → embed only) - faster ingestion, continuing the trend of ADR 0008's gate removal.
- **Pro**: All 23 already-`sanitized` candidates get their skills refreshed against the corrected pipeline via `backfill:cvs`, not just future uploads.
- **Con**: The candidate-facing text embedded and matched is now whatever the raw PDF extraction (`apps/api/src/cv/pdf.ts`) produces, unmediated - no more ATS-style clean-up pass smoothing over PDF-extraction line-break/spacing artifacts before extraction. `sanitizeCandidate`'s own prompt has always had to tolerate this (job ads are never rewritten either), so this is a return to that baseline, not a new risk class.
- **Con**: The interactive `.claude/skills/cv-refactor` skill (unaffected by this change - it's a separate, manually-invoked skill, not code that imports `refactor.ts`) is no longer mirrored by anything in the automated path; a recruiter wanting an ATS-polished rewrite of a candidate's CV text has to run that skill by hand, same as ADR 0008 already noted for the quality-gate removal.
