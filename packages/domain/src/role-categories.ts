/**
 * Coarse role families used to sanity-check a match independently of skill
 * overlap and whole-document embedding similarity. See ADR 0012: a Designer
 * CV could score 75% against a "Product Manager" opening because nothing in
 * the scoring pipeline ever compared *what kind of role* the CV and the job
 * are for - `TARGET_ROLES` gates which job titles are ingested, but it has
 * no analogue on the candidate side, and skill coverage / semantic
 * similarity can both look deceptively high across unrelated role families
 * that share generic vocabulary (see ADR 0009).
 */
export const ROLE_CATEGORIES = [
  'design',
  'leadership',
  'devops-cloud',
  'data-ai',
  'embedded-systems',
  'mobile-native',
  'product-management',
  'delivery-management',
  'business-analysis',
  'sales-customer-success',
  'consulting-advisory',
  'engineering',
] as const;

export type RoleCategory = (typeof ROLE_CATEGORIES)[number];

/**
 * A fused Swedish compound noun ending in one of these role-suffix
 * morphemes (e.g. "Embeddedutvecklare", "Systemarkitekt") has no internal
 * `\b` word boundary for a regex to latch onto - unlike a hyphenated title
 * ("Android-utvecklare"), which `normalizeTitle`'s dash-to-space step
 * already turns into two separate words. Splitting on these suffixes (an
 * optional linking "s" first, per Swedish compounding rules, e.g.
 * "säkerhets-ingenjör") recovers that boundary so the patterns below - which
 * only know English vocabulary - have a real prefix word to test.
 */
const SWEDISH_SUFFIX_SPLIT = /([a-z]+?)s?(utvecklare|ingenjor|arkitekt|konsult|analytiker|specialist)\b/g;

/**
 * Common Swedish tech-title roots/suffixes translated to their English
 * equivalent, applied after `SWEDISH_SUFFIX_SPLIT` has isolated them as
 * their own word (or, for compound roots like "sakerhet", as a substring
 * within the split-off prefix). Ordered longest-prefix-first so e.g.
 * "sakerhets" is consumed before the shorter "sakerhet" would leave a stray
 * "s" behind. Deliberately narrow to roots actually seen in the job source
 * boards' Swedish titles (see DEFAULT_TARGET_ROLES's Swedish section) -
 * not an attempt at general Swedish->English translation.
 */
const SWEDISH_WORD_TRANSLATIONS: readonly (readonly [RegExp, string])[] = [
  [/sakerhets/g, 'security'],
  [/sakerhet/g, 'security'],
  [/mjukvarus/g, 'software'],
  [/mjukvaru/g, 'software'],
  [/mjukvara/g, 'software'],
  [/molns/g, 'cloud'],
  [/moln/g, 'cloud'],
  [/losnings/g, 'solution'],
  [/losning/g, 'solution'],
  [/produktagare/g, 'product owner'],
  [/projektledare/g, 'project manager'],
  [/\butvecklare\b/g, 'developer'],
  [/\bingenjor\b/g, 'engineer'],
  [/\barkitekt\b/g, 'architect'],
  [/\bkonsult\b/g, 'consultant'],
  [/\banalytiker\b/g, 'analyst'],
];

