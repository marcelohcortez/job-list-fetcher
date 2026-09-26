# Current Flow Overview

Snapshot of the end-to-end pipeline as of 2026-09-24 — from raw job-board posting to a scored match shown in the UI. For scoring-formula rationale and full field-by-field detail, see [matching_pipeline.md](matching_pipeline.md); for Laya specifically, see [laya-integration-plan.md](laya-integration-plan.md).

## 1. Ingest

Each source adapter in [`packages/source-adapters/src/*.ts`](../packages/source-adapters/src) (Greenhouse, Lever, Teamtailor, Cinode Market, Jobtech, Keyman, TheirStack) fetches raw postings from its board and normalizes them into a `SourceRecord` (title, company, location, description, deadline, status, raw payload).

## 2. Scope filtering (before storage)

Handled in [`ingestion-runner.ts`](../apps/api/src/ingestion-runner.ts). A posting must pass all of:

- **Eligibility** — not expired/withdrawn, not published more than 6 months ago.
- **Location** — Gothenburg/Göteborg, Europe/EMEA-wide, or remote tied to Europe (`matchesTargetLocation`, [`target-filter.ts`](../packages/domain/src/target-filter.ts)).
- **Title scope** — matches the curated `TARGET_ROLES` vocabulary ([`target-roles.ts`](../packages/domain/src/target-roles.ts)) by regex, or falls back to a vector-similarity check against the self-learning `target_role_phrases` table ([`role-scope.ts`](../apps/api/src/role-scope.ts)). The fallback embeds **title + description** (not title alone), so an odd/non-standard title with a clearly in-scope description still passes. A title accepted only via the fallback gets folded back into `target_role_phrases`, so the vocabulary grows from real postings.

Anything failing eligibility, location, or title scope is rejected and never stored or sanitized.

## 3. Sanitization (LLM extraction)

[`ollama.ts`](../packages/semantic-match/src/ollama.ts) sends the job's `title + company + description` (or a candidate's CV text) to a local model (`OLLAMA_CHAT_MODEL`, default `qwen2.5:7b`), extracting:

| Field | Content | Used for |
| --- | --- | --- |
| `requiredSkills` | Hard/technical skills only | Discrete skill-coverage scoring |
| `softSkills` | Behavioral/interpersonal qualities | Whole-document anchor only, never discrete scoring |
| `experienceProfile` | Years/seniority/degree text | Anchor |
| `coreResponsibilities` | Task list | Anchor |

A candidate's CV is first rewritten for ATS-style clarity ([`refactor.ts`](../packages/semantic-match/src/refactor.ts)) before sanitization runs against the rewritten text. The sanitized title is also classified into a coarse `role_category` (engineer, designer, product-management, ...) and a seniority level, stored alongside the sanitized output.

## 4. Anchor document + embedding

[`anchor.ts`](../packages/semantic-match/src/anchor.ts) renders the sanitized fields into one plain-text paragraph under shared headers, embedded with `OLLAMA_EMBED_MODEL` (default `nomic-embed-text`), and stored in Chroma (`job_openings`/`candidates` collections, cosine similarity). This embedding produces `semanticSimilarity` in the match response.

## 5. Skill canonicalization

Each extracted skill string is resolved to one canonical `skills` row ([`skill-taxonomy.ts`](../apps/api/src/skill-taxonomy.ts)):

1. Normalize formatting (case, accents, punctuation) — free.
2. Exact lookup against the `skills` table.
3. Vector fallback on a miss — embed + query the `skills` Chroma collection; a hit at ≥ `SKILL_MATCH_MIN_SIMILARITY` (default `0.82`) reuses that skill's id.

If nothing matches, a new canonical skill is minted and embedded. A separate, hand-curated `skill_relations` table covers related-but-not-identical skills (e.g. "Stakeholder Management" crediting "Customer-facing Experience") that the strict 0.82 threshold deliberately doesn't merge.

## 6. Laya evaluation (ingestion-time, shortlist only)

Immediately after a job or CV is embedded and stored in Chroma, its top-10 nearest counterparts are queried, and Laya (a self-hosted BERT classifier) evaluates each pair, returning a `score` (0-1) and a `strong`/`moderate`/`weak` verdict ([`laya.ts`](../packages/semantic-match/src/laya.ts)). A separate local-Ollama call generates match/mismatch reasoning text for the same pair. Results persist in `laya_evaluations`. This only runs on the Chroma-narrowed shortlist per new item, not every possible pair — full-corpus coverage for pre-existing pairs is handled by the `backfill:laya` script.

## 7. Scoring (on request, `GET /api/matches`)

`blendScore` in [`matches.ts`](../apps/api/src/routes/matches.ts):

```
score = skillCoverage * skillOverlapWeight
      + semanticSimilarity * (1 - skillOverlapWeight - layaWeight)
      + layaScore * layaWeight
      × roleMismatchPenalty        (role categories known and incompatible)
      × seniorityMismatchPenalty   (seniority levels known, >1 step apart)
      × noRequiredSkillsPenalty    (job has 0 required skills → similarity-only fallback)
```

`layaWeight` is only spent when a persisted Laya evaluation exists for that pair; otherwise it folds back into the two-term blend so a not-yet-evaluated pair isn't docked for missing data. A `minSkillsForFullConfidence` dampener also scales `skillOverlapWeight` down for jobs with very few required skills, so a lucky 1/1 match doesn't outscore a well-matched 8/10.

Defaults: `skillOverlapWeight=0.6`, `layaWeight=0.3`, `roleMismatchPenalty=0.5`, `seniorityMismatchPenalty=0.7`, `noRequiredSkillsPenalty=0.75`, `minSkillsForFullConfidence=3`. All are runtime-editable via the Configuration screen ([`config-registry.ts`](../apps/api/src/config-registry.ts), [`ConfigTab.tsx`](../apps/web/src/ConfigTab.tsx)).

## 8. UI

[`JobCard.tsx`](../apps/web/src/components/JobCard.tsx) / [`MatchesTab.tsx`](../apps/web/src/MatchesTab.tsx) render the blended score, similarity/coverage badges, and Laya's verdict badge + reasoning/mismatch-reasoning text as visually separate blocks (never merged into one element).

## Backfill scripts

`backfill:skills`, `backfill:cvs`, `backfill:laya` — retroactively cover items/pairs that predate a given feature, same shape each time (re-run sanitization/embedding/evaluation over existing stored data).
