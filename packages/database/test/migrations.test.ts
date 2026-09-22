import { describe, it, expect } from 'vitest';
import {
  createKysely,
  runMigrations,
  rollbackMigrations,
  openSqlite,
} from '../src/db';
import type { Kysely } from 'kysely';
import type { JobDb } from '../src/schema';

async function withDb(fn: (db: Kysely<JobDb>) => Promise<void>) {
  const sqlite = openSqlite(':memory:');
  const db = createKysely(sqlite);
  try {
    await fn(db);
  } finally {
    sqlite.close();
  }
}

describe('migrations', () => {
  it('run cleanly up and down', async () => {
    await withDb(async (db) => {
      await runMigrations(db);

      const queryDb = db as unknown as Kysely<{
        kysely_migrations: { name: string };
      }>;
      const tables = await queryDb
        .selectFrom('kysely_migrations')
        .select('name')
        .execute();
      expect(tables.map((t) => t.name)).toContain('001-initial');

      const jobColumns = await db.introspection.getTables();
      const names = jobColumns.map((t) => t.name);
      expect(names).toContain('job_openings');
      expect(names).toContain('source_records');
      expect(names).toContain('ingestion_runs');
      expect(names).toContain('user_job_marks');
      expect(names).toContain('candidates');
      expect(names).toContain('job_embeddings');
      expect(names).toContain('target_role_phrases');
      expect(names).toContain('skills');
      expect(names).toContain('job_required_skills');
      expect(names).toContain('candidate_skills');
      expect(names).toContain('skill_relations');
      expect(names).toContain('job_sent_cvs');
      expect(names).not.toContain('cv_profile');

      const jobEmbeddingsTable = jobColumns.find((t) => t.name === 'job_embeddings');
      expect(jobEmbeddingsTable?.columns.some((c) => c.name === 'role_category')).toBe(true);
      expect(jobEmbeddingsTable?.columns.some((c) => c.name === 'seniority_level')).toBe(true);
      const candidatesTable = jobColumns.find((t) => t.name === 'candidates');
      expect(candidatesTable?.columns.some((c) => c.name === 'role_category')).toBe(true);
      expect(candidatesTable?.columns.some((c) => c.name === 'seniority_level')).toBe(true);
      const userJobMarksTable = jobColumns.find((t) => t.name === 'user_job_marks');
      expect(userJobMarksTable?.columns.some((c) => c.name === 'seen_at')).toBe(true);

      const indexes = jobColumns.flatMap((t) => t.columns).length;
      expect(indexes).toBeGreaterThan(0);

      // 012-seniority-level's `down` is a no-op (same SQLite DROP COLUMN
      // caveat as 009-role-categories), so this rollback removes only the
      // migration record - job_sent_cvs is still the next table to go.
      await rollbackMigrations(db);
      const afterSeniorityLevel = await db.introspection.getTables();
      expect(afterSeniorityLevel.map((t) => t.name)).toContain('job_sent_cvs');

      await rollbackMigrations(db);
      const afterSentCvs = await db.introspection.getTables();
      expect(afterSentCvs.map((t) => t.name)).not.toContain('job_sent_cvs');
      expect(afterSentCvs.map((t) => t.name)).toContain('user_job_marks');

      await rollbackMigrations(db);
      const afterSeenJobs = await db.introspection.getTables();
      const userJobMarksAfterSeenRollback = afterSeenJobs.find(
        (t) => t.name === 'user_job_marks',
      );
      expect(
        userJobMarksAfterSeenRollback?.columns.some((c) => c.name === 'seen_at'),
      ).toBe(false);
      expect(afterSeenJobs.map((t) => t.name)).toContain('skill_relations');

      await rollbackMigrations(db);
      const afterRoleCategories = await db.introspection.getTables();
      expect(afterRoleCategories.map((t) => t.name)).toContain('skill_relations');

      await rollbackMigrations(db);
      const afterSkillRelations = await db.introspection.getTables();
      const namesAfterSkillRelations = afterSkillRelations.map((t) => t.name);
      expect(namesAfterSkillRelations).not.toContain('skill_relations');
      expect(namesAfterSkillRelations).toContain('skills');

      await rollbackMigrations(db);
      const afterSkillTaxonomy = await db.introspection.getTables();
      const namesAfterSkillTaxonomy = afterSkillTaxonomy.map((t) => t.name);
      expect(namesAfterSkillTaxonomy).not.toContain('skills');
      expect(namesAfterSkillTaxonomy).toContain('target_role_phrases');

      await rollbackMigrations(db);
      const afterMinusOne = await db.introspection.getTables();
      const namesAfterMinusOne = afterMinusOne.map((t) => t.name);
      expect(namesAfterMinusOne).toContain('target_role_phrases');
      expect(namesAfterMinusOne).toContain('candidates');

      await rollbackMigrations(db);
      const afterZero = await db.introspection.getTables();
      const namesAfterZero = afterZero.map((t) => t.name);
      expect(namesAfterZero).not.toContain('target_role_phrases');
      expect(namesAfterZero).toContain('candidates');

      await rollbackMigrations(db);
      const afterOne = await db.introspection.getTables();
      const namesAfterOne = afterOne.map((t) => t.name);
      expect(namesAfterOne).not.toContain('candidates');
      expect(namesAfterOne).not.toContain('job_embeddings');
      expect(namesAfterOne).toContain('cv_profile');
      expect(namesAfterOne).toContain('job_openings');

      await rollbackMigrations(db);
      const afterTwo = await db.introspection.getTables();
      const namesAfterTwo = afterTwo.map((t) => t.name);
      expect(namesAfterTwo).not.toContain('cv_profile');
      expect(namesAfterTwo).toContain('job_openings');

      await rollbackMigrations(db);
      const afterThree = await db.introspection.getTables();
      const namesAfterThree = afterThree.map((t) => t.name);
      expect(namesAfterThree).not.toContain('user_job_marks');
      expect(namesAfterThree).toContain('job_openings');

      await rollbackMigrations(db);
      const after = await db.introspection.getTables();
      expect(after.map((t) => t.name)).not.toContain('job_openings');
    });
  });

  it('creates the canonical_key index', async () => {
    await withDb(async (db) => {
      await runMigrations(db);
      const tables = await db.introspection.getTables();
      const table = tables.find((t) => t.name === 'job_openings');
      const keyCol = table?.columns.find((c) => c.name === 'canonical_key');
      expect(keyCol).toBeDefined();
      expect(keyCol?.isNullable).toBe(false);
    });
  });
});
