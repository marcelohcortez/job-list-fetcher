import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Splits Laya's single `reasoning` text into a positive-only match
 * explanation and a separate `mismatch_reasoning` (gaps/what's missing),
 * so the UI never has to show one blob of text that mixes good and bad
 * points together - see the JobCard "Why this could be a good match" /
 * "Possible mismatch" sections.
 */
export const layaMismatchReasoningMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`ALTER TABLE laya_evaluations ADD COLUMN mismatch_reasoning TEXT`.execute(db);
  },

  async down(_db: Kysely<JobDb>) {
    // SQLite's ALTER TABLE DROP COLUMN support is version-dependent (same
    // caveat as 009-role-categories); the column is left in place rather
    // than rebuilding the table for a reversible no-op-at-runtime removal.
  },
};
