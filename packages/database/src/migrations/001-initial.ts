import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { JobDb } from '../schema';

export const initialMigration: Migration = {
  async up(db: Kysely<JobDb>) {
    await sql`
      CREATE TABLE job_openings (
        id TEXT PRIMARY KEY,
        canonical_key TEXT NOT NULL,
        title TEXT NOT NULL,
        company_name TEXT,
        description TEXT,
        requirements TEXT,
        benefits TEXT,
        location_text TEXT,
        normalized_location TEXT,
        country_code TEXT,
        work_model TEXT,
        employment_type TEXT,
        seniority TEXT,
        contract_type TEXT,
        contract_duration TEXT,
        salary_text TEXT,
        salary_min REAL,
        salary_max REAL,
        salary_currency TEXT,
        published_at TEXT,
        deadline_at TEXT,
        status TEXT NOT NULL,
        source_name TEXT NOT NULL,
        source_job_id TEXT,
        source_url TEXT NOT NULL,
        application_url TEXT,
        raw_payload TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_verified_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `.execute(db);

    await sql`
      CREATE INDEX idx_job_openings_canonical_key ON job_openings (canonical_key)
    `.execute(db);
    await sql`
      CREATE INDEX idx_job_openings_source_name ON job_openings (source_name)
    `.execute(db);

    await sql`
      CREATE TABLE source_records (
        id TEXT PRIMARY KEY,
        job_opening_id TEXT REFERENCES job_openings (id) ON DELETE SET NULL,
        source_name TEXT NOT NULL,
        source_job_id TEXT,
        title TEXT NOT NULL,
        company TEXT,
        location TEXT,
        description TEXT,
        url TEXT NOT NULL,
        application_url TEXT,
        deadline TEXT,
        status TEXT NOT NULL,
        raw_payload TEXT,
        fetched_at TEXT NOT NULL,
        source_published_at TEXT
      )
    `.execute(db);

    await sql`
      CREATE INDEX idx_source_records_identity
      ON source_records (source_name, source_job_id)
    `.execute(db);

    await sql`
      CREATE TABLE ingestion_runs (
        id TEXT PRIMARY KEY,
        start_time TEXT NOT NULL,
        end_time TEXT,
        status TEXT NOT NULL,
        sources TEXT NOT NULL,
        counts TEXT,
        error TEXT
      )
    `.execute(db);
  },

  async down(db: Kysely<JobDb>) {
    await sql`DROP TABLE IF EXISTS source_records`.execute(db);
    await sql`DROP TABLE IF EXISTS ingestion_runs`.execute(db);
    await sql`DROP TABLE IF EXISTS job_openings`.execute(db);
  },
};
