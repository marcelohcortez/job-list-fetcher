/**
 * Coarse seniority-level classification, independent of `role-categories.ts`
 * (which checks *what kind* of role a title is for, never *what level*).
 * Flagged as a missing signal during the 2026-09-22 matching-quality audit
 * (see Docs/matching_pipeline.md): nothing in the scoring pipeline stopped a
 * junior CV outscoring a senior-only posting, or vice versa, since neither
 * skill coverage nor whole-document similarity nor `role_category` ever look
 * at level. Mirrors `role-categories.ts`'s shape (coarse classifier +
 * compatibility check) so it slots into `blendScore` the same way ADR 0012's
 * role-mismatch penalty did.
 */
export const SENIORITY_LEVELS = ['junior', 'mid', 'senior', 'lead-principal'] as const;

export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

function normalize(value: string): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-–—/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ordered most-specific-first, same reasoning as `CATEGORY_PATTERNS`: "Lead
 * Engineer" must match `lead-principal` before the bare "engineer" pattern
 * elsewhere would even get a chance to (there is no such catch-all here, but
 * "senior" must still come after "lead"/"principal" so e.g. "Senior
 * Principal Engineer" lands on the more specific level).
 */
const TITLE_LEVEL_PATTERNS: readonly (readonly [SeniorityLevel, RegExp])[] = [
  ['lead-principal', /\b(principal|staff|distinguished|chief|head of|\blead\b|tech lead|techlead)\b/],
  ['senior', /\b(senior|\bsr\b)\b/],
  ['junior', /\b(junior|\bjr\b|graduate|trainee|intern|entry level)\b/],
  ['mid', /\b(mid level|mid senior|intermediate|associate)\b/],
];

/**
 * Years-of-experience cue, extracted from free text (typically
 * `experienceProfile`, which - unlike `title` - is not guaranteed to be
 * English-normalized, see `PROFILE_FIELD_DESCRIPTIONS.experienceProfile` in
 * `@job-fetcher/semantic-match`). Digits are locale-invariant, so this
 * matches both "5+ years" and Swedish "minst 3 års erfarenhet".
 */
const YEARS_PATTERN = /(\d{1,2})\+?\s*(?:years?|yrs?|års?|år)\b/g;

function levelFromYears(years: number): SeniorityLevel {
  if (years <= 1) return 'junior';
  if (years <= 4) return 'mid';
  if (years <= 8) return 'senior';
  return 'lead-principal';
}

/**
 * Best-effort classification of a job or candidate into a coarse seniority
 * level. Checks the title first (keyword cues, e.g. "Senior", "Lead",
 * "Principal", "Junior"), then falls back to the highest years-of-experience
 * figure mentioned in `experienceProfile`. Returns `null` when neither
 * yields a signal - callers should treat that as "unknown", not as a
 * mismatch against anything, exactly like `categorizeRoleTitle`.
 */
export function categorizeSeniority(
  title: string,
  experienceProfile: string,
): SeniorityLevel | null {
  const normalizedTitle = normalize(title);
  for (const [level, pattern] of TITLE_LEVEL_PATTERNS) {
    if (pattern.test(normalizedTitle)) return level;
  }

  const years = [...(experienceProfile ?? '').matchAll(YEARS_PATTERN)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  if (years.length > 0) return levelFromYears(Math.max(...years));

  const normalizedExperience = normalize(experienceProfile ?? '');
  for (const [level, pattern] of TITLE_LEVEL_PATTERNS) {
    if (pattern.test(normalizedExperience)) return level;
  }

  return null;
}

const LEVEL_ORDER: Readonly<Record<SeniorityLevel, number>> = {
  junior: 0,
  mid: 1,
  senior: 2,
  'lead-principal': 3,
};

/**
 * Whether two seniority levels are close enough that a match between them
 * shouldn't be penalized. Ordinal, not a hand-curated graph like
 * `ADJACENT_CATEGORIES` - one step of tolerance in either direction (junior
 * candidate for a mid role, senior candidate for a lead-track role) is a
 * normal, viable match; a two-step gap (junior against a lead-principal
 * posting) is the skip-level mismatch this exists to catch. Unknown levels
 * (`null`) are always compatible, same policy as `areRoleCategoriesCompatible`
 * - a coarse classifier missing a signal isn't evidence of a mismatch.
 */
export function areSeniorityLevelsCompatible(
  a: SeniorityLevel | null,
  b: SeniorityLevel | null,
): boolean {
  if (a === null || b === null) return true;
  return Math.abs(LEVEL_ORDER[a] - LEVEL_ORDER[b]) <= 1;
}
