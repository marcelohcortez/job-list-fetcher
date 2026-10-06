import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Persists Laya's per-(job, candidate) evaluation (score/choice/reasoning),
 * keyed by pair so it's computed once at ingestion time rather than on every
 * `GET /api/matches` - see Docs/laya-integration-plan.md "Caching / persistence".
 */
export const layaEvaluationsMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`
      CREATE TABLE laya_evaluations (
        job_opening_id TEXT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        score REAL NOT NULL,
        choice TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        model_version TEXT,
        evaluated_at TEXT NOT NULL,
        PRIMARY KEY (job_opening_id, candidate_id)
      )
    `.execute(db);

    await sql`CREATE INDEX idx_laya_evaluations_candidate ON laya_evaluations(candidate_id)`.execute(
      db,
    );
  },

  async down(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS laya_evaluations`.execute(db);
  },
};
