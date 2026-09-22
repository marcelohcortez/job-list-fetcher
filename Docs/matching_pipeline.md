# How Matching Works

This is the current, living reference for how a candidate gets matched to a job opening — every stage, in order, and **which file to edit** to change each stage's behavior. For the *history* of why the scoring formula looks the way it does (including three approaches that were tried and reverted), see [ADR 0009](adr/0009-skill-taxonomy-and-weighted-matching.md), [ADR 0010](adr/0010-curated-skill-relations-and-umbrella-categories.md), and [ADR 0012](adr/0012-candidate-role-category-and-mismatch-penalty.md) (role-category compatibility). This document describes the shipped behavior only.

## Overview

A match score blends two independent signals, then applies two multiplicative discounts:

1. **Required-skill coverage** — does the candidate hold (or have a curated equivalent/related skill to) each of the job's discrete required skills? Literal, auditable, dominates the score by default.
2. **Whole-document semantic similarity** — cosine similarity between one embedding of the whole job description and one embedding of the whole CV. Used as a fallback when a job has no discrete required skills, and as the smaller component of the blend otherwise.
3. **Role-category compatibility** (ADR 0012) — a multiplicative penalty (`ROLE_MISMATCH_PENALTY`) applied when the job's and candidate's coarse role categories (engineer, designer, product manager, ...) are both known and incompatible, regardless of how high the two signals above scored.
4. **No-required-skills discount** (ADR 0012) — a separate multiplicative penalty (`NO_REQUIRED_SKILLS_PENALTY`) applied whenever a job has zero extracted required skills, since scoring then rests entirely on the least reliable signal (semantic similarity).

Skill coverage dominates *on purpose*: two very different roles can share enough generic vocabulary ("engineer", "cloud", "team") to look deceptively similar on whole-document similarity alone (see ADR 0009). Coverage is the literal, checkable signal; similarity is the fallback for when there's nothing literal to check. Role-category compatibility exists because *neither* of those signals ever checks what kind of role is being matched at all — see ADR 0012 for the CV-scored-75%-against-an-unrelated-role case that motivated it.

## Stage by stage

### 1. Ingestion & scope filtering

Every source adapter (`packages/source-adapters/src/*.ts`) fetches raw postings and normalizes them into a `SourceRecord`. Before a posting is stored, it must pass:

- **Title scope** — the title must match the `TARGET_ROLES` vocabulary (`packages/domain/src/target-roles.ts` — includes a curated set of Swedish role phrases for boards that post in Swedish, see [ADR 0011](adr/0011-swedish-target-roles-seed.md)), or come close enough to a known role phrase via a vector fallback (`apps/api/src/role-scope.ts`, `ROLE_MATCH_MIN_SIMILARITY`, default `0.85`). A title accepted only via the vector fallback is folded back into the `target_role_phrases` table, so the vocabulary grows from real postings. The vector fallback alone does not reliably bridge languages at the default threshold — Swedish titles need a Swedish anchor phrase in `TARGET_ROLES` to match against, not just an English one close in meaning.
- **Location scope** — must be Gothenburg/Göteborg, Europe/EMEA-wide, or remote tied to Europe (`packages/domain/src/target-filter.ts`).

**To change which job titles are considered**: edit `TARGET_ROLES` in `packages/domain/src/target-roles.ts`.
**To change location rules**: edit `matchesTargetLocation`/`NON_EMEA_LOCATION_RE` in `packages/domain/src/target-filter.ts`.

### 2. Source completeness

A posting's `description` field is only as good as what the adapter captured. This matters a lot for matching: a job with an empty/boilerplate-only description yields no discrete required skills at sanitize time (step 4) and falls all the way back to raw semantic similarity (the least reliable signal — see "Known limitations" below).