function normalizeTitle(value: string): string {
  if (!value) return '';
  let normalized = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-–—/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  normalized = normalized.replace(SWEDISH_SUFFIX_SPLIT, (_match, prefix, suffix) =>
    prefix ? `${prefix} ${suffix}` : suffix,
  );
  for (const [pattern, replacement] of SWEDISH_WORD_TRANSLATIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

/**
 * Ordered most-specific-first: a title is tested against each category's
 * pattern in turn and the first match wins, so a broad catch-all (e.g.
 * `engineering`'s bare "engineer"/"developer") has to come last or it would
 * swallow titles that belong to a more specific category (e.g. "DevOps
 * Engineer", "Data Engineer", "Engineering Manager"). This is the built-in
 * default - the live, editable order/patterns are `getCategoryPatternSources()`
 * below, which the Configuration screen can override (reordering included).
 */
export const DEFAULT_CATEGORY_PATTERN_SOURCES: readonly (readonly [RoleCategory, string])[] = [
  ['design', '\\b(designer|ux|ui|user experience|user interface|graphic design|visual design)\\b'],
  [
    'leadership',
    '\\b(head of|director|\\bvp\\b|chief\\b|engineering manager|development manager|software development manager)\\b',
  ],
  [
    'devops-cloud',
    '\\b(devops|platform engineer|site reliability|\\bsre\\b|cloud (solutions? )?architect|cloud engineer|mlops)\\b',
  ],
  [
    'data-ai',
    '\\b(data engineer|data platform|analytics engineer|machine learning|ml engineer|ai engineer|applied ai|data scientist)\\b',
  ],
  [
    'embedded-systems',
    '\\b(embedded|firmware|firmware engineer|hardware engineer|electronics engineer|driver developer|device driver|rtos|bare[- ]?metal|fpga|microcontroller|\\bplc\\b)\\b',
  ],
  [
    // Deliberately narrow to "android"/"ios" only, not "mobile" or a bare
    // "swift"/"kotlin" - those name platform SDKs no cross-platform or
    // backend stack shares (Android SDK/Kotlin-for-Android vs Java/Kotlin
    // backend, or Swift/UIKit vs a JS-based React Native app), so an
    // "Android Developer"/"iOS Engineer" title is unambiguously native-
    // mobile. "Mobile Developer"/"Senior Software Engineer, Mobile" and a
    // bare "Kotlin" title (e.g. "Senior Developer (Java/Kotlin)", a JVM
    // backend role in the wild - see the 2026-09-26 audit) are genuinely
    // ambiguous about native vs. cross-platform/backend and are left in
    // `engineering`, where skill coverage (Swift/Kotlin/Android SDK vs.
    // React Native/JS) still does the discriminating without risking a
    // false isolation penalty against a legitimately cross-platform CV.
    'mobile-native',
    '\\b(android|ios)\\b',
  ],
  [
    'product-management',
    '\\b(product manager|product owner|program manager|technical program manager|product operations)\\b',
  ],
  ['delivery-management', '\\b(delivery manager|project manager|scrum master|engagement manager|programme manager)\\b'],
  [
    'business-analysis',
    '\\b(business analyst|business systems analyst|solution analyst|systems analyst|ai analyst)\\b',
  ],
  [
    'sales-customer-success',
    '\\b(sales engineer|customer success|technical account manager|customer enablement|solutions engineer)\\b',
  ],
  ['consulting-advisory', '\\b(consultant|advisor|advisory)\\b'],
  ['engineering', '\\b(engineer|developer|architect|full ?stack|frontend|front end|backend|software)\\b'],
];

function compileCategoryPatterns(
  sources: readonly (readonly [RoleCategory, string])[],
): (readonly [RoleCategory, RegExp])[] {
  return sources.map(([category, source]) => [category, new RegExp(source)] as const);
}

let categoryPatterns = compileCategoryPatterns(DEFAULT_CATEGORY_PATTERN_SOURCES);

export function getCategoryPatternSources(): readonly (readonly [RoleCategory, string])[] {
  return categoryPatterns.map(([category, pattern]) => [category, pattern.source] as const);
}

/**
 * Overrides the category classification order/patterns. `sources` must cover
 * every `ROLE_CATEGORIES` entry exactly once - order is precedence
 * (most-specific-first, same rule as the built-in default).
 */
export function setCategoryPatterns(
  sources: readonly (readonly [RoleCategory, string])[],
): void {
  categoryPatterns = compileCategoryPatterns(sources);
}

/**
 * Best-effort classification of a job or candidate title into a coarse role
 * family. Returns `null` when nothing matches, which callers should treat as
 * "unknown" - not as a mismatch against anything.
 */
export function categorizeRoleTitle(title: string): RoleCategory | null {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;
  for (const [category, pattern] of categoryPatterns) {
    if (pattern.test(normalized)) return category;
  }
  return null;
}

/**
 * Role families whose real-world responsibilities overlap enough that a
 * mismatch between them shouldn't be penalized - e.g. an Engineering
 * Manager candidate is a reasonable match for a Delivery Manager opening.
 * Deliberately does not include `design`: none of `TARGET_ROLES` is a design
 * role, so a design-categorized CV is never a good match for anything this
 * platform ingests, and that's the exact failure mode this taxonomy exists
 * to catch.
 */
const ADJACENT_CATEGORIES: Readonly<Record<RoleCategory, ReadonlySet<RoleCategory>>> = {
  engineering: new Set(['engineering', 'devops-cloud', 'data-ai', 'leadership', 'consulting-advisory']),
  'devops-cloud': new Set(['devops-cloud', 'engineering', 'data-ai', 'leadership', 'consulting-advisory']),
  'data-ai': new Set(['data-ai', 'engineering', 'devops-cloud', 'consulting-advisory']),
  'product-management': new Set([
    'product-management',
    'delivery-management',
    'business-analysis',
    'leadership',
    'consulting-advisory',
  ]),
  'delivery-management': new Set([
    'delivery-management',
    'product-management',
    'business-analysis',
    'leadership',
    'consulting-advisory',
  ]),
  'business-analysis': new Set(['business-analysis', 'product-management', 'delivery-management', 'consulting-advisory']),
  'consulting-advisory': new Set([
    'consulting-advisory',
    'engineering',
    'devops-cloud',
    'data-ai',
    'product-management',
    'delivery-management',
    'business-analysis',
    'leadership',
    'sales-customer-success',
  ]),
  leadership: new Set([
    'leadership',
    'engineering',
    'devops-cloud',
    'product-management',
    'delivery-management',
    'consulting-advisory',
  ]),
  design: new Set(['design']),
  // Deliberately isolated, same rationale as `design` above: a plain
  // engineering/frontend/backend CV with no embedded/firmware/hardware
  // skills is not a reasonable match for an embedded-systems opening (and
  // vice versa) just because both titles contain "developer"/"engineer" -
  // see the 2026-09-26 matching-quality report (a 78%/43% Laya/skill-vector
  // match on a frontend-only CV against an "Embedded Developer - C/C++"
  // posting, with zero embedded/C/C++ skills on the CV either side).
  'embedded-systems': new Set(['embedded-systems']),
  // Same isolation rationale as `embedded-systems`: none of the current CVs
  // list Swift/Kotlin/Android SDK/Xcode, and none of `TARGET_ROLES` is a
  // native-mobile role - so a confident native-mobile title match against a
  // web/backend-only CV should be penalized, not treated as compatible.
  'mobile-native': new Set(['mobile-native']),
  'sales-customer-success': new Set(['sales-customer-success', 'consulting-advisory', 'delivery-management']),
};

/**
 * Whether two role categories are compatible enough that a match between
 * them shouldn't be penalized. Unknown categories (`null`, e.g. the
 * classifier didn't recognize the title) are always treated as compatible -
 * there's nothing to reliably penalize against, and the failure mode this
 * exists to catch (ADR 0012) is a confident mismatch, not a missing signal.
 */
export function areRoleCategoriesCompatible(
  a: RoleCategory | null,
  b: RoleCategory | null,
): boolean {
  if (a === null || b === null) return true;
  if (a === b) return true;
  return ADJACENT_CATEGORIES[a].has(b);
}
