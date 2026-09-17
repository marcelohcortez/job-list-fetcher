import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Coarse role-family classification (see `categorizeRoleTitle` in
 * `@job-fetcher/domain`), computed from the sanitized `title` at the same
 * time as skill canonicalization and stored alongside the other sanitize
 * outputs - `job_embeddings` already holds a job's `sanitized_json`, and
 * `candidates` already holds a candidate's; this is one more derived column
 * next to them, not a new table. See ADR 0012.
 */
export const roleCategoriesMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`ALTER TABLE job_embeddings ADD COLUMN role_category TEXT`.execute(db);
    await sql`ALTER TABLE candidates ADD COLUMN role_category TEXT`.execute(db);
  },

  async down(_db: Kysely<JobDb>) {
    // SQLite's ALTER TABLE DROP COLUMN support is version-dependent; the
    // column is left in place rather than rebuilding both tables for a
    // reversible no-op-at-runtime column removal.
  },
};
