import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Curated (not computed) equivalence/adjacency links between canonical
 * skills - e.g. "Stakeholder Management" and "Customer-facing Experience"
 * are different labels for overlapping real-world competencies, but were
 * never merged into the same canonical skill by the stricter
 * SKILL_MATCH_MIN_SIMILARITY canonicalization threshold, and an
 * embedding-similarity-based fallback for this (tried and reverted - see
 * the 2026-09-15/16 matches-scoring discussion) proved unreliable on the
 * real skill vocabulary. This table is the deliberately manual replacement:
 * reviewable, versioned, no embedding math involved in the scoring itself.
 *
 * Stored bidirectionally (both (a,b) and (b,a) rows) so a lookup by either
 * side is a plain equality query with no OR/ordering logic. `relation_type`
 * is descriptive/for-review; `weight` (0-1] is what scoring actually uses -
 * 'equivalent' pairs are typically close to 1.0, 'related' pairs lower,
 * reflecting that they're adjacent but not interchangeable skills.
 */
export const skillRelationsMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`
      CREATE TABLE skill_relations (
        id TEXT PRIMARY KEY NOT NULL,
        skill_id_a TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        skill_id_b TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL CHECK (relation_type IN ('equivalent', 'related')),
        weight REAL NOT NULL CHECK (weight > 0 AND weight <= 1),
        created_at TEXT NOT NULL,
        UNIQUE (skill_id_a, skill_id_b)
      )
    `.execute(db);

    await sql`CREATE INDEX idx_skill_relations_a ON skill_relations(skill_id_a)`.execute(db);
  },

  async down(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS skill_relations`.execute(db);
  },
};
