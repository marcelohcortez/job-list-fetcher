import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

// Adds 'dead' as a mark: a job whose CV was refused or whose opening is no
// longer available. Dead jobs drop out of the normal listing and appear on
// the History page instead.
export const deadJobsMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`
      CREATE TABLE user_job_marks_new (
        job_opening_id TEXT PRIMARY KEY NOT NULL
          REFERENCES job_openings (id) ON DELETE CASCADE,
        mark TEXT CHECK (mark IN ('applied', 'saved', 'dead')),
        seen_at TEXT,
        updated_at TEXT NOT NULL
      )
    `.execute(db);

    await sql`
      INSERT INTO user_job_marks_new (job_opening_id, mark, seen_at, updated_at)
      SELECT job_opening_id, mark, seen_at, updated_at
      FROM user_job_marks
    `.execute(db);

    await sql`DROP TABLE user_job_marks`.execute(db);
    await sql`ALTER TABLE user_job_marks_new RENAME TO user_job_marks`.execute(db);
  },

  async down(db: Kysely<JobDb>) {
    await sql`
      CREATE TABLE user_job_marks_old (
        job_opening_id TEXT PRIMARY KEY NOT NULL
          REFERENCES job_openings (id) ON DELETE CASCADE,
        mark TEXT CHECK (mark IN ('applied', 'saved')),
        seen_at TEXT,
        updated_at TEXT NOT NULL
      )
    `.execute(db);

    await sql`
      INSERT INTO user_job_marks_old (job_opening_id, mark, seen_at, updated_at)
      SELECT job_opening_id,
        CASE WHEN mark = 'dead' THEN NULL ELSE mark END,
        seen_at,
        updated_at
      FROM user_job_marks
    `.execute(db);

    await sql`DROP TABLE user_job_marks`.execute(db);
    await sql`ALTER TABLE user_job_marks_old RENAME TO user_job_marks`.execute(db);
  },
};
