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
import { OS_SKILL_EXCLUSIONS } from './skill-relations-seed';

export type Embed = (text: string) => Promise<number[]>;

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
      if (OS_SKILL_EXCLUSIONS.has(normalized)) continue;

      const existing = await findSkillByNormalizedLabel(db, normalized);
      if (existing) {
        skillIds.add(existing.id);
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