Concretely: Lever's API splits a posting into an intro (`descriptionPlain`) and a separate `lists` array of labelled sections ("What You Will Do:", "What You Will Bring:", etc.) — the actual requirements usually live in `lists`, not the intro. `packages/source-adapters/src/lever.ts`'s `resolveDescription` concatenates both; if a future adapter (or a Lever API change) starts dropping content again, the symptom is the same as a genuinely vague job ad — zero required skills — so if a *specific* company's jobs all show `skillCoverage: null`, check the raw API response for that source before assuming the ad is just vague.

**To change what text is captured per source**: edit that adapter's `resolveDescription`/`toSourceRecord` in `packages/source-adapters/src/<source>.ts`.

### 3. Sanitization (LLM extraction)

`packages/semantic-match/src/ollama.ts` sends the job's `title + company + description` (or a CV's extracted text) to a local LLM (`OLLAMA_CHAT_MODEL`, default `qwen2.5:7b`), which extracts it into the shared `SanitizedProfile` shape (`packages/semantic-match/src/schema.ts`):

| Field | Content |
| --- | --- |
| `title` | Job title / candidate's most recent or target title |
| `requiredSkills` | **Hard/technical skills only** — named tools, languages, frameworks, platforms, certifications, methodologies. Feeds discrete skill-coverage scoring (step 5). |
| `softSkills` | Behavioral/interpersonal/mindset qualities. Feeds only the whole-document anchor (step 4) — never discrete scoring. |
| `experienceProfile` | Years/seniority/degree text |
| `coreResponsibilities` | Task list |

The `requiredSkills`/`softSkills` split is what determines whether a job's scoring is dominated by literal skill-coverage or falls back to similarity — **getting this split right matters more than any scoring-side tuning**. The field descriptions actually sent to the model live in `PROFILE_JSON_SCHEMA` in `ollama.ts` (sourced from `PROFILE_FIELD_DESCRIPTIONS` in `schema.ts`, one shared definition so the zod schema and the JSON schema sent to the LLM can't drift apart) and are reinforced again in the system prompt (`SKILL_SPLIT_INSTRUCTION`).

**To change what counts as a "hard" skill vs a "soft" one**: edit `PROFILE_FIELD_DESCRIPTIONS.requiredSkills`/`.softSkills` in `packages/semantic-match/src/schema.ts`, and `SKILL_SPLIT_INSTRUCTION` in `packages/semantic-match/src/ollama.ts` (both should stay in sync — they're the same instruction stated twice, once in the schema, once in the prompt, because both reach the model).

This classification is LLM-driven and not perfectly deterministic in practice — the same job text has been observed to classify a borderline item differently across runs. There is no hard guarantee here, only a strongly-worded instruction; if a specific job's skill split looks wrong, re-running its sanitization (see "Re-processing existing jobs" below) sometimes corrects it.

A candidate's CV is rewritten for ATS-style clarity by the same local model before this step (see [ADR 0005](adr/0005-cv-refactor-gate.md)/[ADR 0008](adr/0008-remove-cv-refactor-score-gate.md), `packages/semantic-match/src/refactor.ts`) — sanitization runs against that rewritten text, not the raw extraction. This rewrite step was briefly removed and then restored ([ADR 0013](adr/0013-remove-cv-refactor-rewrite-step.md) / [ADR 0014](adr/0014-restore-cv-refactor-fix-deduplication-instead.md)) after tracing a real bug to it: the rewrite was silently deduplicating a repeated skill mention ("Git," listed under three job entries, collapsed to one), and the sanitizer then dropped that sole survivor entirely (conflating it with the also-present "GitOps"). The sanitizer conflation is fixed by prompt (base tool vs. compound term are distinct — see `ollama.ts`). The rewrite step's prompt is now explicit that deduplication is never its job — every mention of every tool must survive the rewrite exactly as the source CV lists it; deduplication happens exactly once, downstream, when skills are resolved to canonical ids at storage time (`createSkillCanonicalizer`, a `Set` of skill ids — see "Skill taxonomy" above). As a partial safety net against silent extraction failure more generally (for both jobs and candidates), `warnIfSuspiciouslyEmpty` (`packages/semantic-match/src/pipeline.ts`) logs a warning whenever a source with ≥ 800 chars of text yields zero `requiredSkills` **and** zero `softSkills` — not a fix, but it turns a silent bad extraction into a visible one.

Right after sanitization, `sanitized.title` is also run through `categorizeRoleTitle` (`packages/domain/src/role-categories.ts`, see ADR 0012) to derive a coarse `role_category` (`engineering`, `design`, `product-management`, ...), stored alongside the sanitized output on `job_embeddings`/`candidates`. A title that doesn't clearly match any known pattern classifies as `null` ("unknown"), which step 7's scoring treats as "no signal to penalize" rather than a mismatch.

**To change the role-category taxonomy or classification rules**: edit `CATEGORY_PATTERNS`/`ADJACENT_CATEGORIES` in `packages/domain/src/role-categories.ts`.

### 4. Anchor document + whole-document embedding

`packages/semantic-match/src/anchor.ts` renders the sanitized fields (including `softSkills`) back into one plain paragraph under shared headers (`JOB TITLE:`, `TECHNICAL SKILLS:`, `SOFT SKILLS:`, `EXPERIENCE PROFILE:`, `CORE RESPONSIBILITIES:`) — plain text, not JSON, since JSON punctuation degrades embedding similarity. This is embedded with `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`) and stored in Chroma (`job_openings`/`candidates` collections, cosine similarity). This embedding is what produces `semanticSimilarity` in the match response.

