import type { Kysely } from 'kysely';
import type { JobDb } from '../schema';

export async function markJobSanitized(
  db: Kysely<JobDb>,
  jobOpeningId: string,
  input: { sanitizedJson: string; anchorDocument: string; roleCategory: string | null },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto('job_embeddings')
    .values({
      job_opening_id: jobOpeningId,
      status: 'sanitized',
      sanitized_json: input.sanitizedJson,
      anchor_document: input.anchorDocument,
      role_category: input.roleCategory,
      error: null,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column('job_opening_id').doUpdateSet((eb) => ({
        status: 'sanitized',
        sanitized_json: eb.ref('excluded.sanitized_json'),
        anchor_document: eb.ref('excluded.anchor_document'),
        role_category: eb.ref('excluded.role_category'),
        error: null,
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();
}

export async function markJobEmbeddingFailed(
  db: Kysely<JobDb>,
  jobOpeningId: string,
  error: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto('job_embeddings')
    .values({
      job_opening_id: jobOpeningId,
      status: 'failed',
      sanitized_json: null,
      anchor_document: null,
      role_category: null,
      error,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column('job_opening_id').doUpdateSet({ status: 'failed', error, updated_at: now }),
    )
    .execute();
}

export async function getJobEmbeddingStatus(db: Kysely<JobDb>, jobOpeningId: string) {
  return db
    .selectFrom('job_embeddings')
    .selectAll()
    .where('job_opening_id', '=', jobOpeningId)
    .executeTakeFirst();
}

export async function getJobRoleCategories(
  db: Kysely<JobDb>,
  jobOpeningIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (jobOpeningIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('job_embeddings')
    .select(['job_opening_id', 'role_category'])
    .where('job_opening_id', 'in', jobOpeningIds)
    .execute();
  return new Map(rows.map((row) => [row.job_opening_id, row.role_category]));
}
