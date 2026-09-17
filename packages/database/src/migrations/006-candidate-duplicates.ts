import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Two CVs sanitizing to the same candidate name land in a `duplicate` holding
 * state (pointing at the existing candidate via `duplicate_of_id`) instead of
 * silently becoming two separate matchable profiles. The upload flow then
 * asks the user to ignore the new upload or replace the existing one.
 * SQLite can't alter a CHECK constraint or add a self-referencing FK column
 * in place, so the table is rebuilt.
 */
export const candidateDuplicatesMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`ALTER TABLE candidates RENAME TO candidates_old`.execute(db);

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
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sanitized', 'failed', 'duplicate')),
        error TEXT,
        duplicate_of_id TEXT REFERENCES candidates(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `.execute(db);

    await sql`
      INSERT INTO candidates (
        id, file_name, content_type, size_bytes, pdf_bytes, extracted_text,
        candidate_name, sanitized_json, anchor_document, status, error,
        duplicate_of_id, created_at, updated_at
      )
      SELECT
        id, file_name, content_type, size_bytes, pdf_bytes, extracted_text,
        candidate_name, sanitized_json, anchor_document, status, error,
        NULL, created_at, updated_at
      FROM candidates_old
    `.execute(db);

    await sql`DROP TABLE candidates_old`.execute(db);
  },

  async down(db: Kysely<JobDb>) {
    await sql`ALTER TABLE candidates RENAME TO candidates_new`.execute(db);

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
      INSERT INTO candidates (
        id, file_name, content_type, size_bytes, pdf_bytes, extracted_text,
        candidate_name, sanitized_json, anchor_document, status, error,
        created_at, updated_at
      )
      SELECT
        id, file_name, content_type, size_bytes, pdf_bytes, extracted_text,
        candidate_name, sanitized_json, anchor_document,
        CASE WHEN status = 'duplicate' THEN 'failed' ELSE status END,
        error, created_at, updated_at
      FROM candidates_new
    `.execute(db);

    await sql`DROP TABLE candidates_new`.execute(db);
  },
};
