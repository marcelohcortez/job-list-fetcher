import type { Kysely } from 'kysely';
import type { AppConfigTable, JobDb } from '../schema';

export async function listAppConfig(db: Kysely<JobDb>): Promise<AppConfigTable[]> {
  return db.selectFrom('app_config').selectAll().execute();
}

export async function getAppConfig(
  db: Kysely<JobDb>,
  key: string,
): Promise<AppConfigTable | null> {
  const row = await db
    .selectFrom('app_config')
    .selectAll()
    .where('key', '=', key)
    .executeTakeFirst();
  return row ?? null;
}

export async function setAppConfig(
  db: Kysely<JobDb>,
  key: string,
  value: string,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db
    .insertInto('app_config')
    .values({ key, value, updated_at: updatedAt })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: updatedAt }))
    .execute();
}

export async function deleteAppConfig(db: Kysely<JobDb>, key: string): Promise<void> {
  await db.deleteFrom('app_config').where('key', '=', key).execute();
}
