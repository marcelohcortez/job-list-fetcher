import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

/**
 * Key/value store for admin-editable settings (target roles, generic title
 * suffixes, the non-EMEA location regex, OS-skill exclusions, ...) - see the
 * Configuration screen (apps/web) and apps/api/src/config-registry.ts. Each
 * `value` is JSON: a string array for list-type settings, a plain JSON
 * string for a single regex pattern. Rows only exist once a setting has
 * been changed from its built-in default, or once seeded on first read.
 */
export const appConfigMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`
      CREATE TABLE app_config (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `.execute(db);
  },

  async down(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS app_config`.execute(db);
  },
};
