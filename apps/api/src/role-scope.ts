import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { getTargetRoles, matchesTargetTitle } from '@job-fetcher/domain';
import {
  insertTargetRolePhraseIfNew,
  listTargetRolePhrases,
  type JobDb,
} from '@job-fetcher/database';
import type { VectorStore } from '@job-fetcher/semantic-match';
import type { TitleScopeCheck } from './ingestion-runner';

export type Embed = (text: string) => Promise<number[]>;

function normalizePhrase(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Embeds any `TARGET_ROLES` entries not yet in the `target_role_phrases`
 * vector collection. Idempotent - safe to call on every startup.
 */
export async function seedTargetRolePhrases(
  db: Kysely<JobDb>,
  vectorStore: VectorStore,
  embed: Embed,
): Promise<void> {
  const known = new Set(
    (await listTargetRolePhrases(db)).map((row) => row.normalized_phrase),
  );

  for (const role of getTargetRoles()) {
    const normalizedPhrase = normalizePhrase(role);
    if (known.has(normalizedPhrase)) continue;

    const inserted = await insertTargetRolePhraseIfNew(db, {
      id: randomUUID(),
      phrase: role,
      normalizedPhrase,
      source: 'seed',
      createdAt: new Date().toISOString(),
    });
    if (!inserted) continue;

    const embedding = await embed(role);
    await vectorStore.upsertRolePhrase(inserted.id, embedding, role);
    known.add(normalizedPhrase);
  }
}

/**
 * Hybrid title scope check: the exact `TARGET_ROLES` regex match first, then
 * a vector similarity fallback against the ever-growing
 * `target_role_phrases` collection for titles that are close variants of a
 * known role but don't match the regex exactly (e.g. "Senior Fullstack
 * Engineer II"). Any title accepted via the vector fallback is folded back
 * into the phrase list, so the vector side keeps learning new phrasings.
 */
export function createTitleScopeChecker(
  db: Kysely<JobDb>,
  vectorStore: VectorStore,
  embed: Embed,
  minSimilarity: number,
): TitleScopeCheck {
  return async (title: string): Promise<boolean> => {
    if (!title) return false;
    if (matchesTargetTitle(title)) return true;

    const embedding = await embed(title);
    const nearest = await vectorStore.queryNearestRolePhrase(embedding);
    if (!nearest || nearest.similarity < minSimilarity) return false;

    const inserted = await insertTargetRolePhraseIfNew(db, {
      id: randomUUID(),
      phrase: title,
      normalizedPhrase: normalizePhrase(title),
      source: 'learned',
      createdAt: new Date().toISOString(),
    });
    if (inserted) {
      await vectorStore.upsertRolePhrase(inserted.id, embedding, title);
    }
    return true;
  };
}
