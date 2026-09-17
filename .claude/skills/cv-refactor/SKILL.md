---
name: cv-refactor
version: 2.0
purpose: Evaluate a CV supplied as a PDF, refactor it into ATS-ready CV and LinkedIn-profile content, and export auditable JSON, Markdown, and PDF deliverables without inventing facts.
primary_input: attached CV PDF
outputs:
  - cv-refactor-report.json
  - refactored-cv.md
  - refactored-cv.pdf
  - linkedin-profile-content.md
  - linkedin-profile-content.pdf
  - linkedin-profile-content.json
---

# CV Refactor Skill

## Mission

Act on an attached PDF CV. First extract and validate its content, then assess how close it is to an evidence-based, ATS-readable, recruiter-friendly ideal. Explain the diagnosis and planned edits before rewriting. Next, create:

1. A refactored CV.
2. LinkedIn-ready content containing a rewritten About/intro section and rewritten work-experience entries.
3. Machine-readable JSON records for the analysis and both deliverables.
4. Markdown and PDF versions of the CV and LinkedIn content.

The skill must be truthful, explicit about uncertainty, and usable for any candidate, market, or profession.

## Required Inputs

### Required

- One attached PDF containing the candidate's CV.

### Optional but strongly recommended

- Target job description, job title, employer, or target industry.
- Country/market and preferred language.
- Candidate's preferred CV length or maximum page count.
- Recruiter, peer, or automated feedback received on the CV.
- Portfolio, GitHub, LinkedIn, personal website, work samples, or project notes.
- Facts the candidate wants preserved exactly.
- Missing facts that can strengthen claims: scope, metrics, outcomes, tools, dates, project context, promotions, certifications, or language proficiency.

If the target role is absent, optimize for a general-purpose CV in the candidate's demonstrated role family. State clearly that role-specific tailoring is limited.

## Truth and Safety Rules

- Never invent or infer employers, job titles, employment dates, qualifications, certifications, technologies, client names, security clearances, salary, metrics, languages, awards, responsibilities, outcomes, or seniority.
- Never transform limited exposure to a tool into proficiency, ownership, production experience, or expertise.
- Do not use a job-description keyword unless the candidate's source material supports it.
- Do not conceal employment dates, alter chronology, or rewrite a gap as employment.
- Use `[VERIFY: specific missing fact]` in Markdown and the `verification_needed` field in JSON whenever a needed claim cannot be established.
- Use only facts available in the PDF and user-provided supplementary material. Treat public profile links as references, not evidence, unless their contents are supplied or tool access is explicitly available.
- Never include sensitive personal data by default beyond name, professional contact information, city/region, and relevant professional links. Exclude date of birth, marital status, photo, full street address, nationality, and references unless the candidate specifically asks and local norms require it.
- Do not add “References available upon request.”
- Never make the quality score look more precise than the evidence permits. It is a structured editorial heuristic, not a prediction of interview success.

## PDF Intake Procedure

### 1. Confirm the attachment is usable

1. Identify the attached PDF and attempt to extract its text.
2. Determine whether it is text-based, image-only, partially scanned, encrypted, malformed, or missing readable pages.
3. If extraction is incomplete, use OCR when available.
4. If important text is still unreadable, state exactly what could not be reliably read and request either a selectable-text PDF, the original document, or pasted content.
5. Do not refactor unverified OCR guesses for names, dates, job titles, contact details, metrics, URLs, or certifications.

### 2. Preserve a source record

Create a source inventory before making editorial changes:

- Candidate name and available contact details.
- Headline, summary, objective, and professional branding.
- Employers, positions, locations, dates, and chronology.
- Responsibilities, technologies, domains, stakeholders, scope, and achievements.
- Education, certifications, languages, projects, volunteering, and links.
- Layout/readability risks observed in the PDF: columns, tables, text boxes, images, low contrast, tiny font, headers/footers, graphics, inconsistent dates, broken links, or unextractable text.

Classify every prospective statement as one of:

- `verified`: explicitly stated in the CV PDF or user-supplied material.
- `safe_rephrase`: a narrower or clearer expression of a verified statement that does not add scope or meaning.
- `unknown`: a potentially useful fact that has not been evidenced and must be omitted or marked `[VERIFY]`.

## Ideal CV Standard

Use this standard as the benchmark. Adapt the weighting only if a target role or local market makes a different emphasis necessary.

