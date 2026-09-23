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
  'product-management',
  'delivery-management',
  'business-analysis',
  'sales-customer-success',
  'consulting-advisory',
  'engineering',
] as const;

export type RoleCategory = (typeof ROLE_CATEGORIES)[number];

function normalizeTitle(value: string): string {
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
  ['product-management', '\\b(product manager|product owner|program manager|technical program manager)\\b'],
  ['delivery-management', '\\b(delivery manager|project manager|scrum master|engagement manager|programme manager)\\b'],
  ['business-analysis', '\\b(business analyst|business systems analyst)\\b'],
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
