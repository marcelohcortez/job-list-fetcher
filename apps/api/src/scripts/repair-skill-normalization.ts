/**
 * One-off data repair for the normalizer fix in
 * `packages/domain/src/skill-normalizer.ts` (2026-09-22 matching-quality
 * audit): `normalizeSkillLabel` used to strip `#`/`+` like any other
 * punctuation, so "C#" and a bare "C" (as extracted from a "C/C++"
 * requirement) both normalized to "c" - an exact-match collision that
 * silently merged unrelated skills. Every existing `skills` row's
 * `normalized_label` was computed under the old (buggy) function and needs
 * recomputing under the fixed one, or exact-match lookups for a *correctly*
 * extracted "C" will keep colliding with the stale "C#" row.
 *
 * For the common case (no collision after recomputing), this is a plain
 * UPDATE. If recomputing two different rows' labels now produces the same
 * normalized string (a genuine merge - not expected to be common, since the
 * bug direction was punctuation-stripping *causing* false collisions, not
 * hiding real ones), the older row survives and every reference to the
 * newer one (`job_required_skills`, `candidate_skills`, `skill_relations`)
 * is repointed at it before the newer row is deleted, so no job/candidate
 * skill association is lost.
 *
 * This only fixes the *canonical vocabulary*. Jobs already mis-tagged
 * because their required skills were extracted before this fix (e.g. an
 * embedded/C++ job pointing at the "C#" skill) still need
 * `npm run backfill:skills` afterward to re-extract and re-canonicalize
 * against the corrected vocabulary - see Docs/matching_pipeline.md.
 *
 * Usage: npm run repair:skill-normalization --workspace @job-fetcher/api
 */
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@job-fetcher/config';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import { normalizeSkillLabel } from '@job-fetcher/domain';

async function main() {
  const env = loadEnv();
  const sqlite = openSqlite(env.DATABASE_PATH);
  const db = createKysely(sqlite);
  await runMigrations(db);

  const skills = await db
    .selectFrom('skills')
    .select(['id', 'canonical_label', 'normalized_label', 'created_at'])
    .execute();

  const recomputed = skills.map((skill) => ({
    ...skill,
    newNormalized: normalizeSkillLabel(skill.canonical_label),
  }));

  const changed = recomputed.filter((skill) => skill.newNormalized !== skill.normalized_label);
  console.log(`${skills.length} skills total, ${changed.length} need a normalized_label update.`);

  const byNewNormalized = new Map<string, typeof recomputed>();
  for (const skill of recomputed) {
    const group = byNewNormalized.get(skill.newNormalized) ?? [];
    group.push(skill);
    byNewNormalized.set(skill.newNormalized, group);
  }

  let updated = 0;
  let merged = 0;

  await db.transaction().execute(async (trx) => {
    for (const [newNormalized, group] of byNewNormalized) {
      if (group.length === 1) {
        const [skill] = group;
        if (skill.newNormalized === skill.normalized_label) continue;
        await trx
          .updateTable('skills')
          .set({ normalized_label: newNormalized })
          .where('id', '=', skill.id)
          .execute();
        updated += 1;
        continue;
      }

      // Collision after recomputing: keep the oldest row, repoint every
      // reference from the others at it, then drop the others.
      const [survivor, ...losers] = [...group].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      console.warn(
        `Merging ${losers.length} skill(s) into "${survivor.canonical_label}" (${survivor.id}) ` +
          `- all normalize to "${newNormalized}": ${losers
            .map((loser) => `"${loser.canonical_label}" (${loser.id})`)
            .join(', ')}`,
      );

      await trx
        .updateTable('skills')
        .set({ normalized_label: newNormalized })
        .where('id', '=', survivor.id)
        .execute();

      for (const loser of losers) {
        const jobLinks = await trx
          .selectFrom('job_required_skills')
          .select('job_opening_id')
          .where('skill_id', '=', loser.id)
          .execute();
        for (const { job_opening_id } of jobLinks) {
          await trx
            .insertInto('job_required_skills')
            .values({ job_opening_id, skill_id: survivor.id })
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
        await trx.deleteFrom('job_required_skills').where('skill_id', '=', loser.id).execute();

        const candidateLinks = await trx
          .selectFrom('candidate_skills')
          .select('candidate_id')
          .where('skill_id', '=', loser.id)
          .execute();
        for (const { candidate_id } of candidateLinks) {
          await trx
            .insertInto('candidate_skills')
            .values({ candidate_id, skill_id: survivor.id })
            .onConflict((oc) => oc.doNothing())
            .execute();
        }
        await trx.deleteFrom('candidate_skills').where('skill_id', '=', loser.id).execute();

        // skill_relations has UNIQUE(skill_id_a, skill_id_b) on its own
        // `id`; can't just UPDATE the loser's rows in place (the survivor
        // may already hold a relation to the same other skill, or the
        // update could produce a self-relation). Re-insert each row under a
        // fresh id with the loser's side repointed at the survivor,
        // dropping any resulting duplicate/self-relation, then delete the
        // loser's original rows.
        const loserRelations = await trx
          .selectFrom('skill_relations')
          .selectAll()
          .where((eb) => eb.or([eb('skill_id_a', '=', loser.id), eb('skill_id_b', '=', loser.id)]))
          .execute();
        for (const relation of loserRelations) {
          const skillIdA = relation.skill_id_a === loser.id ? survivor.id : relation.skill_id_a;
          const skillIdB = relation.skill_id_b === loser.id ? survivor.id : relation.skill_id_b;
          if (skillIdA === skillIdB) continue;
          await trx
            .insertInto('skill_relations')
            .values({
              id: randomUUID(),
              skill_id_a: skillIdA,
              skill_id_b: skillIdB,
              relation_type: relation.relation_type,
              weight: relation.weight,
              created_at: relation.created_at,
            })
            .onConflict((oc) => oc.columns(['skill_id_a', 'skill_id_b']).doNothing())
            .execute();
        }
        await trx
          .deleteFrom('skill_relations')
          .where((eb) => eb.or([eb('skill_id_a', '=', loser.id), eb('skill_id_b', '=', loser.id)]))
          .execute();

        await trx.deleteFrom('skills').where('id', '=', loser.id).execute();
        merged += 1;
      }
    }
  });

  console.log(`Done. updated=${updated} merged=${merged}`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
