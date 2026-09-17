# ADR 0004: Local Semantic CV↔Opening Matching (Ollama + Chroma)

**Status**: Accepted
**Date**: 2026-09-15
**Author**: Claude Sonnet 5

`Docs/ollama_ingestion_pipeline.md` specifies a local pipeline (Ollama for LLM extraction + embeddings, Chroma for vector storage) to sanitize messy job ads and CVs into structured data, then match candidates to openings by vector similarity. This ADR records how that spec was adapted to ship in this repository, and retires the keyword-based single-CV matcher it replaces.

**Context**:

1. The spec's blueprint is Python (`ollama`, `pydantic`, `chromadb` pip packages). This repository is entirely TypeScript (Hono/Kysely/Vite), with no other Python component.
2. The platform previously had a single-CV keyword matcher (`packages/cv-match`, singleton `cv_profile` table, `/cv` route) that scored jobs by overlapping CV/job terms. It supported exactly one CV at a time and did no semantic matching.
3. The user asked for multi-candidate support (batch and single upload) with a dedicated Matches view showing each candidate's name against their matched openings — a materially different shape than the singleton flow.

**Decision**:

1. **Port the pipeline natively to TypeScript** (`packages/semantic-match`), using the official `ollama` and `chromadb` npm clients, rather than shelling out to or embedding a Python process. One runtime, one dependency graph, consistent with every other package in the monorepo.
2. **Retire the keyword single-CV flow entirely.** `cv_profile`, `packages/cv-match`'s route usage, and the `/cv` route are removed; a new `candidates` table and `/candidates` + `/matches` routes replace them, backing a shared multi-candidate pool used by both the "Upload CV" (single) and "Upload CVs" (batch) tabs. `packages/cv-match` itself is left in place, untouched and unused, rather than deleted — its tests still pass and nothing regresses by keeping it.
3. **Use one shared schema and anchor template for both sides.** A job ad and a CV are both sanitized into the identical `SanitizedProfile` shape (title, required/soft skills, experience profile, core responsibilities) and rendered through the identical header-labelled anchor string before embedding. This is the spec's "symmetrical pipeline" requirement, and it's what actually makes the two vector spaces comparable — a candidate's name is deliberately excluded from the embedded text so it can't skew similarity.
4. **Embed job openings at ingestion time, not lazily.** `runIngestion` gains an injected `embedJob` hook, called once per created/updated (not unchanged) record right after it's stored, so the Matches tab only ever does fast reads. A failed sanitize/embed call is recorded per-job (`job_embeddings.status = 'failed'`) and logged, without failing the ingestion run — one bad LLM response must never take down a whole run.
5. **Track sanitize/embed status in SQLite, keep vectors only in Chroma.** `candidates` and `job_embeddings` store status/error/sanitized-JSON/anchor-text; the embedding arrays themselves live in two Chroma collections (`candidates`, `job_openings`), both configured for cosine similarity, keyed by the same ids as their SQLite rows.

**Considered Options**:

- **Ship the Python blueprint as a separate service**, called over HTTP from `apps/api`. Matches the spec literally, but adds a second language/runtime/deployment unit to a repo that has never had one. Rejected — the npm `ollama`/`chromadb` clients cover the same capability.
- **Keep the old keyword matcher alongside the new semantic one** ("Upload CV" = old singleton flow, "Upload CVs"/"Matches" = new). Considered, but would mean two parallel, differently-shaped CV concepts in the same UI, and the user explicitly wants one pool uploaded from either tab. Rejected.
- **Embed jobs lazily on first Matches-tab load** instead of at ingestion time. Simpler ingestion path, but makes the first Matches load slow and re-couples read-time latency to LLM availability. Rejected in favour of embedding eagerly, at ingestion time, when the failure blast radius is already being handled per-record.

**Consequences**:

- **Pro**: Openings and candidates are compared like-for-like; adding more candidates or letting ingestion run longer never changes the shape of a match, only its ranking.
- **Pro**: Ingestion, upload and match-read paths all stay testable without a live Ollama/Chroma — every external call is behind an injected interface (`SanitizerClient`, `VectorStore`, `EmbedJob`), following the pattern the adapters already use for `fetchJobs`.
- **Con**: Ingestion runs get slower and depend on Ollama being reachable for full coverage; a down Ollama doesn't fail ingestion, but does leave newly ingested jobs unmatched until the next successful embed. There is currently no retry sweep for `job_embeddings.status = 'failed'` rows — a future run only embeds newly created/updated jobs, not previously-failed ones.
- **Con**: `packages/cv-match` is now dead weight (present, tested, unused). Left in place rather than deleted since nothing regresses by keeping it; a future cleanup can remove it once nothing in this ADR's blast radius is in flux.
