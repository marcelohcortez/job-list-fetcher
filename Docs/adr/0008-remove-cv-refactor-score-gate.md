# ADR 0008: Remove the CV-Refactor Score Gate

**Status**: Accepted
**Date**: 2026-09-15
**Author**: Claude Sonnet 5

Amends [ADR 0005](0005-cv-refactor-gate.md), which gated candidate ingestion on a post-refactor quality score (`CV_REFACTOR_MIN_SCORE = 80`).

**Context**:

Explicit user instruction: allow a CV into Chroma even when its post-refactor score is below 80 — drop the score check entirely, not just loosen its threshold.

**Decision**:

1. **Delete the gate, not just widen it.** `processCandidate` (`packages/semantic-match/src/pipeline.ts`) no longer calls `scoreCv` at all; it refactors the CV and sanitizes the result unconditionally. `CV_REFACTOR_MIN_SCORE` and `CvRefactorRejectedError` are removed, not deprecated in place.
2. **Remove `scoreCv` from `CvRefactorClient` entirely** (`packages/semantic-match/src/refactor.ts`), along with its system prompt and JSON schema — with no caller left, keeping it would be dead code passing itself off as live.
3. **Keep the rewrite step.** Only the score-and-reject half of ADR 0005 is removed; the CV is still refactored for clarity/ATS-alignment before sanitizing (see ADR 0005 decision #2) — that part of the pipeline is unaffected.

**Considered Options**:

- **Lower `CV_REFACTOR_MIN_SCORE` instead of removing it.** Rejected — the user asked to remove the verification process, not tune it; a lowered-but-present threshold still rejects some CVs for a reason the user explicitly doesn't want applied.
- **Keep `scoreCv` computing and reporting the score without gating on it** (mirrors how ADR 0004's baseline score was reporting-only before it, too, was removed for cost). Rejected — with nothing consuming the number, it's an extra ~1-3 minute-class Ollama call for no behavioral effect, same reasoning that already removed the baseline score call.

**Consequences**:

- **Pro**: One fewer sequential Ollama chat call per candidate (`processCandidate` is now refactor → sanitize → embed) — faster ingestion, compounding with [ADR 0007](0007-native-ollama-not-containerized.md)'s native-Ollama speedup.
- **Pro**: No CV is ever rejected for quality; every upload that can be parsed and refactored reaches Chroma.
- **Con**: A CV whose automated rewrite comes out badly (garbled, incomplete, low-signal) is now embedded and matched exactly as-is — there is no floor. The interactive `cv-refactor` skill remains available for a candidate/recruiter who wants a manually-produced, higher-quality rewrite instead, but nothing in the automated path suggests using it anymore.
