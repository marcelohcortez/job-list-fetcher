import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

export const userJobMarksMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`
      CREATE TABLE user_job_marks (
        job_opening_id TEXT PRIMARY KEY NOT NULL
          REFERENCES job_openings (id) ON DELETE CASCADE,
        mark TEXT NOT NULL CHECK (mark IN ('applied', 'not_interested')),
        updated_at TEXT NOT NULL
      )
    `.execute(db);
  },

  async down(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS user_job_marks`.execute(db);
  },
};
