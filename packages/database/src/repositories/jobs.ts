import type { Kysely, Transaction } from 'kysely';
import type { SourceRecord } from '@job-fetcher/domain';
import {
  calculateCanonicalKey,
  canonicalizeLocation,
} from '@job-fetcher/domain';
import type { JobDb } from '../schema';
import type { JobOpeningsTable, SourceRecordsTable } from '../schema';
import { toJobOpening } from '../mappers';

export interface JobFilter {
  source?: string;
  location?: string;
  status?: string;
  employmentType?: string;
  seniority?: string;
  query?: string;
  limit?: number;
  offset?: number;
}

export interface IngestResult {
  created: boolean;
  unchanged: boolean;
  jobOpeningId: string;
}

function jobRow(
  record: SourceRecord,
  now: string,
): Omit<JobOpeningsTable, 'canonical_key'> & { canonical_key: string } {
  return {
    id: record.id,
    canonical_key: calculateCanonicalKey(record),
    title: record.title,
    company_name: record.company,
    description: record.description,
    requirements: null,
    benefits: null,
    location_text: record.location,
    normalized_location: canonicalizeLocation(record.location),
    country_code: null,
    work_model: null,
    employment_type: null,
    seniority: null,
    contract_type: null,
    contract_duration: null,
    salary_text: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    published_at: record.sourcePublishedAt?.toISOString() ?? null,
    deadline_at: record.deadline?.toISOString() ?? null,
    status: record.status,
    source_name: record.sourceName,
    source_job_id: record.sourceJobId,
    source_url: record.url,
    application_url: record.applicationUrl ?? null,
    raw_payload:
      record.rawPayload != null ? JSON.stringify(record.rawPayload) : null,
    first_seen_at: now,
    last_seen_at: now,
    last_verified_at: now,
    created_at: now,
    updated_at: now,
  };
}

function sourceRecordRow(
  record: SourceRecord,
  jobOpeningId: string,
): SourceRecordsTable {
  return {
    id: `${record.sourceName}:${record.sourceJobId ?? record.id}`,
    job_opening_id: jobOpeningId,
    source_name: record.sourceName,
    source_job_id: record.sourceJobId,
    title: record.title,
    company: record.company,
    location: record.location,
    description: record.description,
    url: record.url,
    application_url: record.applicationUrl ?? null,
    deadline: record.deadline?.toISOString() ?? null,
    status: record.status,
    raw_payload:
      record.rawPayload != null ? JSON.stringify(record.rawPayload) : null,
    fetched_at: record.fetchedAt.toISOString(),
    source_published_at: record.sourcePublishedAt?.toISOString() ?? null,
  };
}

function recordFingerprint(record: SourceRecord): string {
  return JSON.stringify([
    record.title?.trim().toLowerCase(),
    record.company?.trim().toLowerCase(),
    record.location?.trim().toLowerCase(),
    record.description,
    record.url,
    record.applicationUrl ?? null,
    record.status,
    record.deadline?.toISOString() ?? null,
  ]);
}

function sourceRecordFingerprint(row: SourceRecordsTable): string {
  return JSON.stringify([
    row.title?.trim().toLowerCase(),
    row.company?.trim().toLowerCase(),
    row.location?.trim().toLowerCase(),
    row.description,
    row.url,
    row.application_url,
    row.status,
    row.deadline,
  ]);
}

async function upsertJobOpening(
  trx: Transaction<JobDb>,
  record: SourceRecord,
  now: string,
): Promise<{ id: string; created: boolean }> {
  const { canonical_key } = jobRow(record, now);

  // A row already owned by this exact source record (same id) takes
  // priority over the canonical-key lookup below: the job's title/company/
  // location may have drifted upstream since it was first ingested, which
  // changes its canonical key. Falling through to an insert in that case
  // would collide on the primary key instead of updating the row in place.
  const ownRow = await trx
    .selectFrom('job_openings')
    .select(['id'])
    .where('id', '=', record.id)
    .executeTakeFirst();

  const existing =
    ownRow ??
    (await trx
      .selectFrom('job_openings')
      .select(['id'])
      .where('canonical_key', '=', canonical_key)
      .executeTakeFirst());

  if (existing) {
    // Never let the update touch `id` - a canonical-key match can point at a
    // row created by a different source record, whose id differs from this
    // one, and rewriting a row's primary key breaks the FK that
    // source_records/job_marks/job_embeddings hold on the old value. Only
    // refresh canonical_key when this row is the one this exact source
    // record owns; a cross-source match keeps its original canonical_key.
    const { id: _id, ...rest } = jobRow(record, now);
    const content = ownRow
      ? rest
      : (() => {
          const { canonical_key: _canonical, ...withoutKey } = rest;
          return withoutKey;
        })();
    await trx
      .updateTable('job_openings')
      .set({
        ...content,
        last_seen_at: now,
        last_verified_at: now,
        updated_at: now,
      })
      .where('id', '=', existing.id)
      .execute();
    return { id: existing.id, created: false };
  }

  const inserted = await trx
    .insertInto('job_openings')
    .values(jobRow(record, now))
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: inserted.id, created: true };
}

