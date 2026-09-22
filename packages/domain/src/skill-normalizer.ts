/**
 * Formatting-only normalization for a raw skill string, e.g. "Front-End",
 * "front end" and "frontend" all collapse to "frontend". This is the cheap
 * first pass before any embedding-based canonicalization - see
 * `createSkillCanonicalizer` in `apps/api/src/skill-taxonomy.ts`, which
 * mirrors the title-scope pattern in `target-filter.ts`/`role-scope.ts`.
 *
 * `#` and `+` are kept rather than stripped like other punctuation: they're
 * meaningful in short symbol-bearing language names ("C#", "C++", "F#"), and
 * stripping them collapsed distinct languages onto the same normalized
 * string - "C#" and a bare "C" (as extracted from a "C/C++" requirement)
 * both used to normalize to "c", so an exact-match lookup silently merged an
 * embedded/C++ job's requirement into the unrelated "C#" canonical skill.
 * Confirmed against stored data during the 2026-09-22 matching-quality audit
 * (see Docs/matching_pipeline.md): 46 of 65 jobs tagged with the "C#" skill
 * never mention "C#" anywhere in their description.
 */
export function normalizeSkillLabel(skill: string): string {
  if (!skill) return '';
  return skill
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9#+]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
