# Job Discovery Platform — Domain Context

## Single Context

### Description

This platform aggregates and normalizes job openings from multiple sources (JobSources) to provide a single, canonical view of a job's opportunity. It is designed to assist job seekers by providing filtered and deduplicated listings of IT, Business, Data, and Cybersecurity roles.

### Language

**JobSource**: A provider of streaming or periodic job openings (e.g., Cinode, public ATS sites, job search engines). Each source has a unique name and an API connector to retrieve raw job data.
_Includes_: JobTech Dev, Greenhouse, Lever, Cinode Market, Cinode API, TheirStack
_Avoid_: JobSpipe, (unless specified as a source)

**JobOpening**: The canonical, normalized entity representing one specific job opportunity. It aggregates data from one or more JobSources and can be filtered to match a user's declared interests.
_Avoid_: RawJobListing, (raw data returned by source APIs)

**SourceRecord**: A single piece of raw job data ingested from one specific JobSource for a unique JobOpening. This link preserves the original source context and raw data.

**CanonicalKey**: A unique identifier (hash) derived from Title + Company Name + Location, used to detect and group near-identical job postings across different JobSources, facilitating deduplication.
_Avoid_: (simple UUIDs, as they don't indicate content duplication)

**Candidate**: A person's uploaded CV, sanitized locally (via Ollama) into the same structured shape as a JobOpening — title, skills, experience profile, responsibilities — plus the candidate's name. Multiple Candidates can be uploaded independently; each is matched against every JobOpening. A Candidate whose sanitized name matches an already-sanitized Candidate is held as a duplicate (pointing at the existing one) until the user explicitly ignores or replaces it, rather than becoming a second matchable profile for the same person.

**Match**: A Candidate-to-JobOpening pairing scored by blending required-Skill coverage (exact match, or a curated SkillRelation to a Skill the Candidate holds instead) with whole-document embedded-vector cosine similarity (via Chroma). Computed on demand, not stored — a JobOpening's embedding and required Skills are refreshed at ingestion time, so a Match always reflects the current opening. Skill coverage dominates the score (default 60%) precisely because two very different roles can otherwise look deceptively similar on shared domain vocabulary alone (see ADR 0009). A JobOpening with no required Skills at all falls back to pure similarity instead of being scored as zero coverage — see Docs/matching_pipeline.md for the full breakdown and its known limitations.

**Skill**: A canonical, deduplicated skill concept (e.g. "Kubernetes", "Frontend") that a JobOpening requires or a Candidate has. Raw skill strings extracted from either — in any spelling/formatting or language (English/Swedish) — are resolved to the same Skill via formatting normalization first, then vector similarity against the existing Skill vocabulary; an unmatched string mints a new Skill. Grows the same self-correcting way as TargetRolePhrase. A Skill extracted from a JobOpening is either a hard/technical Skill (feeds Match scoring) or a soft/behavioral one (feeds only the whole-document similarity, never discrete coverage) — see ADR 0009.
_Avoid_: treating a raw extracted skill string itself as the matchable unit — two spellings of the same skill must resolve to one Skill before they're compared.

**SkillRelation**: A hand-curated (not computed) equivalence or adjacency between two Skills — e.g. "Stakeholder Management" and "Customer-facing Experience" describe overlapping real-world competencies but were never merged into the same Skill by the stricter formatting/vector-similarity resolution above. Used at match time to give a JobOpening's required Skill partial or full credit from a related Skill the Candidate holds instead of an exact one. Deliberately curated rather than computed — see ADR 0010 for three computed (embedding-similarity-based) approaches that were tried and reverted because they couldn't reliably separate genuinely related Skills from generic-vocabulary noise.
_Avoid_: inferring SkillRelations automatically from embedding similarity — tried three times, reverted every time (ADR 0010).

**TargetRolePhrase**: A title phrase accepted into scope, embedded for the vector fallback used when a JobOpening's title doesn't exactly match the static `TARGET_ROLES` vocabulary. Seeded from `TARGET_ROLES` itself, then grown at ingestion time as new title phrasings are confirmed in scope via similarity — the vocabulary learns without a code change.

**Status**: The lifecycle status of a job posting:
: Active: The job is currently open and accepting applications.
: Expired\_GracePeriod: The application deadline was within the last 7 days (based on EEST/Europe/Stockholm time zone), but the listing is kept for historical review. This status is visualized in a separate section from active roles.
: Closed: The job is permanently closed and rejected as a source record.

### Relationships

- A **JobOpening** is composed of one or more **SourceRecords** from various **JobSources**.
- **SourceRecords** contribute to the stable **CanonicalKey**.
- Failed ingests create **IngestionRuns**, which process one or more **JobSources** to identify new records.

### Example dialogue

> **Dev:** "If the same role is posted today on both Cinode and Greenhouse, do we create two JobOpenings?"
> **Domain expert:** "No. We create one **JobOpening** linked by a **CanonicalKey**, with two distinct **SourceRecords** linking back to the respective source."
>
> **Dev:** "What happens to jobs that close/expire?"
> **Domain expert:** "If the end date falls within the 7-day window, it transitions to **Expired\_GracePeriod**. Otherwise, it's archived/deleted after the next run."

### Flagged ambiguities

- **'Job'**: In this context refers to the canonical job role (`JobOpening`), not the search query itself.
- **Filtering**: This platform limits the scope to IT, Business, Data, and Cybersecurity skills/roles.

## Rules

- **SourceRecord** must carry the necessary fields to calculate the **CanonicalKey** reliably.
- The status **Expired\_GracePeriod** is a hard, business rule: 7 days from the actual close date.
- The primary concern is the **JobOpening**'s canonical representation, deduplication is paramount.
