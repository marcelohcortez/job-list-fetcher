import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Tracks which candidate CVs were sent for a given job opening, so the UI
 * can show and edit that assignment from the job card.
 */
export const jobSentCvsMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`
      CREATE TABLE job_sent_cvs (
        job_opening_id TEXT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (job_opening_id, candidate_id)
      )
    `.execute(db);

    await sql`CREATE INDEX idx_job_sent_cvs_candidate ON job_sent_cvs(candidate_id)`.execute(db);
  },

  async down(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS job_sent_cvs`.execute(db);
  },
};
