import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Coarse seniority-level classification (see `categorizeSeniority` in
 * `@job-fetcher/domain`), computed and stored the same way `role_category`
 * was in `009-role-categories` - one more derived column alongside the
 * existing sanitize outputs, not a new table. Added during the 2026-09-22
 * matching-quality audit: `role_category` checks what kind of role a title
 * is for, but nothing checked what level, so a junior CV could outscore a
 * senior-only posting purely on skill/similarity overlap.
 */
export const seniorityLevelMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`ALTER TABLE job_embeddings ADD COLUMN seniority_level TEXT`.execute(db);
    await sql`ALTER TABLE candidates ADD COLUMN seniority_level TEXT`.execute(db);
  },

  async down(_db: Kysely<JobDb>) {
    // See 009-role-categories's `down` - same SQLite DROP COLUMN caveat.
  },
};