**To change the anchor template**: edit `buildAnchorDocument` in `packages/semantic-match/src/anchor.ts` — but note both job and candidate profiles must go through the *same* template, or their vectors stop being comparable.

### 5. Skill canonicalization

Each string in `requiredSkills` (job side) or the candidate's own skill list is resolved to one canonical `skills` row (`apps/api/src/skill-taxonomy.ts`, `createSkillCanonicalizer`) in three steps, cheapest first:

1. **Normalize formatting** (`normalizeSkillLabel`, `packages/domain/src/skill-normalizer.ts`) — lowercase, strip accents/punctuation, collapse whitespace. Free, no model call. Collapses `Front-End`/`front end`/`FRONTEND` for nothing.
2. **Exact lookup** of the normalized string against the `skills` table.
3. **Vector fallback** on a miss — embed the normalized string, query the `skills` Chroma collection; a hit at ≥ `SKILL_MATCH_MIN_SIMILARITY` (default `0.82`) reuses that skill's id instead of minting a near-duplicate. This is what folds in synonyms, abbreviations, and cross-language spellings (Swedish `frontend-utveckling` ↔ English `frontend`).

If nothing matches, a new canonical skill is minted and embedded. The vocabulary grows the same self-correcting way `target_role_phrases` does.

**To change the merge threshold**: `SKILL_MATCH_MIN_SIMILARITY` env var. Raising it makes the vocabulary stricter (more near-duplicate skills); lowering it risks merging genuinely different skills together. `0.82` was chosen because it's strict — this step answers "is this the same skill," not "is this a related skill" (that's step 6).

### 6. Skill relations (curated equivalences)

Exact-id matching alone misses cases like a candidate's "Stakeholder Management" satisfying a job's "Customer-facing Experience" requirement — related concepts that were never merged in step 5 because the merge threshold is deliberately strict. `skill_relations` (migration `008-skill-relations`) is a small, **hand-curated, reviewable** table of such pairs — not computed from embeddings (see ADR 0010 for why a computed version of this was tried three ways and reverted every time).

Each row: `(skill_id_a, skill_id_b, relation_type, weight)`, stored bidirectionally. `relation_type` is `equivalent` (near-synonyms, weight typically 0.85-1.0) or `related` (adjacent but distinct, weight typically 0.5-0.7) — descriptive only; `weight` is what scoring actually uses.

