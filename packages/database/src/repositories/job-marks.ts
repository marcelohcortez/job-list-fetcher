import type { Kysely } from 'kysely';
import type { JobDb, UserMark } from '../schema';

export async function setUserMark(
  db: Kysely<JobDb>,
  jobOpeningId: string,
  mark: UserMark | null,
): Promise<void> {
  if (mark === null) {
    await db
      .deleteFrom('user_job_marks')
      .where('job_opening_id', '=', jobOpeningId)
      .execute();
    return;
  }

  await db
    .insertInto('user_job_marks')
    .values({
      job_opening_id: jobOpeningId,
      mark,
      updated_at: new Date().toISOString(),
    })
    .onConflict((oc) =>
      oc.column('job_opening_id').doUpdateSet((eb) => ({
        mark: eb.ref('excluded.mark'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();
}

export async function getUserMarks(
  db: Kysely<JobDb>,
  jobOpeningIds: string[],
): Promise<Record<string, UserMark | null>> {
  if (jobOpeningIds.length === 0) return {};
  const rows = await db
    .selectFrom('user_job_marks')
    .select(['job_opening_id', 'mark'])
    .where('job_opening_id', 'in', jobOpeningIds)
    .execute();
  const marks: Record<string, UserMark | null> = {};
  for (const row of rows) marks[row.job_opening_id] = row.mark;
  return marks;
}
