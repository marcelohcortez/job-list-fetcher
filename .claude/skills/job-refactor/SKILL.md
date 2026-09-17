---
name: job-refactor
version: 1.0
purpose: Strip a messy job-opening advertisement of marketing fluff and company boilerplate, and structure it into the shared SanitizedProfile schema this project uses for job/CV semantic matching.
primary_input: raw job advertisement text (pasted, attached file, or URL content)
outputs:
  - job-refactor-report.json
  - sanitized-job.json
  - sanitized-job.md
---

# Job Refactor Skill

## Mission

Act on a raw job opening advertisement. Remove marketing fluff, company
history, culture/benefits filler ("we believe in synergy", "cold brew on
tap"), and generic corporate text. Extract only the criteria a candidate or
matching pipeline actually needs, into the project's shared
`SanitizedProfile` schema (see [schema.ts](../../../packages/semantic-match/src/schema.ts)) —
the same shape used for both job ads and CVs so their embeddings stay
comparable (see [anchor.ts](../../../packages/semantic-match/src/anchor.ts)).

This skill is the interactive, manual counterpart to the automated
`sanitizeJob` call in [ollama.ts](../../../packages/semantic-match/src/ollama.ts),
which runs the same extraction headlessly via a local Ollama model during
ingestion. Use this skill when a human wants to inspect, correct, or reuse
the sanitized result directly — e.g. auditing a bad extraction, cleaning a
posting before it enters the pipeline, or using the output outside this
project entirely.

## Truth and Safety Rules

- Never invent requirements, skills, seniority, or responsibilities not
  present in the source text.
- Never soften or drop a genuine hard requirement (e.g. a required
  certification, clearance, or language) because it reads as "corporate".
- Never turn a "nice to have" into a required skill, or vice versa — use
  the source's own framing; if ambiguous, keep it in `requiredSkills` and
  note the ambiguity in the report's `notes` field.
- Do not embellish responsibilities with outcomes or scope the ad doesn't
  state.
- If the source text is too sparse, garbled, or non-job content to extract
  reliably, say so explicitly instead of fabricating fields.

## What Counts as Fluff (drop it)

- Company background, history, awards, "voted best place to work" claims.
- Culture/benefits marketing: snacks, gaming tournaments, open kitchens,
  "unlimited PTO" sales pitches, generic wellness perks.
- Buzzword filler with no verifiable content: "synergy", "rockstar",
  "fast-paced", "wear many hats", "changing the digital sphere".
- Generic EEO/legal boilerplate, application instructions, salary
  disclaimers unrelated to the role itself.
- Repeated calls to action ("Apply now!", "Come grow with us!").

## What Must Be Kept

- Job title (formal title as stated, or the closest accurate paraphrase).
- Hard technical skills: languages, frameworks, tools, platforms,
  certifications required for the role.
- Soft skills or working-style requirements, only if explicitly stated
  (e.g. "must work independently", "client-facing").
- Experience/seniority benchmarks: years of experience, degree
  requirements, seniority level.
- Core responsibilities — the actual tasks, not the department's general
  mission statement.

## Workflow

### 1. Read and classify

Read the full source text. For every sentence or bullet, classify it as
`signal` (criteria/responsibility) or `fluff` (marketing/boilerplate).
Note ambiguous cases (e.g. a responsibility phrased as a value statement)
and resolve them conservatively — when genuinely unclear, keep the
information rather than discard it.

### 2. Extract into the shared schema

Populate exactly these fields, matching
[schema.ts](../../../packages/semantic-match/src/schema.ts):

```json
{
  "title": "string",
  "requiredSkills": ["string"],
  "softSkills": ["string"],
  "experienceProfile": "string",
  "coreResponsibilities": ["string"]
}
```

- `title`: the formal job title as advertised.
- `requiredSkills`: hard technical skills, languages, frameworks, tools.
- `softSkills`: soft skills or working-style traits, only if stated.
- `experienceProfile`: years of experience, seniority, or degree
  benchmark, as one concise string.
- `coreResponsibilities`: the actual day-to-day tasks, each as one clear
  item. Omit general corporate-overhead descriptions.

Use empty arrays/strings rather than inventing content when a field has
no support in the source.

### 3. Build the anchor document

Render the same way [anchor.ts](../../../packages/semantic-match/src/anchor.ts)
does, so output is directly comparable to what the automated pipeline
would produce:

```text
JOB TITLE: [title]
TECHNICAL SKILLS: [requiredSkills joined by ", "]
SOFT SKILLS: [softSkills joined by ", "]
EXPERIENCE PROFILE: [experienceProfile]
CORE RESPONSIBILITIES: [coreResponsibilities joined by ". "]
```

### 4. Score the extraction

Score 0–100 on how cleanly the source reduced to signal:

| Dimension | Weight | What it measures |
|---|---:|---|
| Fluff removal | 30 | No marketing/culture/boilerplate leaked into any field. |
| Requirement completeness | 30 | Every stated hard requirement, skill, and responsibility is captured. |
| Fidelity | 25 | Nothing invented, exaggerated, or reclassified (required vs. nice-to-have) incorrectly. |
| Clarity/ATS structure | 15 | Fields read as clean, parseable, standalone criteria. |

```text
score = round(sum(dimension_score × weight) / 100)
```

## Deliverables

### 1. `sanitized-job.json`

The extracted `SanitizedProfile` object exactly as in step 2.

### 2. `sanitized-job.md`

```markdown
# [Job Title]

**Experience:** [experienceProfile]

## Required Skills
- [skill]

## Soft Skills
- [skill]

## Core Responsibilities
- [responsibility]

---
Anchor document:
[the anchor document from step 3]
```

### 3. `job-refactor-report.json`

```json
{
  "schema_version": "1.0",
  "source_quality": "good | partial | poor",
  "extraction_limitations": [],
  "fluff_removed": ["short description of each dropped fluff item"],
  "ambiguous_classifications": ["field + item + why it was ambiguous"],
  "score": 0,
  "notes": []
}
```

## Final Response Template

```markdown
## Extraction

**[job_title]** — [experienceProfile]

| Field | Content |
|---|---|
| Required skills | ... |
| Soft skills | ... |
| Core responsibilities | ... |

## Fluff removed

- [item]

## Score

**[score]/100** — [one-line rationale]

## Deliverables

- Sanitized job: JSON and Markdown
- Extraction report: JSON
```

## Final Instruction

Be ruthless about fluff, conservative about requirements. When in doubt
whether something is a real requirement or marketing language, keep it —
losing a genuine criterion is worse than an over-cautious skill list.
