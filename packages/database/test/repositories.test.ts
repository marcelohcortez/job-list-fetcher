import { describe, it, expect, beforeEach } from 'vitest';
import { createKysely, runMigrations, openSqlite } from '../src/db';
import type { Kysely } from 'kysely';
import type { JobDb } from '../src/schema';
import {
  ingestSourceRecord,
  listJobs,
  getJobById,
  countJobs,
  getSourcesForJob,
} from '../src/repositories/jobs';
import {
  createIngestionRun,
  finishIngestionRun,
  listIngestionRuns,
} from '../src/repositories/ingestion-runs';
import {
  getCvProfile,
  upsertCvProfile,
  deleteCvProfile,
  toCvProfileSummary,
} from '../src/repositories/cv-profile';
import { setUserMark, getUserMarks } from '../src/repositories/job-marks';
import type { SourceRecord } from '@job-fetcher/domain';

let sqlite: ReturnType<typeof openSqlite>;
let db: Kysely<JobDb>;

beforeEach(async () => {
  sqlite = openSqlite(':memory:');
  db = createKysely(sqlite);
  await runMigrations(db);
});

function record(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: 'rec-1',
    sourceName: 'cinode',
    sourceJobId: 'job-1',
    title: 'Software Engineer',
    company: 'Acme Corp',
    location: 'Gothenburg',
    description: 'Build things',
    url: 'https://example.com/jobs/1',
    status: 'active',
    rawPayload: { source: 'cinode' },
    fetchedAt: new Date('2026-09-11T10:00:00.000Z'),
    ...overrides,
  };
}

describe('repositories', () => {
  it('deduplicates idempotent re-ingestion of the same record', async () => {
    const first = await ingestSourceRecord(db, record());
    const second = await ingestSourceRecord(db, record());

    expect(first.created).toBe(true);
    expect(second).toMatchObject({
      created: false,
      unchanged: true,
      jobOpeningId: first.jobOpeningId,
    });
    expect(await countJobs(db)).toBe(1);
  });

  it('updates a source record when its content changed', async () => {
    await ingestSourceRecord(db, record());
    const updated = await ingestSourceRecord(
      db,
      record({ description: 'Something new' }),
    );

    expect(updated.created).toBe(false);
    expect(updated.unchanged).toBe(false);
    expect((await getJobById(db, updated.jobOpeningId))?.description).toBe(
      'Something new',
    );
  });

  it('links the same canonical job from two sources', async () => {
    const a = await ingestSourceRecord(
      db,
      record({ sourceName: 'cinode', sourceJobId: 'c1' }),
    );
    const b = await ingestSourceRecord(
      db,
      record({
        sourceName: 'theirstack',
        sourceJobId: 't1',
        location: 'Göteborg',
        url: 'https://example.com/theirstack/1',
      }),
    );

    expect(a.jobOpeningId).toBe(b.jobOpeningId);
    const sources = await getSourcesForJob(db, a.jobOpeningId);
    expect(sources).toHaveLength(2);
  });

  it('lists, filters, and searches jobs', async () => {
    await ingestSourceRecord(
      db,
      record({ title: 'Backend Engineer', company: 'Acme' }),
    );
    await ingestSourceRecord(
      db,
      record({
        id: 'rec-2',
        sourceJobId: 'job-2',
        title: 'Data Analyst',
        company: 'Volvo',
        status: 'expired_grace_period',
      }),
    );

    expect((await listJobs(db)).length).toBe(2);
    expect((await listJobs(db, { source: 'cinode' })).length).toBe(2);
    expect(
      (await listJobs(db, { status: 'expired_grace_period' })).length,
    ).toBe(1);
    expect((await listJobs(db, { query: 'analyst' })).length).toBe(1);
    expect((await listJobs(db, { location: 'Gothenburg' })).length).toBe(2);
  });

  it('returns a job by id and hides nothing sensitive', async () => {
    const { jobOpeningId } = await ingestSourceRecord(
      db,
      record({ rawPayload: { hidden: true } }),
    );
    const job = await getJobById(db, jobOpeningId);
    expect(job?.title).toBe('Software Engineer');
    expect(job?.canonicalKey).toBe('software-engineer:acme-corp:gothenburg');
  });

  it('lists jobs newest published first', async () => {
    await ingestSourceRecord(
      db,
      record({
        id: 'old',
        sourceJobId: 'old',
        title: 'Old Role',
        sourcePublishedAt: new Date('2026-01-10T00:00:00.000Z'),
      }),
    );
    await ingestSourceRecord(
      db,
      record({
        id: 'new',
        sourceJobId: 'new',
        title: 'New Role',
        sourcePublishedAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    );

    const jobs = await listJobs(db);
    expect(jobs.map((j) => j.title)).toEqual(['New Role', 'Old Role']);
  });

  it('tracks ingestion runs from start to finish', async () => {
    await createIngestionRun(db, {
      id: 'run-1',
      startTime: new Date('2026-09-11T10:00:00.000Z'),
      sources: ['cinode'],
      counts: {
        fetched: 1,
        accepted: 1,
        rejected: 0,
        created: 1,
        updated: 0,
        deduplicated: 0,
        failed: 0,
      },
    });
    await finishIngestionRun(db, {
      id: 'run-1',
      endTime: new Date('2026-09-11T10:05:00.000Z'),
      status: 'success',
      counts: {
        fetched: 1,
        accepted: 1,
        rejected: 0,
        created: 1,
        updated: 0,
        deduplicated: 0,
        failed: 0,
      },
    });

    const runs = await listIngestionRuns(db);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');
    expect(runs[0].sources).toEqual(['cinode']);
    expect(runs[0].error).toBeUndefined();
  });

  it('persists user marks and returns them per job', async () => {
    const { jobOpeningId } = await ingestSourceRecord(db, record());

    expect(await getUserMarks(db, [jobOpeningId])).toEqual({});

    await setUserMark(db, jobOpeningId, 'applied');
    expect(await getUserMarks(db, [jobOpeningId])).toEqual({
      [jobOpeningId]: 'applied',
    });

    await setUserMark(db, jobOpeningId, 'not_interested');
    expect(await getUserMarks(db, [jobOpeningId])).toEqual({
      [jobOpeningId]: 'not_interested',
    });

    await setUserMark(db, jobOpeningId, null);
    expect(await getUserMarks(db, [jobOpeningId])).toEqual({});
  });

  it('upserts, reads and deletes the CV profile', async () => {
    expect(await getCvProfile(db)).toBeUndefined();

    const pdf = new Uint8Array([37, 80, 68, 70, 45]); // %PDF-
    await upsertCvProfile(db, {
      fileName: 'anna.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
      pdfBytes: pdf,
      extractedText: 'Anna Andersson, software developer',
    });

    const profile = await getCvProfile(db);
    expect(profile).toBeDefined();
    expect(profile!.file_name).toBe('anna.pdf');
    expect(profile!.extracted_text).toContain('software developer');

    const summary = toCvProfileSummary(profile!);
    expect(summary.wordCount).toBe(4);
    expect(summary.fileName).toBe('anna.pdf');

    await upsertCvProfile(db, {
      fileName: 'anna-v2.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
      pdfBytes: pdf,
      extractedText: 'Anna Andersson, machine learning engineer',
    });
    const updated = await getCvProfile(db);
    expect(updated!.file_name).toBe('anna-v2.pdf');
    expect(updated!.extracted_text).toContain('machine learning');
    expect(await deleteCvProfile(db)).toBe(true);
    expect(await getCvProfile(db)).toBeUndefined();
  });
});
