import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

export const cvProfileMigration: Migration = {
  async up(db: Kysely<JobDb>) {
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

  async down(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS cv_profile`.execute(db);
  },
};
