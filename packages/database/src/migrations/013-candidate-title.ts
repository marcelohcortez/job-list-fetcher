import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Stores the candidate's sanitized `title` (e.g. "Senior .NET-utvecklare")
 * alongside `candidate_name`, so duplicate detection
 * (`findSanitizedCandidateByNameAndTitle`) can tell two CVs for the same
 * person apart when they're for different roles - e.g. a consultant with
 * separate "Backend Developer" and "Solutions Architect" profiles. Without
 * this, a second CV for the same name always overwrote the first
 * (`markCandidateDuplicate`) regardless of role.
 */
export const candidateTitleMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`ALTER TABLE candidates ADD COLUMN candidate_title TEXT`.execute(db);
  },

  async down(_db: Kysely<JobDb>) {
    // See 009-role-categories's `down` - same SQLite DROP COLUMN caveat.
  },
};