| Dimension | Weight | What “ideal” means |
|---|---:|---|
| Truthfulness and chronology | 20 | Titles, employers, dates, scope, and claims are consistent, credible, and traceable to source evidence. |
| Target-role positioning | 15 | The target role, relevant domain, and differentiating strengths are visible immediately. |
| Evidence and impact | 15 | Recent relevant roles show concrete contribution, outcomes, scale, constraints, or responsibility without fabricated metrics. |
| Relevance and prioritization | 10 | The most relevant evidence appears early; old or weak details are condensed. |
| Skills credibility | 10 | Skills are grouped, relevant, evidence-backed, and demonstrated in experience. |
| Readability and recruiter scanability | 10 | Clear hierarchy, concise bullets, consistent tense and dates, plain language, and low repetition. |
| ATS and technical parseability | 10 | Conventional headings, simple one-column reading order, standard dates, no essential graphics/tables/text boxes, and accessible text. |
| Completeness and professional hygiene | 10 | Contact/link quality, education/certifications where relevant, no obvious omissions, and appropriate privacy. |

The result is a score out of 100. It measures closeness to this editorial standard, not the candidate's talent, employability, or likelihood of receiving an offer.

## Pre-Refactor Assessment

Complete this assessment before editing any wording.

### 1. Calculate the baseline score

Score every dimension from 0 to 100 using only the extracted evidence. Then calculate:

```text
baseline_score = round(sum(dimension_score × dimension_weight) / 100)
```

Use the exact wording below, replacing the values:

> Your CV is currently **[baseline_score]% close to the editorial ideal used by this skill**. This is a document-quality assessment, not a judgment of your experience or hiring prospects. I will improve the parts supported by your source material and flag facts that require your confirmation rather than inventing them.

### 2. Explain the score

Provide:

- A scorecard table with every dimension, score, weight, and concise evidence-based rationale.
- The 3–7 highest-value improvements, ordered by likely impact.
- A list of missing information that prevents stronger or more specific claims.
- A layout/ATS warning if the input PDF has parseability issues.
- The planned changes to the CV and LinkedIn content.
- A disclosure stating whether the output will be general-purpose or tailored to a supplied target role.

### 3. Present a refactoring plan before edits

Do not silently rewrite first. Present this plan in the response before the deliverables:

```text
Planned changes
1. [Specific structure, clarity, relevance, or ATS change]
2. [Specific summary/headline change]
3. [Specific experience-bullet change]
4. [Specific skills, projects, education, link, or formatting change]
5. [Any LinkedIn-specific adaptation]

Facts needed to complete or strengthen the result
- [VERIFY: exact missing fact]
```

If the operating environment allows an interactive approval step, pause after the assessment and plan and ask the user to approve the rewrite or provide missing facts. If the user explicitly asked for immediate processing or the environment is non-interactive, proceed in the same run while preserving all `[VERIFY]` markers and documenting assumptions.

## Refactoring Workflow

### 1. Establish positioning

Create one supported positioning statement before drafting. It must answer: what role does this person fit, what do they specialize in, and in what delivery or domain context?

Use only verified facts. Do not state years of experience unless dates fully support the calculation and concurrent/part-time roles do not make it misleading.

Example structure only:

> [Target role] specializing in [2–3 verified strengths], with experience delivering [verified product, business, or technical context].

### 2. Build the CV structure

Use this default order unless another order better represents the supplied evidence:

1. Name and professional contact details.
2. Targeted professional summary.
3. Core skills.
4. Professional experience in reverse chronological order.
5. Selected projects or portfolio highlights, if they provide relevant evidence beyond employment history.
6. Education and certifications.
7. Languages, if relevant to the target market or role.

Use standard section names such as `Summary`, `Skills`, `Experience`, `Projects`, `Education`, `Certifications`, and `Languages`.

### 3. Rewrite the CV summary

Write 3–5 concise lines. Include:

- Target role or credible role family.
- Two or three supported specialisms.
- Relevant domain, delivery, or stakeholder context.
- One verified scope or outcome when available.

Avoid first-person pronouns, generic objectives, long keyword lists, self-praise, and unsupported claims.

### 4. Rewrite experience

For each role:

- Preserve employer, title, location, and dates as sourced.
- Add a one-line context statement only when it makes the role more understandable.
- Use 3–6 focused bullets for recent or relevant roles; use fewer for older or less relevant roles.
- Start bullets with a precise verb.
- Make the candidate's contribution, method, scope, and outcome clear when evidence permits.

Use these evidence-safe patterns:

- `Action + scope + verified outcome`.
- `Action + technical or operational approach + purpose`.
- `Ownership + collaboration + delivered work`.
- `Improvement + method + verified impact`.

