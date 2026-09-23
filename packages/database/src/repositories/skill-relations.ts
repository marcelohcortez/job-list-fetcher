import type { Kysely } from 'kysely';
import type { JobDb, SkillRelationType } from '../schema';

export interface NewSkillRelation {
  id: string;
  skillIdA: string;
  skillIdB: string;
  relationType: SkillRelationType;
  weight: number;
  createdAt: string;
}

/**
 * Inserts one direction of a skill relation unless that (a, b) pair is
 * already known. Callers wanting a bidirectional link (the normal case -
 * see the seeder) call this twice with the ids swapped.
 */
export async function insertSkillRelationIfNew(
  db: Kysely<JobDb>,
  input: NewSkillRelation,
): Promise<boolean> {
  const row = await db
    .insertInto('skill_relations')
    .values({
      id: input.id,
      skill_id_a: input.skillIdA,
      skill_id_b: input.skillIdB,
      relation_type: input.relationType,
      weight: input.weight,
      created_at: input.createdAt,
    })
    .onConflict((oc) => oc.columns(['skill_id_a', 'skill_id_b']).doNothing())
    .returning('id')
    .executeTakeFirst();
  return row != null;
}

/**
 * Inserts one direction of a skill relation, or updates its weight/type if
 * that (a, b) pair is already known. Unlike `insertSkillRelationIfNew`, an
 * existing pair's curated weight/type is refreshed rather than left stale.
 */
export async function upsertSkillRelation(
  db: Kysely<JobDb>,
  input: NewSkillRelation,
): Promise<void> {
  await db
    .insertInto('skill_relations')
    .values({
      id: input.id,
      skill_id_a: input.skillIdA,
      skill_id_b: input.skillIdB,
      relation_type: input.relationType,
      weight: input.weight,
      created_at: input.createdAt,
    })
    .onConflict((oc) =>
      oc.columns(['skill_id_a', 'skill_id_b']).doUpdateSet({
        relation_type: input.relationType,
        weight: input.weight,
      }),
    )
    .execute();
}

export interface SkillRelationPartner {
  skillId: string;
  weight: number;
}

/**
 * For each of the given skill ids, the other skills curated as
 * equivalent/related to it, with the curated weight. Used at match time to
 * give partial/full credit for a job-required skill the candidate doesn't
 * hold exactly but holds a curated relation of instead.
 */
export async function getSkillRelationsFor(
  db: Kysely<JobDb>,
  skillIds: readonly string[],
): Promise<Map<string, SkillRelationPartner[]>> {
  const result = new Map<string, SkillRelationPartner[]>();
  if (skillIds.length === 0) return result;
  const rows = await db
    .selectFrom('skill_relations')
    .select(['skill_id_a', 'skill_id_b', 'weight'])
    .where('skill_id_a', 'in', skillIds as string[])
    .execute();
  for (const row of rows) {
    const partners = result.get(row.skill_id_a) ?? [];
    partners.push({ skillId: row.skill_id_b, weight: row.weight });
    result.set(row.skill_id_a, partners);
  }
  return result;
}
