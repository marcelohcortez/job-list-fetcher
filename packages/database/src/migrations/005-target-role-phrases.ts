import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Anchor phrases for the vector-based title scope check (see
 * @job-fetcher/semantic-match / apps/api role-scope.ts). Seeded from the
 * static `TARGET_ROLES` list and then grown at ingest time as new title
 * phrasings are confirmed in scope, so the vector side of the scope check
 * keeps pace with real-world title variation without code changes.
 */
export const targetRolePhrasesMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`
      CREATE TABLE target_role_phrases (
        id TEXT PRIMARY KEY NOT NULL,
        phrase TEXT NOT NULL,
        normalized_phrase TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL CHECK (source IN ('seed', 'learned')),
        created_at TEXT NOT NULL
      )
    `.execute(db);
  },

  async down(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS target_role_phrases`.execute(db);
  },
};
