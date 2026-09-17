import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Canonical skill vocabulary plus per-job/per-candidate skill links, so
 * matching can score explicit skill overlap instead of relying only on
 * whole-document embedding similarity (see ADR 0009). `skills` holds one row
 * per distinct concept (embeddings live in Chroma, keyed by `id`, mirroring
 * `target_role_phrases`); the two link tables are pure junctions rebuilt in
 * full every time a job or candidate is (re-)sanitized.
 */
export const skillTaxonomyMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY NOT NULL,
        canonical_label TEXT NOT NULL,
        normalized_label TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      )
    `.execute(db);

    await sql`
      CREATE TABLE job_required_skills (
        job_opening_id TEXT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        PRIMARY KEY (job_opening_id, skill_id)
      )
    `.execute(db);

    await sql`
      CREATE TABLE candidate_skills (
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        PRIMARY KEY (candidate_id, skill_id)
      )
    `.execute(db);

    await sql`CREATE INDEX idx_job_required_skills_skill ON job_required_skills(skill_id)`.execute(db);
    await sql`CREATE INDEX idx_candidate_skills_skill ON candidate_skills(skill_id)`.execute(db);
  },

  async down(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS candidate_skills`.execute(db);
    await sql`DROP TABLE IF EXISTS job_required_skills`.execute(db);
    await sql`DROP TABLE IF EXISTS skills`.execute(db);
  },
};
