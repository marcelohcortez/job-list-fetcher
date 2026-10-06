import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Laya's own token budget for the combined job+CV text is small (~317
 * tokens on the checkpoint it used to auto-route to, ~829 on the
 * `multilingual` checkpoint it's now forced onto - see laya.ts's
 * callSystemOne comment and the 2026-09-25/26 matching-quality
 * investigation). Neither is unlimited: a long enough anchor pair still
 * gets its tail silently dropped, with no error. This column records when
 * that happened for a given (job, candidate) evaluation, so the UI can flag
 * it on the match card (JobCard) instead of the truncation staying
 * invisible - see matches.ts/JobCard.tsx for how it's surfaced.
 */
export const layaTruncatedMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`ALTER TABLE laya_evaluations ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0`.execute(
      db,
    );
  },

  async down(_db: Kysely<JobDb>) {
    // SQLite's ALTER TABLE DROP COLUMN support is version-dependent (same
    // caveat as 009-role-categories/017-laya-mismatch-reasoning); the column
    // is left in place rather than rebuilding the table for a reversible
    // no-op-at-runtime removal.
  },
};