**To add/change a skill relation**: edit `SKILL_RELATION_SEEDS` in `apps/api/src/skill-relations-seed.ts` — a plain array of `{a, b, type, weight}` entries using plain skill label text (not ids; ids are resolved/created automatically at startup). Restart the API to reseed (idempotent — safe to re-run, only inserts pairs that don't already exist). This is the **primary lever for "these two things should count as similar" requests** — most such requests belong here, not in the scoring formula.

### 7. Match scoring

`apps/api/src/routes/matches.ts`, `blendScore`, run per (candidate, job) pair:

For each of the job's required skills:
- **Exact match** (candidate holds the same canonical skill) → credit `1`.
- **No exact match, but a curated relation exists** to a skill the candidate holds → credit the relation's `weight` (best one, if multiple apply).
- **Neither** → credit `0`.

```
skillCoverage = (sum of credits) / (number of required skills)
score = SKILL_OVERLAP_WEIGHT * skillCoverage + (1 - SKILL_OVERLAP_WEIGHT) * semanticSimilarity
```

**If the job has zero required skills** (empty list after step 3 — a genuinely vague ad, or one whose only requirements are soft skills), `score = semanticSimilarity * roleMultiplier * NO_REQUIRED_SKILLS_PENALTY` and `skillCoverage` is reported as `null` (not `0`) — this distinguishes "verified zero overlap" from "no skill signal available at all" in the API response. `NO_REQUIRED_SKILLS_PENALTY` (default `0.75`) discounts this case specifically because it's scoring on semantic similarity alone, with no literal signal at all (ADR 0012).

**Role-category compatibility** (ADR 0012, `areRoleCategoriesCompatible` in `@job-fetcher/domain`) applies on top of the blend either way: `roleMultiplier` is `1` when the job's and candidate's `role_category` (step 3) are equal, adjacent (see `ADJACENT_CATEGORIES`), or either is unknown (`null`) — and `ROLE_MISMATCH_PENALTY` (default `0.5`) otherwise. This is what catches a confidently-wrong match neither skill coverage nor semantic similarity would: e.g. a `design`-categorized CV against a `product-management` job.

```
score = (SKILL_OVERLAP_WEIGHT * skillCoverage + (1 - SKILL_OVERLAP_WEIGHT) * semanticSimilarity) * roleMultiplier
```

A job counts as a match only if `score >= MATCH_MIN_SIMILARITY` (default `0.65`). Results are capped at `MATCH_TOP_K` per candidate if set (unset by default — no limit); this caps how many jobs the vector search considers as *candidates* for scoring, not the final match count after filtering.

**To change scoring weights/thresholds**: env vars `SKILL_OVERLAP_WEIGHT` (default `0.6`), `MATCH_MIN_SIMILARITY` (default `0.65`), `MATCH_TOP_K` (default unset), `ROLE_MISMATCH_PENALTY` (default `0.5`), `NO_REQUIRED_SKILLS_PENALTY` (default `0.75`). To change the scoring *logic itself* (not just its weights): `blendScore` in `apps/api/src/routes/matches.ts`.

### 8. API surface

- `GET /api/matches` — every sanitized candidate with their ranked, filtered matches.
- `GET /api/matches/candidates/:id` — matches for one candidate.

Each match includes: `similarity` (the blended score used for ranking/filtering), `semanticSimilarity` (raw whole-document cosine similarity), `skillCoverage` (`null` if the job had no required skills), `matchedSkillCount`/`requiredSkillCount`, and `matchedSkills`/`missingSkills` (labels — currently no distinction between an exact match and a relation-credited one in the response; see ADR 0010's umbrella-category proposal for where a "matched via" indicator would also apply).

## Re-processing existing jobs

Changes to sanitization (step 3), canonicalization (step 5), or relations (step 6) only affect *already-stored* jobs if they're re-processed:

- **Skill relations** (step 6) reseed automatically on every API startup (`seedSkillRelations`, idempotent) — no re-processing needed, since relations are looked up at query time, not baked into stored data.
- **Sanitization/canonicalization changes** (steps 3 and 5) require re-running extraction against already-stored jobs: `npm run backfill:skills --workspace @job-fetcher/api` re-sanitizes every job opening and re-canonicalizes its required skills, using whatever `packages/semantic-match`/`apps/api/src/skill-taxonomy.ts` code is current. It's an LLM call per job — budget real time for a full sweep (a few hundred jobs took roughly 10-15 minutes against a local `qwen2.5:7b`, most of it spent on inference, not the deliberate 250ms rate-limit between calls). The candidate-side equivalent is `npm run backfill:cvs --workspace @job-fetcher/api` (added in [ADR 0013](adr/0013-remove-cv-refactor-rewrite-step.md)) — re-sanitizes and re-canonicalizes every already-`sanitized` candidate the same way; run it after any change to `sanitizeCandidate`'s prompt/schema.
- **Source-adapter changes** (step 2) require re-running ingestion (`POST /api/ingestion/run`) to re-fetch from the source — a stored job whose upstream posting hasn't changed shows up as `deduplicated` and is left untouched, so an adapter fix alone doesn't retroactively fix already-stored jobs; a job must actually re-fetch with different content (or the adapter fix needs a following ingestion run) to pick it up. A posting the source no longer lists at all (closed/removed) is never revisited by ingestion and stays stale indefinitely — there's no reconciliation job for this yet (see ADR 0010's umbrella-category section, which flags the same gap).

## Known limitations

- **Jobs with no discrete required skills fall back to pure semantic similarity**, which cannot reliably distinguish a genuine fit from an unrelated role that happens to share vocabulary (see ADR 0009's original motivation, and ADR 0010's account of three reverted attempts to fix this computationally). This affects roughly 14% of currently-stored postings (42/303 as of the 2026-09-22 audit below) — mostly senior/customer-facing/marketing-track ads that genuinely list no named technical requirements. There is no code fix for this beyond ensuring extraction is as accurate as possible (step 3) and adapters capture full content (step 2); a stricter threshold or distinct UI treatment for `skillCoverage: null` matches is an open option, not yet implemented.
- **Skill relations only cover pairs someone has curated.** A pair that matters but isn't in `SKILL_RELATION_SEEDS` gets zero credit, same as before this feature existed — it never makes things worse, but coverage is only as good as the list.
- **No umbrella/category-level matching** (e.g. crediting a candidate's "Vue" against a job's "Frontend Development" requirement generically) — proposed but deliberately not implemented; see ADR 0010.
- **Stale source records**: a closed/removed posting is never re-visited or pruned once ingestion stops returning it.
- **`role_category` is a coarse, keyword-based classifier** (ADR 0012) — a title that doesn't clearly match any known pattern classifies as `null` ("unknown") and gets no role-compatibility protection at all, and a title that's genuinely ambiguous across categories may be miscategorized. A candidate sanitized before this classifier existed picks up a `role_category` the next time `npm run backfill:cvs` runs (see above) rather than staying `null` until re-uploaded. **This is a bigger hole than it sounds**: 87/303 stored jobs (29%, 2026-09-22 audit) currently have `role_category = null` and so get zero role-mismatch protection no matter how unrelated the role.
- **No seniority/experience-level signal at all.** The pipeline checks *what kind* of role (via `role_category`) but never *what level* — nothing stops a junior CV outscoring a senior-only posting or vice versa. There's no discrete field for this today (`experienceProfile` is free text, not structured, and isn't used in `blendScore`). Would need the same treatment `role_category` got in ADR 0012: a coarse extracted level + a compatibility/adjacency table + a multiplicative penalty.
- **Skill-coverage credit doesn't scale with how many required skills there are.** `skillCoverage` is a ratio (`matched / total`), so a job with exactly 1 required skill that happens to match scores a perfect `1.0` — identical to a job where 10/10 matched — even though one match is far weaker evidence of fit than ten. Combined with `SKILL_OVERLAP_WEIGHT` (0.6) dominating the blend, a thin 1-skill job can outrank a genuinely well-matched job with many overlapping skills. 33/303 stored jobs (11%) have only 1-2 required skills and are most exposed to this. Not yet fixed; a per-skill-count confidence dampener (e.g. scaling `skillOverlapWeight` down, or requiring a minimum `requiredSkillCount` for full weight) is an open option.

