/**
 * Recomputes `role_category` for every already-sanitized job opening and
 * candidate from its already-stored sanitized title, without re-running
 * sanitization/embedding/skill-canonicalization (unlike `backfill-skills.ts`,
 * which does that full expensive sweep and needs Ollama/Chroma up). This is
 * the narrow backfill needed after a `categorizeRoleTitle` pattern change
 * (e.g. adding the `embedded-systems`/`mobile-native` categories and the
 * Swedish-compound title handling, 2026-09-26) - it only touches the
 * `role_category` column, purely in-process, and is safe to re-run.
 *
 * Usage: npm run backfill:role-categories --workspace @job-fetcher/api
 */
import { loadEnv } from '@job-fetcher/config';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import { categorizeRoleTitle } from '@job-fetcher/domain';

interface Sanitized {
  title?: string;
}

function parseTitle(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Sanitized;
    return parsed.title ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const env = loadEnv();
  const sqlite = openSqlite(env.DATABASE_PATH);
  const db = createKysely(sqlite);
  await runMigrations(db);

  // Jobs whose sanitization failed have no sanitized title; fall back to the
  // raw posting title so they still get a category instead of staying
  // unknown (and so, compatible with everything).
  const jobs = await db
    .selectFrom('job_embeddings as e')
    .innerJoin('job_openings as j', 'j.id', 'e.job_opening_id')
    .select(['e.job_opening_id', 'e.sanitized_json', 'e.role_category', 'j.title as raw_title'])
    .execute();

  let jobsChanged = 0;
  for (const job of jobs) {
    const title = parseTitle(job.sanitized_json) ?? job.raw_title;
    if (!title) continue;
    const next = categorizeRoleTitle(title);
    if (next === job.role_category) continue;
    await db
      .updateTable('job_embeddings')
      .set({ role_category: next })
      .where('job_opening_id', '=', job.job_opening_id)
      .execute();
    jobsChanged += 1;
    console.log(
      `job  ${job.job_opening_id}: ${job.role_category ?? 'null'} -> ${next ?? 'null'}  (${title})`,
    );
  }

  const candidates = await db
    .selectFrom('candidates')
    .select(['id', 'sanitized_json', 'role_category'])
    .where('sanitized_json', 'is not', null)
    .execute();

  let candidatesChanged = 0;
  for (const candidate of candidates) {
    const title = parseTitle(candidate.sanitized_json);
    if (!title) continue;
    const next = categorizeRoleTitle(title);
    if (next === candidate.role_category) continue;
    await db
      .updateTable('candidates')
      .set({ role_category: next })
      .where('id', '=', candidate.id)
      .execute();
    candidatesChanged += 1;
    console.log(
      `candidate ${candidate.id}: ${candidate.role_category ?? 'null'} -> ${next ?? 'null'}  (${title})`,
    );
  }

  console.log(
    `Done. jobs changed=${jobsChanged}/${jobs.length}, candidates changed=${candidatesChanged}/${candidates.length}`,
  );
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
