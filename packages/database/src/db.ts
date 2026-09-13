import type Database from 'better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Kysely, SqliteDialect } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { JobDb } from './schema';
import { migrationProvider } from './migrations';

export function openSqlite(filePath: string): Database.Database {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  return new BetterSqlite3(filePath);
}

export function createKysely(db: Database.Database): Kysely<JobDb> {
  return new Kysely<JobDb>({
    dialect: new SqliteDialect({ database: db }),
  });
}

export async function runMigrations(db: Kysely<JobDb>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: migrationProvider,
    migrationTableName: 'kysely_migrations',
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  for (const result of results ?? []) {
    if (result.status === 'Error') {
      throw new Error(`Migration "${result.migrationName}" failed`);
    }
  }
}

export async function rollbackMigrations(db: Kysely<JobDb>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: migrationProvider,
    migrationTableName: 'kysely_migrations',
  });
  await migrator.migrateDown();
}

export function createMigratedDb(filePath = ':memory:'): {
  sqlite: Database.Database;
  db: Kysely<JobDb>;
} {
  const sqlite = openSqlite(filePath);
  const db = createKysely(sqlite);
  return { sqlite, db };
}
