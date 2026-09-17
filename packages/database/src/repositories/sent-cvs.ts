import type { Kysely } from 'kysely';
import type { JobDb } from '../schema';

export async function setSentCvs(
  db: Kysely<JobDb>,
  jobOpeningId: string,
  candidateIds: string[],
): Promise<void> {
  const uniqueIds = Array.from(new Set(candidateIds));
  const sentAt = new Date().toISOString();

  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('job_sent_cvs')
      .where('job_opening_id', '=', jobOpeningId)
      .execute();

    if (uniqueIds.length === 0) return;

    await trx
      .insertInto('job_sent_cvs')
      .values(
        uniqueIds.map((candidateId) => ({
          job_opening_id: jobOpeningId,
          candidate_id: candidateId,
          sent_at: sentAt,
        })),
      )
      .execute();
  });
}

export async function getSentCvIds(
  db: Kysely<JobDb>,
  jobOpeningIds: string[],
): Promise<Record<string, string[]>> {
  if (jobOpeningIds.length === 0) return {};
  const rows = await db
    .selectFrom('job_sent_cvs')
    .select(['job_opening_id', 'candidate_id'])
    .where('job_opening_id', 'in', jobOpeningIds)
    .execute();

  const result: Record<string, string[]> = {};
  for (const row of rows) {
    (result[row.job_opening_id] ??= []).push(row.candidate_id);
  }
  return result;
}
