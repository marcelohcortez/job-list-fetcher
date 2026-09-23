import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { normalizeSkillLabel } from '@job-fetcher/domain';
import {
  findSkillByNormalizedLabel,
  insertSkillIfNew,
  skillExists,
  type JobDb,
} from '@job-fetcher/database';
import type { VectorStore } from '@job-fetcher/semantic-match';
import { getOsSkillExclusions, resolveSkillId as resolveCanonicalSkillId } from './skill-relations-seed';

export type Embed = (text: string) => Promise<number[]>;

// `normalizeSkillLabel` turns "/" into a space, so "CI/CD Workflows",
// "CI/CD pipelines", "GitLab CI/CD" etc. all contain the token pair "ci cd"
// somewhere in the normalized string. Rather than curating every phrasing a
// job ad happens to use as its own skill-relations-seed row (which is what
// kept missing new variants like "CI/CD Workflows"), any label containing
// that token pair is folded straight onto the canonical "CI/CD" skill. This
// is the built-in default - the live pattern is `getCiCdTokenPattern()`
// below, which the Configuration screen can override.
export const DEFAULT_CI_CD_TOKEN_PATTERN = '(?:^|\\s)ci cd(?:\\s|$)';
let ciCdTokenPattern = new RegExp(DEFAULT_CI_CD_TOKEN_PATTERN);

export function getCiCdTokenPattern(): string {
  return ciCdTokenPattern.source;
}

/** Overrides the CI/CD token-detection regex. Throws if `source` isn't a valid pattern. */
export function setCiCdTokenPattern(source: string): void {
  ciCdTokenPattern = new RegExp(source);
}

const CI_CD_CANONICAL_LABEL = 'CI/CD';

export type SkillCanonicalizer = (rawSkills: string[]) => Promise<string[]>;

/**
 * Maps raw skill strings (as extracted by the LLM sanitizer, in whatever
 * language/spelling the source text used) to canonical skill ids, so
 * `frontend`/`front-end`/`front end`/`frontend-utveckling` all resolve to
 * the same skill for matching. Mirrors the hybrid approach in
 * `createTitleScopeChecker` (role-scope.ts): a cheap formatting-normalized
 * exact lookup first, then a vector similarity fallback against the
 * ever-growing `skills` vocabulary for near-variants and cross-language
 * matches, folding any newly-seen skill back into that vocabulary.
 *
 * Returns a de-duplicated list of skill ids - order is not meaningful.
 */
export function createSkillCanonicalizer(
  db: Kysely<JobDb>,
  vectorStore: VectorStore,
  embed: Embed,
  minSimilarity: number,
): SkillCanonicalizer {
  return async (rawSkills: string[]): Promise<string[]> => {
    const skillIds = new Set<string>();

    for (const raw of rawSkills) {
      const normalized = normalizeSkillLabel(raw);
      if (!normalized) continue;
      // Operating systems (Windows/Linux/macOS/...) aren't a meaningful
      // matching signal here - drop them so they're neither credited nor
      // penalized rather than becoming a skill that scores like any other.
      if (getOsSkillExclusions().has(normalized)) continue;

      const existing = await findSkillByNormalizedLabel(db, normalized);
      if (existing) {
        skillIds.add(existing.id);
        continue;
      }

      if (normalized !== normalizeSkillLabel(CI_CD_CANONICAL_LABEL) && ciCdTokenPattern.test(normalized)) {
        const ciCdId = await resolveCanonicalSkillId(db, vectorStore, embed, CI_CD_CANONICAL_LABEL);
        skillIds.add(ciCdId);
        continue;
      }

      const embedding = await embed(normalized);
      const nearest = await vectorStore.queryNearestSkill(embedding);
      if (nearest && nearest.similarity >= minSimilarity) {
        // The vector store and `skills` are two separate systems that can
        // drift (e.g. the sqlite db got recreated while Chroma's collection
        // persisted); trusting a stale id here would insert a dangling
        // `skill_id` and blow up the FK on job_required_skills/
        // candidate_skills. Confirm the row still exists before reusing it.
        if (await skillExists(db, nearest.id)) {
          skillIds.add(nearest.id);
          continue;
        }
      }

      const inserted = await insertSkillIfNew(db, {
        id: randomUUID(),
        canonicalLabel: raw,
        normalizedLabel: normalized,
        createdAt: new Date().toISOString(),
      });
      if (inserted) {
        await vectorStore.upsertSkill(inserted.id, embedding, normalized);
        skillIds.add(inserted.id);
      } else {
        // Lost a race with a concurrent insert of the same normalized label.
        const raced = await findSkillByNormalizedLabel(db, normalized);
        if (raced) skillIds.add(raced.id);
      }
    }

    return [...skillIds];
  };
}
