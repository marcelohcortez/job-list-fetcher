import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { normalizeSkillLabel } from '@job-fetcher/domain';
import {
  findSkillByNormalizedLabel,
  insertSkillIfNew,
  type JobDb,
} from '@job-fetcher/database';
import type { VectorStore } from '@job-fetcher/semantic-match';

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

      const existing = await findSkillByNormalizedLabel(db, normalized);
      if (existing) {
        skillIds.add(existing.id);
        continue;
      }

      const embedding = await embed(normalized);
      const nearest = await vectorStore.queryNearestSkill(embedding);
      if (nearest && nearest.similarity >= minSimilarity) {
        skillIds.add(nearest.id);
        continue;
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
