/**
 * One-off cleanup for `laya_evaluations` rows written before the Laya
 * role-category gate (see `isRolePairCompatible` in ../laya-runner.ts): any
 * row whose job and candidate role categories are both known and
 * incompatible (e.g. a `design` CV vs an `engineering` job) is deleted, so
 * the stored data matches what ingestion would produce today. Unknown
 * categories are never touched.
 *
 * Usage: npm run purge:laya-role-mismatch --workspace @job-fetcher/api [-- --dry-run]
 */
import { loadEnv } from '@job-fetcher/config';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import { areRoleCategoriesCompatible, type RoleCategory } from '@job-fetcher/domain';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const env = loadEnv();

  const sqlite = openSqlite(env.DATABASE_PATH);
  const db = createKysely(sqlite);
  await runMigrations(db);

  const rows = await db
    .selectFrom('laya_evaluations as l')
    .innerJoin('job_embeddings as j', 'j.job_opening_id', 'l.job_opening_id')
    .innerJoin('candidates as c', 'c.id', 'l.candidate_id')
    .select([
      'l.job_opening_id',
      'l.candidate_id',
      'j.role_category as job_category',
      'c.role_category as candidate_category',
    ])
    .execute();

  const incompatible = rows.filter(
    (row) =>
      !areRoleCategoriesCompatible(
        row.job_category as RoleCategory | null,
        row.candidate_category as RoleCategory | null,
      ),
  );

  console.log(
    `${incompatible.length} of ${rows.length} laya_evaluations row(s) have incompatible role categories.`,
  );
  if (dryRun) {
    console.log('Dry run - nothing deleted.');
  } else {
    for (const row of incompatible) {
      await db
        .deleteFrom('laya_evaluations')
        .where('job_opening_id', '=', row.job_opening_id)
        .where('candidate_id', '=', row.candidate_id)
        .execute();
    }
    console.log(`Deleted ${incompatible.length} row(s).`);
  }
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