When metrics are unavailable, do not manufacture numbers. Use only supported scope: systems, integrations, releases, stakeholder groups, environments, domains, constraints, or types of delivery.

### 5. Build the skills section

Group skills by practical use, not a random tool dump. Use relevant categories such as:

- Languages and frameworks.
- Frontend, backend, and platform engineering.
- Cloud, infrastructure, and delivery.
- CMS, integrations, data, security, accessibility, testing, or analytics.
- Methods and collaboration.

Include a skill only if the PDF or supplied material supports it. Prioritize skills relevant to the target context. Do not use ratings, stars, bars, or unverified proficiency labels.

### 6. Apply supplied feedback

Process feedback item by item:

- Apply factual corrections exactly.
- Implement clarity, relevance, brevity, positioning, and formatting improvements when evidence permits.
- Reframe feedback that would overstate the candidate.
- Reject feedback that conflicts with factual accuracy, ATS compatibility, or local norms.

Maintain a feedback log in the report JSON and Markdown output with `applied`, `partially_applied`, and `not_applied` sections.

## LinkedIn Content Workflow

Generate LinkedIn-specific content from the same verified evidence. The LinkedIn content is not a copy-paste of the CV.

### LinkedIn About / Intro

Create two variants:

1. **Recruiter-first About**: 1,000–1,500 characters maximum unless the user specifies otherwise; clear role identity, specialisms, credibility, domain context, and a natural invitation to connect.
2. **Concise intro**: 300–500 characters for the headline/about preview, profile summary, bio, or networking use.

Use a direct professional voice. First person is allowed and generally preferred for LinkedIn. Avoid empty claims and keyword stuffing.

### LinkedIn experience entries

For each relevant role, include:

- Title, company, location, and dates exactly as verified.
- A 1–2 sentence role overview in LinkedIn tone.
- 3–5 outcome- or scope-focused bullets.
- A `Skills demonstrated` line containing only supported relevant skills.

Keep experience consistent with the CV while allowing more narrative context. Do not add duties, metrics, or claims that are absent from the refactored CV evidence base.

### Optional LinkedIn recommendations

When supported by the target role and source material, provide:

- A proposed headline of up to 220 characters.
- Up to five profile skills to feature.
- Up to three featured-item recommendations, but only use links or project names supplied by the user.

If support is insufficient, use `[VERIFY]` rather than inventing a featured project or link.

## Deliverables

Generate six files. The exact file names may use the candidate's name safely, but follow these formats.

### 1. `cv-refactor-report.json`

This is the audit trail and must include:

```json
{
  "schema_version": "2.0",
  "candidate": {
    "name": "Verified name or null",
    "source_file": "original-file-name.pdf",
    "language": "output language",
    "market": "country/market or null"
  },
  "target_context": {
    "target_role": "string or null",
    "job_description_provided": false,
    "tailoring_mode": "general | targeted"
  },
  "source_quality": {
    "pdf_readability": "good | partial | poor",
    "ocr_used": false,
    "extraction_limitations": []
  },
  "baseline_assessment": {
    "score": 0,
    "standard": "Evidence-based, ATS-readable, recruiter-friendly CV",
    "dimensions": [
      {
        "name": "Truthfulness and chronology",
        "weight": 20,
        "score": 0,
        "rationale": "Evidence-based explanation"
      }
    ],
    "priority_changes": [],
    "missing_information": [],
    "planned_changes": []
  },
  "fact_inventory": {
    "verified": [],
    "safe_rephrases": [],
    "unknown_or_verification_needed": []
  },
  "feedback_log": {
    "applied": [],
    "partially_applied": [],
    "not_applied": []
  },
  "final_assessment": {
    "score": 0,
    "delta": 0,
    "improvements_completed": [],
    "remaining_gaps": [],
    "verification_needed": []
  },
  "output_files": {
    "cv_markdown": "refactored-cv.md",
    "cv_pdf": "refactored-cv.pdf",
    "linkedin_markdown": "linkedin-profile-content.md",
    "linkedin_pdf": "linkedin-profile-content.pdf",
    "linkedin_json": "linkedin-profile-content.json"
  }
}
```

Use arrays of structured objects instead of plain strings when more context is necessary. Do not include raw sensitive personal data beyond what is necessary for the document.

### 2. `refactored-cv.md`

Provide a clean, ready-to-edit Markdown CV. Use headings and conventional bullets only. Do not use tables for the CV content. Keep `[VERIFY: ...]` markers visible.

Include this non-CV footer after a horizontal rule:

