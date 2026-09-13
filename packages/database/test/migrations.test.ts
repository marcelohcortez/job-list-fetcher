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
      expect(names).toContain('cv_profile');

      const indexes = jobColumns.flatMap((t) => t.columns).length;
      expect(indexes).toBeGreaterThan(0);

      await rollbackMigrations(db);
      const afterOne = await db.introspection.getTables();
      const namesAfterOne = afterOne.map((t) => t.name);
      expect(namesAfterOne).not.toContain('cv_profile');
      expect(namesAfterOne).toContain('job_openings');

      await rollbackMigrations(db);
      const afterTwo = await db.introspection.getTables();
      const namesAfterTwo = afterTwo.map((t) => t.name);
      expect(namesAfterTwo).not.toContain('user_job_marks');
      expect(namesAfterTwo).toContain('job_openings');

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
