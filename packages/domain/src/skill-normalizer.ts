/**
 * Formatting-only normalization for a raw skill string, e.g. "Front-End",
 * "front end" and "frontend" all collapse to "frontend". This is the cheap
 * first pass before any embedding-based canonicalization - see
 * `createSkillCanonicalizer` in `apps/api/src/skill-taxonomy.ts`, which
 * mirrors the title-scope pattern in `target-filter.ts`/`role-scope.ts`.
 */
export function normalizeSkillLabel(skill: string): string {
  if (!skill) return '';
  return skill
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
