/**
 * One-off cleanup: deletes job_openings whose published_at is more than 6
 * months old, now that ingestion (see isJobEligible in
 * @job-fetcher/domain) rejects such records before they're ever stored.
 * Existing rows ingested before that check landed are still sitting in the
 * DB and need a manual sweep. Child rows (source_records, job_embeddings,
 * job_required_skills, user_job_marks, job_sent_cvs) cascade via FK, which
 * requires `PRAGMA foreign_keys = ON` since better-sqlite3 defaults it off.
 *
 * Safe to re-run: matches zero rows once the stale ones are gone.
 *
 * Usage: npm run purge:stale-jobs --workspace @job-fetcher/api
 */
import { loadEnv } from '@job-fetcher/config';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';

async function main() {
  const env = loadEnv();

  const sqlite = openSqlite(env.DATABASE_PATH);
  sqlite.pragma('foreign_keys = ON');
  const db = createKysely(sqlite);
  await runMigrations(db);

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 6);
  const cutoffIso = cutoff.toISOString();

  const stale = await db
    .selectFrom('job_openings')
    .select(['id', 'title', 'published_at'])
    .where('published_at', 'is not', null)
    .where('published_at', '<', cutoffIso)
    .execute();

  console.log(`Found ${stale.length} jobs published before ${cutoffIso}.`);

  if (stale.length === 0) {
    await db.destroy();
    return;
  }

  const result = await db
    .deleteFrom('job_openings')
    .where('published_at', 'is not', null)
    .where('published_at', '<', cutoffIso)
    .executeTakeFirst();

  console.log(`Deleted ${result.numDeletedRows} job_openings (cascaded child rows).`);

  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
