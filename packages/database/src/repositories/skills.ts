import type { Kysely } from 'kysely';
import type { JobDb, SkillTable } from '../schema';

export interface NewSkill {
  id: string;
  canonicalLabel: string;
  normalizedLabel: string;
  createdAt: string;
}

/**
 * Inserts a skill unless its normalized label is already known, returning
 * the inserted row or `null` when it was already present. Mirrors
 * `insertTargetRolePhraseIfNew`.
 */
export async function insertSkillIfNew(
  db: Kysely<JobDb>,
  input: NewSkill,
): Promise<SkillTable | null> {
  const row = await db
    .insertInto('skills')
    .values({
      id: input.id,
      canonical_label: input.canonicalLabel,
      normalized_label: input.normalizedLabel,
      created_at: input.createdAt,
    })
    .onConflict((oc) => oc.column('normalized_label').doNothing())
    .returningAll()
    .executeTakeFirst();
  return row ?? null;
}

export async function findSkillByNormalizedLabel(
  db: Kysely<JobDb>,
  normalizedLabel: string,
): Promise<SkillTable | null> {
  const row = await db
    .selectFrom('skills')
    .selectAll()
    .where('normalized_label', '=', normalizedLabel)
    .executeTakeFirst();
  return row ?? null;
}

export async function skillExists(
  db: Kysely<JobDb>,
  id: string,
): Promise<boolean> {
  const row = await db
    .selectFrom('skills')
    .select('id')
    .where('id', '=', id)
    .executeTakeFirst();
  return row != null;
}

/** Replaces the full set of a job opening's required skills. */
export async function replaceJobRequiredSkills(
  db: Kysely<JobDb>,
  jobOpeningId: string,
  skillIds: string[],
): Promise<void> {
  await db
    .deleteFrom('job_required_skills')
    .where('job_opening_id', '=', jobOpeningId)
    .execute();
  if (skillIds.length === 0) return;
  await db
    .insertInto('job_required_skills')
    .values(skillIds.map((skillId) => ({ job_opening_id: jobOpeningId, skill_id: skillId })))
    .execute();
}

/** Replaces the full set of a candidate's skills. */
export async function replaceCandidateSkills(
  db: Kysely<JobDb>,
  candidateId: string,
  skillIds: string[],
): Promise<void> {
  await db
    .deleteFrom('candidate_skills')
    .where('candidate_id', '=', candidateId)
    .execute();
  if (skillIds.length === 0) return;
  await db
    .insertInto('candidate_skills')
    .values(skillIds.map((skillId) => ({ candidate_id: candidateId, skill_id: skillId })))
    .execute();
}

export async function getJobRequiredSkillIds(
  db: Kysely<JobDb>,
  jobOpeningId: string,
): Promise<string[]> {
  const rows = await db
    .selectFrom('job_required_skills')
    .select('skill_id')
    .where('job_opening_id', '=', jobOpeningId)
    .execute();
  return rows.map((row) => row.skill_id);
}

export interface JobRequiredSkillLabel {
  id: string;
  label: string;
}

/** Job's required skills with their canonical labels, for display. */
export async function getJobRequiredSkillLabels(
  db: Kysely<JobDb>,
  jobOpeningId: string,
): Promise<JobRequiredSkillLabel[]> {
  const rows = await db
    .selectFrom('job_required_skills')
    .innerJoin('skills', 'skills.id', 'job_required_skills.skill_id')
    .select(['skills.id as id', 'skills.canonical_label as label'])
    .where('job_required_skills.job_opening_id', '=', jobOpeningId)
    .execute();
  return rows;
}

export async function getCandidateSkillIds(
  db: Kysely<JobDb>,
  candidateId: string,
): Promise<string[]> {
  const rows = await db
    .selectFrom('candidate_skills')
    .select('skill_id')
    .where('candidate_id', '=', candidateId)
    .execute();
  return rows.map((row) => row.skill_id);
}
