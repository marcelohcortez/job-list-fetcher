import type { Kysely } from 'kysely';
import type { JobDb, UserMark } from '../schema';

export interface UserJobState {
  mark: UserMark | null;
  seenAt: string | null;
}

async function pruneIfEmpty(
  db: Kysely<JobDb>,
  jobOpeningId: string,
): Promise<void> {
  await db
    .deleteFrom('user_job_marks')
    .where('job_opening_id', '=', jobOpeningId)
    .where('mark', 'is', null)
    .where('seen_at', 'is', null)
    .execute();
}

async function upsertRow(
  db: Kysely<JobDb>,
  jobOpeningId: string,
  patch: { mark?: UserMark | null; seen_at?: string | null },
): Promise<void> {
  const updated_at = new Date().toISOString();
  await db
    .insertInto('user_job_marks')
    .values({
      job_opening_id: jobOpeningId,
      mark: patch.mark ?? null,
      seen_at: patch.seen_at ?? null,
      updated_at,
    })
    .onConflict((oc) =>
      oc.column('job_opening_id').doUpdateSet((eb) => ({
        ...(patch.mark !== undefined ? { mark: eb.ref('excluded.mark') } : {}),
        ...(patch.seen_at !== undefined
          ? { seen_at: eb.ref('excluded.seen_at') }
          : {}),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();
}

export async function setUserMark(
  db: Kysely<JobDb>,
  jobOpeningId: string,
  mark: UserMark | null,
): Promise<void> {
  await upsertRow(db, jobOpeningId, { mark });
  if (mark === null) await pruneIfEmpty(db, jobOpeningId);
}

export async function setJobSeen(
  db: Kysely<JobDb>,
  jobOpeningId: string,
  seen: boolean,
): Promise<void> {
  const seenAt = seen ? new Date().toISOString() : null;
  await upsertRow(db, jobOpeningId, { seen_at: seenAt });
  if (!seen) await pruneIfEmpty(db, jobOpeningId);
}

export async function getUserMarks(
  db: Kysely<JobDb>,
  jobOpeningIds: string[],
): Promise<Record<string, UserJobState>> {
  if (jobOpeningIds.length === 0) return {};
  const rows = await db
    .selectFrom('user_job_marks')
    .select(['job_opening_id', 'mark', 'seen_at'])
    .where('job_opening_id', 'in', jobOpeningIds)
    .execute();
  const marks: Record<string, UserJobState> = {};
  for (const row of rows) {
    marks[row.job_opening_id] = { mark: row.mark, seenAt: row.seen_at };
  }
  return marks;
}