```text
Document notes (remove before applying)
- Tailoring mode: [general or target role]
- Verification needed: [count]
- Source limitations: [if any]
```

### 3. `refactored-cv.pdf`

Render a professional, readable PDF from the Markdown CV with these standards:

- A single-column, ATS-friendly layout.
- Selectable text, not an image-only export.
- Standard embedded or widely supported fonts; use a tested Unicode-capable font when characters require it.
- No icons, skill bars, infographics, decorative charts, text boxes, columns, or tables containing essential content.
- Clear hierarchy, consistent typography, reasonable margins, and no clipped text.
- Keep the principal CV to the agreed page limit; if none is given, aim for one to two pages where content allows.
- Do not include internal document notes in the candidate-facing PDF unless the user specifically requests an annotated version.

Before delivery, validate that the PDF exists, is non-empty, and contains selectable text. If validation fails, report the failure instead of claiming a successful PDF export.

### 4. `linkedin-profile-content.md`

Use this structure:

```markdown
# LinkedIn Profile Content

## Recommended Headline

[Headline, if supported]

## About — Recruiter-First Version

[First-person About section]

## About — Concise Version

[Short first-person introduction]

## Experience

### [Verified Job Title] — [Verified Employer]
[Verified location, if present] | [Verified dates]

[Role overview]

- [Evidence-based bullet]
- [Evidence-based bullet]
- [Evidence-based bullet]

Skills demonstrated: [supported skills]

## Suggested Featured Items

- [Only supplied links/projects, or VERIFY marker]

## Profile Skills to Feature

- [Supported skill]
```

### 5. `linkedin-profile-content.pdf`

Render the LinkedIn content to a readable PDF. It should be designed as a copy-and-paste reference document, not as a simulated LinkedIn page. Use selectable text, Unicode-safe fonts, clean headings, and no layout elements that compromise readability.

### 6. `linkedin-profile-content.json`

Export LinkedIn content in this structure:

```json
{
  "schema_version": "2.0",
  "candidate_name": "Verified name or null",
  "recommended_headline": "string or null",
  "about": {
    "recruiter_first": "string",
    "concise": "string"
  },
  "experience": [
    {
      "title": "verified title",
      "company": "verified company",
      "location": "verified location or null",
      "start_date": "as verified",
      "end_date": "as verified or Present",
      "overview": "string",
      "bullets": ["string"],
      "skills_demonstrated": ["string"],
      "verification_needed": ["string"]
    }
  ],
  "featured_items": [],
  "profile_skills_to_feature": [],
  "verification_needed": []
}
```

## Post-Refactor Assessment

After producing the deliverables, score the refactored CV using the same weighted rubric.

Calculate:

```text
final_score = round(sum(final_dimension_score × dimension_weight) / 100)
delta = final_score - baseline_score
```

Use this exact result format in the final response:

> The refactored CV is now **[final_score]% close to the same editorial ideal**, up from **[baseline_score]%**. The increase reflects improvements to structure, clarity, evidence presentation, relevance, and ATS readiness; it does not claim new experience or guarantee a hiring outcome.

Then report:

- Completed improvements.
- Remaining gaps caused by missing or unverified information.
- Every visible `[VERIFY]` marker and exactly what the candidate needs to provide to resolve it.
- Any limitations caused by unreadable PDF content, absent target-role context, or page-length constraints.

Do not award 100% if meaningful information is missing, facts remain unverified, the CV has no target context when targeting was requested, or the source constraints prevent compliance with the ideal standard.

## Final Response Template

Use this response after file generation:

```markdown
## Assessment

Your CV is currently **[baseline_score]% close to the editorial ideal used by this skill**. This assesses the document, not your professional value or likelihood of being hired.

| Dimension | Before | After | Rationale |
|---|---:|---:|---|
| ... | ... | ... | ... |

## Planned and completed changes

- [Change]
- [Change]
- [Change]

## Result

The refactored CV is now **[final_score]% close to the same editorial ideal**, up from **[baseline_score]%**. The increase reflects document improvements supported by the supplied information, not invented experience or guaranteed hiring outcomes.

## Still needed

- `[VERIFY: exact information needed]`
- [Any input limitation]

## Deliverables

- Refactored CV: Markdown, PDF, and audit JSON.
- LinkedIn profile content: Markdown, PDF, and JSON.
```

## Final Instruction

Be skeptical of weak claims, protect the candidate from exaggeration, and make every improvement traceable. A CV that is clear, relevant, and verifiable is more useful than one that sounds impressive but cannot be defended.
