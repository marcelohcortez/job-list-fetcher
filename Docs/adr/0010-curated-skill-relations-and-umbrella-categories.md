# ADR 0010: Curated Skill Relations (Accepted) + Umbrella Skill Categories (Proposed)

**Status**: Part Accepted, Part Proposed (see per-section status below)
**Date**: 2026-09-16
**Author**: Claude Sonnet 5

## Context

[ADR 0009](0009-skill-taxonomy-and-weighted-matching.md)'s skill-coverage scoring is exact-canonical-id-only: a job requiring "Customer-facing Experience" gets zero credit from a candidate who has "Stakeholder Management" on their CV, even though a human recruiter would immediately recognize these as overlapping. Three attempts to close this gap with a *computed* signal were tried on 2026-09-15/16 and reverted after testing against the real data:

1. **Gate matches on raw semantic similarity instead of the blended score.** Reverted: raw similarity is exactly what ADR 0009 replaced — nearly every job cleared the threshold regardless of relevance (Marcelo's match count went from 2 to 197).
2. **A syntactic classifier splitting job-required skills into "technical" vs "descriptive" by phrase length/keywords, shifting scoring weight toward similarity for descriptive-heavy jobs.** Reverted: the classifier mistook the LLM sanitizer's verbose phrasing style for behavioral content — a robotics job's "Experience with ROS/ROS2, real-time systems..." (a purely technical requirement, just phrased as a sentence) got misclassified as descriptive, flooding a frontend developer's matches with embedded-systems jobs.
3. **Embedding-similarity-based "contextual" skill matching** (cosine similarity between a job skill's embedding and a candidate skill's embedding, credited above some threshold). Reverted after calibration against the real ~950-skill vocabulary showed no reliable separation: generic competency labels ("Communication", "Collaboration") sit close to nearly everything in embedding space regardless of literal frequency, reintroducing ADR 0009's exact false-positive problem one level down. A follow-up "hubness" (embedding-centrality) refinement, meant to detect and exclude generic labels automatically, was calibrated against the same vocabulary and also showed no separation ("Communication" 0.43 vs "Python" 0.37 vs "Kubernetes" 0.40 — no meaningful gap).

The common failure mode: every computed/statistical approach relied on an emergent geometric or syntactic property that turned out not to hold on this specific, real skill vocabulary. The fix that actually worked for the motivating case (a Coretura customer-facing role) was unrelated to any of this — it was fixing the sanitizer's JSON schema to actually describe the `requiredSkills`/`softSkills` split to the LLM (it had none before), plus fixing the Lever source adapter to stop silently dropping each posting's requirements section. Both are separate, already-shipped fixes (see the 2026-09-15/16 conversation), not part of this ADR.

## Decision: Curated Skill Relations (Accepted, implemented 2026-09-16)

Replace the computed-similarity approach with a small, hand-maintained, reviewable table instead of inferring relations from geometry.

- **`skill_relations` table** (migration `008-skill-relations`): `(id, skill_id_a, skill_id_b, relation_type, weight, created_at)`, unique on `(skill_id_a, skill_id_b)`, stored bidirectionally (both `(a,b)` and `(b,a)` rows) so a lookup by either side is a plain equality query.
  - `relation_type` is descriptive/for-review: `equivalent` (near-synonyms, e.g. "Stakeholder Management" ↔ "Client Relationship Management") or `related` (adjacent but distinct, e.g. React ↔ Vue).
  - `weight` (0, 1] is what scoring actually uses — decoupled from `relation_type` so a curator can tune individual pairs without the type label constraining the number.
- **Seed file** (`apps/api/src/skill-relations-seed.ts`, `SKILL_RELATION_SEEDS`): a plain, reviewable array of `{a, b, type, weight}` entries, resolved to skill ids (creating + embedding the skill if it doesn't exist yet, mirroring `createSkillCanonicalizer`'s creation path) and seeded idempotently at API startup, the same pattern as `seedTargetRolePhrases`.
- **Scoring** (`blendScore` in `apps/api/src/routes/matches.ts`): for each job-required skill without an exact candidate match, look up curated relations for that skill id and take the best weight among partners the candidate holds; credit that weight (capped by the pair's curated value, never inferred).

This trades automation for reliability: a pair nobody has reviewed yields no credit (same as today), but a reviewed pair can never introduce the kind of blanket noise the computed approaches did, because the blast radius of any single bad entry is one pair, not a whole similarity threshold.

**Maintenance model**: the seed list is code, reviewed like code. Growing it is a deliberate, visible diff — not a silent behavior change from a model update or a recalibrated threshold.

## Proposal: Umbrella Skill Categories (Proposed — not yet implemented)

Separately raised: group specific technologies under a category (e.g. React/Vue/Angular/"frontend-utveckling" all under a "Frontend Development" umbrella) so a job requiring "Frontend Development" broadly can credit a candidate who has any frontend framework, not just an exact or curated-pair match.

**This ADR explicitly defers this decision** rather than bundling it with the relations work above, for one concrete reason: it reopens the same precision/recall trade-off that broke three times already. If a job specifically lists "Kubernetes" as a required skill and a candidate has only "Docker," should "same DevOps umbrella" grant credit? That's a real judgment call with no obviously-correct default, and it applies at the scale of the *entire* skill vocabulary (~950+ skills and growing), not a couple dozen curated pairs — meaning both the curation burden and the blast radius of a wrong category boundary are much larger than the relations work above.

### Sketch, for whoever picks this up

- **Data model**: `skill_categories(id, name)` + `skill_category_members(category_id, skill_id)` (many-to-many — a skill like TypeScript may reasonably belong to both Frontend and Backend).
- **Scoring**: a category match would need its own (lower, separately-tunable) credit weight distinct from `equivalent`/`related` relation weights — same-category membership is a much weaker signal than a curated pair, since two skills in "DevOps" can be as different as Kubernetes and a bash scripting habit.
- **Extraction-time tagging**: assign categories via a maintained keyword map at canonicalization time (fast, deterministic, no LLM/embedding call) rather than inferring category membership computationally — consistent with why the relations work above rejected a computed approach. Unmatched skills stay uncategorized and degrade gracefully to today's exact/relation-only behavior.
- **Curation cost**: to matter, this needs *sustained* curation as new skills appear from every ingestion run, not a one-time seed. Whoever owns this should budget for ongoing maintenance, not a single PR.
- **Visibility**: matches influenced by category-level credit should be visibly distinguishable from exact/relation matches in the API response and UI (e.g. "matched via: Frontend category"), so a wrong category boundary is easy to spot and correct rather than silently degrading trust in the whole score, the way the reverted computed approaches did.
- **Recommended first step if greenlit**: build it with credit weights conservative enough (e.g. 0.4-0.5, well below the `related`-relation range) that a wrong category boundary can't single-handedly push a job over the match threshold — then observe real match data before tuning upward.

**Decision needed before implementation**: whether the value (catching cases like "job wants a frontend framework, candidate has a different one") is worth the ongoing curation cost and the reopened precision risk, given the curated-relations work above already covers the concrete case that motivated this (customer-facing/stakeholder-management equivalences) at much lower risk.
