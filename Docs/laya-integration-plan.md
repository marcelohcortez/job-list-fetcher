# Laya Integration Plan (LLM-Judge Re-ranking Layer)

Status: **ready to build**. Open questions resolved (see "Decisions" below). Not yet an ADR; promote to one once Phase 1-4 ship and weights are validated against real match quality (see [ADR 0009](adr/0009-skill-taxonomy-and-weighted-matching.md)/[ADR 0012](adr/0012-candidate-role-category-and-mismatch-penalty.md) for the format).

## Decisions

1. **Laya's API shape**: separate server (own HTTP API, not an Ollama-compatible model) — `laya.ts` is a net-new client, not a thin wrapper around `ollama.ts`.
2. **Choice taxonomy**: `strong` | `moderate` | `weak`.
3. **Weight placement**: additive blend, current pipeline (skill-coverage + semantic similarity) stays the dominant base, Laya is a modest additive term — see "Scoring integration" below. Chosen over making Laya the base because skill-coverage's whole value is being the *literal, auditable* signal (ADR 0009), and Laya is an unvalidated self-hosted model on day one — promote its weight later, as a config change, once its verdicts are spot-checked against known cases (e.g. the C#/C++ mistagging bug in "Known limitations").
4. **When it runs**: eagerly, at ingestion time — immediately after a job or CV is sanitized and inserted into Chroma, not lazily on request. The freshly-inserted item's Chroma top-10 is fetched right then, and Laya evaluates against that shortlist immediately (not a separate later backfill sweep for new items — backfill is only for retroactively covering already-stored pairs, see Phase 6).
5. **Deployment**: separate process. Docker if Laya ships a container image; otherwise install and run it locally alongside Ollama, following [ADR 0007](adr/0007-native-ollama-not-containerized.md)'s native-process precedent.
6. **Reasoning text**: every Laya evaluation also carries a short LLM-generated `reasoning` string — why this candidate is (or isn't) a good match, what's lacking. Rendered in the UI as **two separate blocks**: a match-percentage block and a reasoning/motivation-text block, never merged into one element. See "UI" below.

## Goal

Add Laya — a free, self-hosted alternative to Jev — as a third scoring signal on top of the existing pipeline, to sharpen match quality beyond what skill-coverage + whole-document semantic similarity currently produce (see [matching_pipeline.md](matching_pipeline.md), "Known limitations"). Laya evaluates a CV against a job description directly (not just their embeddings) and returns a score + a categorical choice/verdict.

## Where this fits in the existing pipeline

The proposed flow (Fetch → Sanitize → Chroma top-10 → Laya eval → custom math → UI) is **not a new pipeline** — steps 1-6 already exist. Laya slots in as a new **step 7.5**, between the existing Chroma-based candidate retrieval and the final `blendScore`:

| Existing step | File | Status |
| --- | --- | --- |
| 1. Fetch job & CVs | `packages/source-adapters/*`, candidate upload | exists |
| 2. Sanitize text | `packages/semantic-match/src/ollama.ts` (`sanitizeJob`/`sanitizeCandidate`) | exists |
| 3. Chroma vector search, top-K | `packages/semantic-match/src/pipeline.ts` (`matchJobsForCandidate`), `packages/semantic-match/src/chroma.ts` | exists — this **is** the "top 10 raw semantic matches" step already |
| 4. **Laya evaluation** | new: `packages/semantic-match/src/laya.ts` (proposed) | **new** |
| 5. Custom math (final blend) | `apps/api/src/routes/matches.ts` (`blendScore`) | exists — extend, don't replace |
| 6. Render UI | `apps/web/src/JobCard.tsx`, `MatchesTab.tsx` | exists — extend |

Important distinction from your sketch: `blendScore` in `matches.ts:169-250` already combines skill-coverage + semantic-similarity + role/seniority penalties. Laya's score/choice becomes a **third input into that same function**, not a separate final-math stage bolted on after. Keeping one scoring function avoids the current logic and a parallel Laya-math path drifting apart.

## Why Laya only runs on the top-K, not every pair

Laya is an LLM call — like `sanitizeJob`/`sanitizeCandidate`, it is inference-heavy (the doc's own re-processing section notes a few hundred jobs took ~10-15 min against local `qwen2.5:7b`, most of it in inference). Running it over *every* candidate×job pair does not scale. The existing Chroma step already narrows this: `matchJobsForCandidate` returns a bounded top-K (`MATCH_TOP_K` today governs a related but distinct cap — see `matching_pipeline.md` step 7). Laya should only evaluate the shortlist Chroma already narrowed down to, per candidate — exactly matching your sketch's "top 10" framing.

## Trigger: ingestion-time, not request-time (Decision 4)

Laya runs as the last step of ingestion for a single new item, not as a background sweep or lazy per-request call:

- **New job opening fetched** → sanitized → embedded and inserted into Chroma (`job_openings` collection) → **immediately** query Chroma for that job's top-10 nearest candidates → call Laya once per (job, candidate) pair in that shortlist → persist results.
- **New CV fetched/uploaded** → sanitized → embedded and inserted into Chroma (`candidates` collection) → **immediately** query Chroma for that candidate's top-10 nearest jobs → call Laya once per pair → persist results.

This means a newly-ingested item gets Laya coverage against everything already in Chroma at that moment, but items already stored *before* this feature ships (or before a given new item existed) only get evaluated against each other when at least one side is freshly (re-)ingested — hence Phase 6's backfill script to cover the existing corpus retroactively (same shape as `backfill:skills`/`backfill:cvs`).

## Proposed component design

### `packages/semantic-match/src/laya.ts` (new)

Laya is a separate server with its own HTTP API — this is a net-new client, not a wrapper around `ollama.ts`. It follows the same *shape* as the existing `SanitizerClient` interface (`ollama.ts:47-51`) for consistency and testability (fakeable in tests), but talks to a different endpoint/contract:

```ts
type LayaVerdict = "strong" | "moderate" | "weak";

interface LayaEvaluation {
  score: number;         // 0-1
  choice: LayaVerdict;
  reasoning: string;     // short LLM-generated explanation: why this is/isn't a good match, what's lacking
}

interface LayaClient {
  evaluate(input: { jobText: string; cvText: string }): Promise<LayaEvaluation>;
}
```

`reasoning` is free text, generated by Laya itself as part of the same evaluation call (Decision 6) — not a separate LLM round-trip. If Laya's API doesn't natively return an explanation alongside score/choice, the prompt sent to it needs to explicitly ask for one (check this in Phase 0's API-contract confirmation).

Since Laya is self-hosted (Decision 5), its HTTP client should follow the same fetch-timeout override pattern as `createOllamaFetch` (`ollama.ts:24-31`) — a dedicated `undici.Agent` with generous `headersTimeout`/`bodyTimeout`, since Node's default 300s fetch timeout is too short for local LLM inference (same reasoning as the existing Ollama timeout comment, and the same class of fix as commit `b4f606f`). Exact request/response schema depends on Laya's actual API contract — fill in once confirmed (check Laya's docs/OpenAPI spec before implementing `laya.ts`).

### Caching / persistence

Unlike `blendScore` (cheap, computed live per request), a Laya call is expensive enough that it should **not** be recomputed on every `GET /api/matches`. Proposed: a small `laya_evaluations` table keyed by `(candidate_id, job_id)` — `score`, `choice`, `reasoning`, `evaluated_at`, `model_version` — populated once per pair (e.g. during a backfill/ingestion step, or lazily on first request and cached thereafter), analogous to how `job_embeddings`/candidate sanitization results are persisted rather than recomputed per request. Invalidate on re-sanitization of either side (same trigger as the existing `backfill:skills`/`backfill:cvs` scripts).

### Scoring integration (Decision 3: additive, current pipeline stays base)

Extend `blendScore` (`matches.ts:169-250`) with a third weighted term. Skill-coverage stays the dominant signal (per ADR 0009's rationale — it's literal and auditable); Laya is a modest additive nudge, gated `null` when a pair hasn't been evaluated yet (same pattern as `skillCoverage: null` today for jobs with no required skills):

```
score = SKILL_OVERLAP_WEIGHT * skillCoverage
      + SEMANTIC_WEIGHT * semanticSimilarity
      + LAYA_WEIGHT * layaScore
      (all * roleMultiplier, as today)
```

Example: `skillCoverage=0.8, semanticSimilarity=0.6, layaScore=0.7` (moderate) with `SKILL_OVERLAP_WEIGHT=0.5, SEMANTIC_WEIGHT=0.2, LAYA_WEIGHT=0.3` → `score = 0.5*0.8 + 0.2*0.6 + 0.3*0.7 = 0.73`.

When `layaScore` is `null` (pair not yet evaluated — e.g. mid-backfill), fall back to the current two-term blend renormalized (`SKILL_OVERLAP_WEIGHT/(1-LAYA_WEIGHT)`, etc.) so a not-yet-evaluated pair isn't unfairly docked a third of its score for missing data.

**Revisit later**: once Laya's verdicts are spot-checked against known cases (e.g. does it correctly flag the C#/C++ embedded-systems mistagging bug in "Known limitations"?), `LAYA_WEIGHT` can be raised — or Laya can be promoted to replace `semanticSimilarity` in the blend entirely — as a config change, no code change needed.

New env vars, following the existing `.env.example` block convention (`matches.ts:20-83`, `.env.example:33-41`):
- `LAYA_API_URL`, `LAYA_MODEL` (self-hosted endpoint + model id)
- `LAYA_WEIGHT` (default `0.3`, starting point — weights must re-sum to 1 with `SKILL_OVERLAP_WEIGHT` + `SEMANTIC_WEIGHT`)
- `LAYA_MIN_CHOICE` (optional hard floor — e.g. treat a "weak" choice as a penalty regardless of score, similar to how `ROLE_MISMATCH_PENALTY` overrides on category mismatch) — deferred until Decision 3's additive approach is validated; not needed for Phase 4

### UI (Decision 6: two separate blocks)

`apps/web/src/components/JobCard.tsx` already displays `similarity`/`skillCoverage`/`matchedSkills` per job. Add Laya's output as **two distinct blocks**, not merged into the existing score line:

1. **Match-percentage block** — the numeric `layaScore` (or the blended `score` once Phase 4 lands), styled the same way the existing similarity badge is (`JobCard.tsx`'s current similarity % badge) plus the categorical `choice` (`strong`/`moderate`/`weak`) as a small badge next to it.
2. **Reasoning/motivation block** — the `reasoning` text, rendered as its own paragraph/section beneath the score block (not a tooltip, not inline with skill chips) — a short prose explanation of why the candidate is or isn't a good fit and what's missing. This is the one new piece of free text on the card, so per the redesign plan (see [ui-redesign-plan.md](ui-redesign-plan.md)), keep it typographically calm — no icon, no colored background box, just clear body text — so it doesn't add to card clutter.

Both blocks render only when a Laya evaluation exists for that pair (`layaScore`/`layaChoice`/`layaReasoning` all `null` together — pair not yet evaluated, e.g. predates this feature and hasn't been backfilled).

## Deployment (Decision 5)

Separate process from the API/Ollama, following [ADR 0007](adr/0007-native-ollama-not-containerized.md)'s precedent for evaluating native-vs-container per dependency rather than blanket-containerizing:

- If Laya ships a Docker image: run it via `docker run`/compose, exposed on a local port, `LAYA_API_URL` pointing at it. Simplest path if available — isolates its dependencies from the host.
- If not: install and run it natively alongside Ollama (same rationale as ADR 0007 — avoids Docker-on-macOS overhead for local dev). Needs a documented start command (README/`package.json` script) and, if it should come up automatically, the same treatment as however Ollama's local startup is currently handled.
- Either way, `LAYA_API_URL` is just a config value — the rest of the integration (client, scoring, UI) doesn't care which deployment mode is chosen. Confirm which is actually available before Phase 1.

## Phased build tasks

**Phase 0 — confirm Laya's concrete API contract** (request/response schema, auth if any, deployment artifact — Docker image vs. install script). Blocks Phase 1's exact implementation, though the interface shape above should not need to change.

**Phase 1 — Laya client + deployment**
- Stand up Laya per "Deployment" above; confirm `LAYA_API_URL` reachable locally.
- `packages/semantic-match/src/laya.ts`: `LayaClient` interface + real implementation, fetch timeout handling per the `ollama.ts` pattern.
- Fake/stub implementation for tests, following `SanitizerClient`'s existing test-double pattern.
- `LAYA_API_URL`/`LAYA_MODEL` env vars wired in `.env.example` and `apps/api` config.

**Phase 2 — persistence**
- Migration: `laya_evaluations` table (`candidate_id`, `job_id`, `score`, `choice`, `reasoning` (text), `evaluated_at`, `model_version`).
- Repository: `packages/database/src/repositories/laya-evaluations.ts`.

**Phase 3 — ingestion-time pipeline wiring (Decision 4)**
- Job ingestion path: after a job is sanitized and inserted into Chroma, query its top-10 nearest candidates, call Laya once per pair, persist via the Phase 2 repository.
- Candidate ingestion path: same, symmetrically — after a CV is sanitized and inserted into Chroma, query its top-10 nearest jobs, evaluate, persist.
- Both paths need to tolerate a Laya call failing/timing out without failing the whole ingestion — log and leave that pair's evaluation `null` (same graceful-degradation posture as `warnIfSuspiciouslyEmpty` elsewhere in this pipeline), so a Laya outage doesn't block job/CV ingestion.

**Phase 4 — scoring**
- Extend `blendScore` (`matches.ts`) with the additive Laya term per "Scoring integration" above (Decision 3), including the renormalization fallback when `layaScore` is `null`.
- New env vars (`LAYA_WEIGHT` default `0.3`) documented in `.env.example` and `matching_pipeline.md`'s "quick reference" table.

**Phase 5 — UI**
- `JobCard.tsx`: add the two Laya blocks per "UI (Decision 6)" above — match-percentage + verdict badge block, and a separate reasoning-text block.
- `api.ts`/match response type: include `layaScore`/`layaChoice`/`layaReasoning` (nullable, same pattern as `skillCoverage`).
- Coordinate with [ui-redesign-plan.md](ui-redesign-plan.md) so this new content lands in the lighter card layout, not bolted onto the current dense one.

**Phase 6 — backfill & docs**
- `npm run backfill:laya` script (same shape as existing `backfill:skills`/`backfill:cvs`) to populate `laya_evaluations` for pairs that predate this feature (both sides already in Chroma before Laya existed).
- Update `matching_pipeline.md` (new step 7.5) and write the ADR once `LAYA_WEIGHT` is validated against real match quality (spot-check against the known C#/C++ mistagging case and a few genuinely strong/weak matches).

## Non-goals (for this plan)

- Replacing skill-coverage or semantic-similarity scoring — Laya is additive, not a replacement, at least until Phase 4's weighting question is resolved with real data.
- Running Laya over the full job/candidate corpus eagerly on every ingestion — only shortlisted top-K pairs, per the cost reasoning above.
