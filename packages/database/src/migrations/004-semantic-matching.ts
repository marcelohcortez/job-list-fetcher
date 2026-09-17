import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Retires the singleton `cv_profile` keyword-match flow in favour of a
 * multi-candidate semantic pipeline (see @job-fetcher/semantic-match):
 * `candidates` replaces `cv_profile`, and `job_embeddings` tracks the
 * sanitize/embed status of each job opening (the vectors themselves live in
 * Chroma, keyed by these same ids).
 */
export const semanticMatchingMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS cv_profile`.execute(db);

    await sql`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY NOT NULL,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        pdf_bytes BLOB,
        extracted_text TEXT NOT NULL,
        candidate_name TEXT,
        sanitized_json TEXT,
        anchor_document TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sanitized', 'failed')),
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `.execute(db);

    await sql`
      CREATE TABLE job_embeddings (
        job_opening_id TEXT PRIMARY KEY NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sanitized', 'failed')),
        anchor_document TEXT,
        sanitized_json TEXT,
        error TEXT,
        updated_at TEXT NOT NULL
      )
    `.execute(db);
  },

  async down(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS job_embeddings`.execute(db);
    await sql`DROP TABLE IF EXISTS candidates`.execute(db);

    await sql`
      CREATE TABLE cv_profile (
        id TEXT PRIMARY KEY NOT NULL CHECK (id = 'current'),
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        pdf_bytes BLOB,
        extracted_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `.execute(db);
  },
};
