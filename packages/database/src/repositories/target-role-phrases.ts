import type { Kysely } from 'kysely';
import type { JobDb, TargetRolePhraseSource, TargetRolePhraseTable } from '../schema';

export interface NewTargetRolePhrase {
  id: string;
  phrase: string;
  normalizedPhrase: string;
  source: TargetRolePhraseSource;
  createdAt: string;
}

export async function listTargetRolePhrases(
  db: Kysely<JobDb>,
): Promise<TargetRolePhraseTable[]> {
  return db.selectFrom('target_role_phrases').selectAll().execute();
}

/**
 * Inserts a phrase unless its normalized form is already known, returning
 * the inserted row or `null` when it was already present.
 */
export async function insertTargetRolePhraseIfNew(
  db: Kysely<JobDb>,
  input: NewTargetRolePhrase,
): Promise<TargetRolePhraseTable | null> {
  const row = await db
    .insertInto('target_role_phrases')
    .values({
      id: input.id,
      phrase: input.phrase,
      normalized_phrase: input.normalizedPhrase,
      source: input.source,
      created_at: input.createdAt,
    })
    .onConflict((oc) => oc.column('normalized_phrase').doNothing())
    .returningAll()
    .executeTakeFirst();
  return row ?? null;
}