### Audit findings (2026-09-22)

Ran a live audit against the current DB (303 jobs, 12 sanitized candidates) after a report that match quality still felt off. Two structural gaps above (`role_category` null rate, low-required-skill-count inflation) were sized during this audit. It also surfaced one concrete **canonicalization bug**, not just a modeling gap:

- **`normalizeSkillLabel` collapses "C#" and "C"/"C++" to the same token**, because it strips every non-alphanumeric character (`packages/domain/src/skill-normalizer.ts`: `.replace(/[^a-z0-9]+/g, ' ')`). `#` and `+` are stripped like any other punctuation, so `"C#"` → `"c"` and a bare `"C"` (as extracted from a `"C/C++"` requirement) also → `"c"` — an exact collision at the cheap normalize-then-lookup step (step 5.2), before the stricter vector fallback ever runs.
  - **Confirmed in stored data**: of the 65 stored jobs whose required skills resolved to the `C#` canonical skill, 46 (71%) never mention "C#" anywhere in their description — they're embedded/C++ postings (e.g. "Embeddedutvecklare på Syntronic i Göteborg!", "Senior embeddedutvecklare till attraktivt konsultbolag") whose only relevant text is "C/C++" or "God kunskap inom C/C++...".
  - **Concrete impact on matches**: these mistagged jobs typically have only this one (wrong) required skill, so any candidate who lists "C#" on their CV — a completely unrelated language — gets `skillCoverage: 1.0` against an embedded-systems job and it outranks their genuinely relevant matches. Observed directly for two of the twelve sanitized candidates (a data/AI-track and an uncategorized-role candidate), whose single highest-scoring matches were these mistagged embedded postings.
  - **Not yet fixed.** The fix is narrow — stop stripping `#`/`+` in `normalizeSkillLabel` (they're meaningful in `C#`, `C++`, `F#`) — but it changes `normalized_label` for every existing symbol-bearing skill row, so it needs a migration/re-backfill (`npm run backfill:skills`) alongside the code change, not just the one-line fix. Flagged here rather than fixed inline since it touches scoring-relevant data at rest; do this next if pursuing better matches further.

## Quick reference: what to edit

| Want to change... | Edit this |
| --- | --- |
| Which job titles are in scope | `packages/domain/src/target-roles.ts` (`TARGET_ROLES`) |
| Location scope rules | `packages/domain/src/target-filter.ts` |
| What counts as "hard" vs "soft" skill | `packages/semantic-match/src/schema.ts` (`PROFILE_FIELD_DESCRIPTIONS`) + `packages/semantic-match/src/ollama.ts` (`SKILL_SPLIT_INSTRUCTION`) |
| Skill formatting normalization | `packages/domain/src/skill-normalizer.ts` |
| Skill merge/canonicalization strictness | `SKILL_MATCH_MIN_SIMILARITY` env var |
| "These two skills should correlate" | `apps/api/src/skill-relations-seed.ts` (`SKILL_RELATION_SEEDS`) — the primary lever for most match-quality tweaks |
| Match scoring weights/thresholds | `SKILL_OVERLAP_WEIGHT`, `MATCH_MIN_SIMILARITY`, `MATCH_TOP_K`, `ROLE_MISMATCH_PENALTY`, `NO_REQUIRED_SKILLS_PENALTY` env vars |
| Match scoring logic itself | `apps/api/src/routes/matches.ts` (`blendScore`) |
| Role-category taxonomy/classification | `packages/domain/src/role-categories.ts` (`CATEGORY_PATTERNS`, `ADJACENT_CATEGORIES`) |
| Anchor document template | `packages/semantic-match/src/anchor.ts` |
| Which companies/boards are fetched | `GREENHOUSE_BOARDS`/`LEVER_BOARDS` env vars, or `packages/source-adapters/src/boards.ts` for permanent defaults |
| What text a source captures | That source's adapter in `packages/source-adapters/src/<source>.ts` |
| Applying any of the above to already-stored jobs | See "Re-processing existing jobs" above |