export function listJobs(db: Kysely<JobDb>, filter: JobFilter = {}) {
  let q = db.selectFrom('job_openings').selectAll();

  if (filter.source) q = q.where('source_name', '=', filter.source);
  if (filter.status) q = q.where('status', '=', filter.status);
  if (filter.employmentType)
    q = q.where('employment_type', '=', filter.employmentType);
  if (filter.seniority) q = q.where('seniority', '=', filter.seniority);
  if (filter.location) {
    const needle = `%${filter.location.toLowerCase()}%`;
    q = q.where((eb) =>
      eb.or([
        eb('normalized_location', 'like', needle),
        eb('location_text', 'like', needle),
      ]),
    );
  }
  if (filter.query) {
    const needle = `%${filter.query}%`;
    q = q.where((eb) =>
      eb.or([
        eb('title', 'like', needle),
        eb('company_name', 'like', needle),
        eb('description', 'like', needle),
      ]),
    );
  }

  const now = new Date().toISOString();
  const oneYearAgo = new Date(
    Date.now() - 365 * 24 * 60 * 60 * 1000,
  ).toISOString();

  q = q.where((eb) =>
    eb.or([eb('deadline_at', 'is', null), eb('deadline_at', '>=', now)]),
  );
  q = q.where((eb) =>
    eb.or([
      eb('published_at', 'is', null),
      eb('published_at', '>=', oneYearAgo),
    ]),
  );

  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;

  return q
    .orderBy('published_at', 'desc')
    .orderBy('last_verified_at', 'desc')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute()
    .then((rows) => rows.map(toJobOpening));
}

export function getJobById(db: Kysely<JobDb>, id: string) {
  return db
    .selectFrom('job_openings')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()
    .then((row) => (row ? toJobOpening(row) : null));
}

export function getSourcesForJob(db: Kysely<JobDb>, jobOpeningId: string) {
  return db
    .selectFrom('source_records')
    .selectAll()
    .where('job_opening_id', '=', jobOpeningId)
    .execute();
}

export async function updateJobDescription(
  db: Kysely<JobDb>,
  id: string,
  description: string | null,
): Promise<void> {
  await db
    .updateTable('job_openings')
    .set({ description, updated_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute();
}

export function countJobs(db: Kysely<JobDb>): Promise<number> {
  return db
    .selectFrom('job_openings')
    .select(db.fn.countAll().as('count'))
    .executeTakeFirst()
    .then((row) => Number(row?.count ?? 0));
}

export async function ingestSourceRecord(
  db: Kysely<JobDb>,
  record: SourceRecord,
): Promise<IngestResult> {
  return db.transaction().execute(async (trx) => {
    const now = new Date().toISOString();
    const fingerprint = recordFingerprint(record);

    const existingSource = await trx
      .selectFrom('source_records')
      .select(['id', 'job_opening_id'])
      .where('source_name', '=', record.sourceName)
      .where('source_job_id', '=', record.sourceJobId)
      .executeTakeFirst();

    if (existingSource) {
      const stored = await trx
        .selectFrom('source_records')
        .selectAll()
        .where('id', '=', existingSource.id)
        .executeTakeFirst();

      if (stored && sourceRecordFingerprint(stored) === fingerprint) {
        return {
          created: false,
          unchanged: true,
          jobOpeningId: existingSource.job_opening_id as string,
        };
      }

      const { id, created } = await upsertJobOpening(trx, record, now);
      await trx
        .updateTable('source_records')
        .set(sourceRecordRow(record, id))
        .where('id', '=', existingSource.id)
        .execute();
      return { created, unchanged: false, jobOpeningId: id };
    }

    const { id, created } = await upsertJobOpening(trx, record, now);
    await trx
      .insertInto('source_records')
      .values(sourceRecordRow(record, id))
      .execute();
    return { created, unchanged: false, jobOpeningId: id };
  });
}
