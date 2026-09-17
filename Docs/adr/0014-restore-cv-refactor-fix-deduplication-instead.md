# ADR 0014: Restore the CV-Refactor Step, Fix Deduplication Instead of Removing It

**Status**: Accepted
**Date**: 2026-09-17
**Author**: Claude Sonnet 5

Amends [ADR 0013](0013-remove-cv-refactor-rewrite-step.md), reversing its decision to delete the CV-refactor rewrite step, while keeping most of its diagnosis and its completeness guardrail.

**Context**:

Explicit user correction after ADR 0013 landed: the CV-refactor step has value (ATS-friendly rewriting) and should stay. The user's framing, precisely: *"I just didn't want it to remove any duplicates before putting the data in the vector DB... refactoring the CV yes, removing duplicates, no. When should duplicates be removed? When inserting the data in the DB."*

This reframes ADR 0013's diagnosis correctly. The observed bug (a CV's 6 "Git" mentions collapsing to 1 during rewrite, then the remaining one being dropped by the sanitizer) was really two separate defects layered together:

1. The rewrite step was deduplicating - a job it was never asked to do and has no business doing, since it can't reliably tell a legitimate repeat (the same tool genuinely used across three different jobs) from an accidental one.
2. The sanitizer was then dropping a base tool ("Git") because a compound/derived term ("GitOps") was also present.

ADR 0013 fixed #2 by prompt, then treated #1 as an unfixable-by-prompting structural risk and removed the whole rewrite step rather than keep chasing it. That went further than the actual problem warranted: #1 already had a working, verified prompt fix (see ADR 0013's own retest - "Git" and every other skill survived once the rewrite prompt was told not to deduplicate). The remaining residual risk ADR 0013 cited (one job entry still missing from a retest) is a real, separate long-document-fidelity concern, not a deduplication concern, and doesn't require deleting the step to manage.

The user's stated design principle is the one this pipeline should actually encode: **deduplication belongs exactly once, at the point skills are resolved to canonical ids and stored** - which, mechanically, is already true and unchanged throughout all of this: `createSkillCanonicalizer` (`apps/api/src/skill-taxonomy.ts`) collects resolved skill ids into a `Set` before `replaceCandidateSkills`/`replaceJobRequiredSkills` ever runs. The rewrite step was never supposed to be a second, earlier deduplication point - it just accidentally became one.

**Decision**:

1. **Restore `packages/semantic-match/src/refactor.ts`** (`CvRefactorClient`, `createOllamaCvRefactor`) and `processCandidate`'s call to it (`packages/semantic-match/src/pipeline.ts`) - `sanitizeCandidate` again runs against the refactored text, not the raw extraction.
2. **Keep the strengthened rewrite prompt from ADR 0013's retest**: explicit "this is a REFORMATTING pass, not a summarization pass," explicit "do NOT deduplicate, merge, or drop a tool/technology mention because it also appears elsewhere," explicit statement that deduplication happens later, downstream, never in this step.
3. **Keep the base-tool-vs-compound-term fix** to `sanitizeCandidate`'s/`sanitizeJob`'s shared prompt (`ollama.ts`) from ADR 0013 - unrelated to the rewrite-step question, still correct on its own.
4. **Keep `warnIfSuspiciouslyEmpty`** (`pipeline.ts`) - a generically useful guardrail against silent extraction failure, independent of whether a rewrite step sits in front of extraction.
5. **Keep `npm run backfill:cvs`** (`apps/api/src/scripts/backfill-cvs.ts`) - still the correct tool for pushing prompt fixes out to already-uploaded candidates, now running the restored refactor → sanitize → skill-canonicalize sequence instead of sanitize-only.

**Considered Options**:

- **Leave ADR 0013's removal in place, treat the missing-job-entry issue as a separate follow-up.** Rejected - the user was explicit that the refactor step itself is wanted; removing it to manage a risk that has its own independent fix path (chunking, a stronger model, or the guardrail below) overcorrected past what the actual complaint was.
- **Restore the rewrite step but also re-add a completeness check specifically comparing raw-vs-refactored job-entry counts (the "option 1" guardrail from the earlier discussion).** Not ruled out for later, but not implemented here - `warnIfSuspiciouslyEmpty` already covers the sharpest failure mode (an extraction that silently yields nothing), and a job-entry-count diff needs a per-document-format heuristic (detecting "job entry" boundaries in arbitrary CV layouts) that's a bigger, separate piece of work than this correction warrants.

**Consequences**:

- **Pro**: Matches the user's actual intent - CVs still get ATS-style cleanup before matching, and the single, correct deduplication point (skill-canonicalization at storage time) is unchanged and undisturbed by this whole back-and-forth.
- **Pro**: The concrete bug that started this (Git dropped) stays fixed - verified via the ADR 0013 retest, which is still valid since the prompt fix, not the step's removal, is what fixed it.
- **Con**: The long-document-fidelity risk ADR 0013 flagged (an occasional whole job entry compressed away on a very long, many-role CV) is real and still present - mitigated only by the "don't summarize" prompt instruction, not eliminated. If it recurs, the next step is one of the options from the original options discussion (chunk-and-merge refactor, or a larger model for this call) rather than removing the step again.
- **Con**: `processCandidate` is back to two sequential Ollama calls (refactor, then sanitize) instead of one - slower per-candidate ingestion, the tradeoff ADR 0013 had removed and this ADR reinstates.
