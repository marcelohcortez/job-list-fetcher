import { z } from 'zod';

/**
 * Field descriptions shared between this zod schema (TS-side docs/parsing)
 * and the plain JSON schema sent to the LLM as its response format
 * (ollama.ts's PROFILE_JSON_SCHEMA) - a single source of truth so the two
 * can't drift apart. The requiredSkills/softSkills split matters a lot for
 * matching (see ADR 0009 and apps/api/src/routes/matches.ts): a job's
 * requiredSkills feed literal skill-coverage scoring, so a soft/behavioral
 * item misclassified as a "required skill" (e.g. "Strong relationship-
 * building skills" for a customer-facing role with no named technical
 * skills at all) can never be matched by any candidate's discrete skill
 * taxonomy and permanently caps that job's score - it should fall back to
 * whole-document similarity instead, which only happens if requiredSkills
 * is correctly left empty/small for such jobs.
 */
/**
 * Appended to title/requiredSkills/softSkills so extraction always lands in
 * English canonical form regardless of source-document language - e.g. a
 * Swedish CV's "REST/API-integrationer"/"systemutveckling" must come out as
 * "REST/API integration"/"Development", the same strings an English job ad
 * would produce for the same thing. Skill-coverage scoring in
 * apps/api/src/routes/matches.ts requires exact canonical skill-id equality
 * (see ADR 0009); the canonicalizer's embedding fallback (skill-taxonomy.ts)
 * isn't reliable enough to bridge cross-language synonyms on its own, so the
 * translation has to happen here, at extraction time, on both sides.
 */
const ENGLISH_NORMALIZATION_NOTE =
  ' Always output this field in English, translating from the source ' +
  "document's language (e.g. Swedish) to the standard English term for the " +
  'same technology/role/quality - never leave it in the original language.';

export const PROFILE_FIELD_DESCRIPTIONS = {
  title:
    "The job title, or the candidate's most recent/target job title." +
    ENGLISH_NORMALIZATION_NOTE,
  requiredSkills:
    'Hard/technical skills ONLY: named tools, programming languages, ' +
    'frameworks, platforms, certifications, or technical methodologies ' +
    '(e.g. "Python", "Kubernetes", "Scrum", "AWS"). Do NOT include ' +
    'personality traits, communication ability, or any behavioral/' +
    'interpersonal quality here even if the source text calls it a ' +
    '"skill" or "requirement" - those belong in softSkills instead. A ' +
    'role with no named technical skills should leave this empty. ' +
    'Each item MUST be a single atomic named technology, 1-3 words, e.g. ' +
    '"Kubernetes", "Docker", "CI/CD", "Git" - NEVER a sentence or ' +
    'prose fragment. If the source text lists several technologies in one ' +
    'clause (e.g. "experience with Kubernetes and Docker", "familiarity ' +
    'with CI/CD workflows and developer tooling", "understanding of ' +
    'testing practices and software quality principles"), split it into ' +
    'one item per named technology and drop the surrounding prose ' +
    '("experience with", "familiarity with", "understanding of", ' +
    '"knowledge of", etc.) entirely. Skip any clause that names no ' +
    'specific technology at all (e.g. "understanding of software ' +
    'development lifecycles") rather than inventing an item for it.' +
    ENGLISH_NORMALIZATION_NOTE,
  softSkills:
    'Soft skills, personality traits, interpersonal/behavioral qualities, ' +
    'mindset, or working style - anything describing how someone works or ' +
    'interacts with others rather than a specific named tool or ' +
    'technology (e.g. "proactive", "strong communicator", "stakeholder ' +
    'management", "relationship-building", "adaptability").' +
    ENGLISH_NORMALIZATION_NOTE,
  experienceProfile: 'Years of experience, seniority, or degree benchmarks.',
  coreResponsibilities:
    'Core tasks/responsibilities. Omit general corporate overhead text.',
  candidateName: "The candidate's full name, read from the CV header.",
} as const;

/**
 * The one structured shape both a job ad and a CV are sanitized into.
 * Using an identical schema (and therefore an identical anchor template) on
 * both sides is what makes the resulting vectors comparable - see anchor.ts.
 */
export const SanitizedProfileSchema = z.object({
  title: z.string().describe(PROFILE_FIELD_DESCRIPTIONS.title),
  requiredSkills: z
    .array(z.string())
    .describe(PROFILE_FIELD_DESCRIPTIONS.requiredSkills),
  softSkills: z
    .array(z.string())
    .describe(PROFILE_FIELD_DESCRIPTIONS.softSkills),
  experienceProfile: z
    .string()
    .describe(PROFILE_FIELD_DESCRIPTIONS.experienceProfile),
  coreResponsibilities: z
    .array(z.string())
    .describe(PROFILE_FIELD_DESCRIPTIONS.coreResponsibilities),
});

export type SanitizedProfile = z.infer<typeof SanitizedProfileSchema>;

export const SanitizedJobSchema = SanitizedProfileSchema;
export type SanitizedJob = SanitizedProfile;

export const SanitizedCandidateSchema = SanitizedProfileSchema.extend({
  candidateName: z.string().describe(PROFILE_FIELD_DESCRIPTIONS.candidateName),
});

export type SanitizedCandidate = z.infer<typeof SanitizedCandidateSchema>;
