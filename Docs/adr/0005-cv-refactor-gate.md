# ADR 0005: Automated CV-Refactor Gate Before Embedding

**Status**: Partially superseded by [ADR 0008](0008-remove-cv-refactor-score-gate.md) — the score gate (decisions #3-4 below) was removed at explicit user request; the refactor rewrite itself (decision #2) still stands.
**Date**: 2026-09-15
**Author**: Claude Sonnet 5

An interactive Claude Code skill, `cv-refactor` (`.claude/skills/cv-refactor/SKILL.md`), rewrites a candidate's CV text to be clearer and more ATS-aligned without inventing facts, and produces a full set of human-facing deliverables (audit JSON, Markdown/PDF CV, LinkedIn content). The user wants its intent applied to every CV before it is sanitized and embedded into Chroma by the [semantic-matching pipeline](0004-semantic-matching-pipeline.md), which runs headless against a local Ollama model with no Claude/human in the loop.

**Decision**:

1. **Keep the full interactive skill as-is, for manual use.** It lives at `.claude/skills/cv-refactor/SKILL.md` (the standard project-skill location) and is unchanged — a candidate or recruiter can still run it directly in Claude Code to get the complete deliverable set.
2. **Add a separate, headless "cv-refactor" pass to the automated pipeline**, `packages/semantic-match/src/refactor.ts` (`CvRefactorClient`, `createOllamaCvRefactor`). It reuses the skill's core intent — rewrite for clarity/ATS-alignment while preserving every fact — as a single local-model chat call, plus a second call that scores CV text 0–100 against a simplified version of the skill's rubric. It does not produce any of the skill's deliverables; its only job is to prepare better text for `sanitizeCandidate`/embedding.
3. **Gate ingestion on the post-refactor score.** `processCandidate` (`packages/semantic-match/src/pipeline.ts`) now: refactors the raw CV, scores the refactored text, and rejects the candidate (`CvRefactorRejectedError`) if that score is below `CV_REFACTOR_MIN_SCORE` (80). Only a CV that clears the bar is sanitized, anchored, embedded, and upserted into Chroma. There is no separate baseline (pre-refactor) score — a weak source CV that the automated rewrite manages to lift past 80 still proceeds; scoring the raw text too was considered but dropped as an extra sequential Ollama call for a number nothing acts on (see "Consequences").
4. **Surface rejection through the existing failure path.** `CvRefactorRejectedError`'s message is a direct instruction to the user ("run the cv-refactor skill manually... then re-upload"). The candidate route already funnels any `processCandidate` error into `markCandidateFailed`, and the web UI already renders `candidate.error` as an alert when `status = 'failed'` — so no new plumbing was needed to get the warning in front of the user.

**Considered Options**:

- **Invoke the full interactive skill from the API route.** Rejected — the skill assumes an interactive Claude session (approval pauses, six generated deliverables) and the ingestion path is a headless Node process calling local Ollama only; there is no Claude model available inside that request.
- **Gate on the baseline (pre-refactor) score instead of the post-refactor score.** Rejected per explicit user instruction — the automated rewrite is expected to be able to lift a mediocre source CV over the bar; only a CV that still scores low *after* the model's best rewrite attempt should be turned away.
- **Silently drop rejected CVs instead of failing them visibly.** Rejected — the user asked for a warning message directing the candidate back to the manual skill, and the `candidates` table already has a `failed`/`error` status built for exactly this.

**Consequences**:

- **Pro**: Every CV that reaches Chroma has passed through the same clarity/ATS-alignment rewrite the manual skill would apply, using the existing injected-client testing pattern (`CvRefactorClient` is fully mockable, matching `SanitizerClient`/`VectorStore`).
- **Pro**: No new environment variables — the refactor client reuses `OLLAMA_HOST`/`OLLAMA_CHAT_MODEL`.
- **Con**: `processCandidate` now makes two sequential Ollama chat calls (refactor, score) instead of one, before the existing sanitize+embed calls — slower per-candidate ingestion, and a candidate can be rejected purely because the local chat model's rewrite/scoring pass underperforms, not because their underlying experience is weak. An earlier revision also scored the raw CV as a reported-only baseline; that third call was removed since nothing consumed the number and CPU-only Ollama inference makes every extra sequential call costly (minutes per call, see the ingestion-latency incident this ADR's blast radius touches).
- **Con**: The automated score is a heuristic single-model judgment, not the full multi-dimension scorecard the interactive skill produces; a rejected candidate has no visibility into *why* beyond the two numeric scores in the error message.
