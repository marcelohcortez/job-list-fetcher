import { describe, it, expect, beforeEach } from 'vitest';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import type { JobDb } from '@job-fetcher/database';
import type { Kysely } from 'kysely';
import type { SourceAdapter } from '@job-fetcher/source-adapters';
import type { SourceRecord } from '@job-fetcher/domain';
import { createApp } from '../app';
import { runIngestion } from '../ingestion-runner';

let sqlite: ReturnType<typeof openSqlite>;
let db: Kysely<JobDb>;

function fakeAdapter(name: string, records: SourceRecord[]): SourceAdapter {
  return {
    name,
    fetchJobs: () => Promise.resolve(records),
  };
}

function record(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: 'rec-1',
    sourceName: 'cinode',
    sourceJobId: 'job-1',
    title: 'Software Engineer',
    company: 'Acme Corp',
    location: 'Gothenburg',
    description: 'A placeholder description',
    url: 'https://example.com/jobs/1',
    status: 'active',
    rawPayload: { secret: 'must-not-leak' },
    fetchedAt: new Date('2026-09-11T10:00:00.000Z'),
    ...overrides,
  };
}

const cinodeAdapter = fakeAdapter('cinode', [record()]);
const closedAdapter = fakeAdapter('closed-source', [
  record({ sourceJobId: 'closed-1', status: 'closed' }),
]);

beforeEach(async () => {
  sqlite = openSqlite(':memory:');
  db = createKysely(sqlite);
  await runMigrations(db);
});

describe('GET /jobs', () => {
  it('lives empty with no error', async () => {
    const app = createApp(db, [cinodeAdapter]);
    const res = await app.request('/jobs');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('lists ingested jobs after a run without exposing secrets', async () => {
    await runIngestion(db, [cinodeAdapter]);
    const app = createApp(db, [cinodeAdapter]);
    const res = await app.request('/jobs');
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
    expect(body.data[0]).toMatchObject({
      title: 'Software Engineer',
      companyName: 'Acme Corp',
      sourceUrl: 'https://example.com/jobs/1',
    });
  });

  it('filters by source and status and keyword', async () => {
    await runIngestion(db, [
      cinodeAdapter,
      fakeAdapter('other', [
        record({
          id: 'r2',
          sourceName: 'other',
          sourceJobId: 'x',
          title: 'Technical Business Analyst',
        }),
      ]),
    ]);
    const app = createApp(db, [cinodeAdapter]);
    const all = await (await app.request('/jobs')).json();
    expect(all.count).toBe(2);
    const other = await (await app.request('/jobs?source=other')).json();
    expect(other.count).toBe(1);
    expect(other.data[0].sourceName).toBe('other');
    const search = await (
      await app.request('/jobs/search?query=analyst')
    ).json();
    expect(search.count).toBe(1);
  });

  it('returns 404 for an unknown job id', async () => {
    const app = createApp(db, [cinodeAdapter]);
    const res = await app.request('/jobs/nope');
    expect(res.status).toBe(404);
  });

  it('returns source records on job detail', async () => {
    await runIngestion(db, [cinodeAdapter]);
    const app = createApp(db, [cinodeAdapter]);
    const list = await (await app.request('/jobs')).json();
    const detail = await (await app.request(`/jobs/${list.data[0].id}`)).json();
    expect(detail.data.sourceRecords).toHaveLength(1);
    expect(detail.data.sourceRecords[0].sourceName).toBe('cinode');
  });

  it('excludes closed jobs from results', async () => {
    await runIngestion(db, [cinodeAdapter, closedAdapter]);
    const app = createApp(db, [closedAdapter]);
    const body = await (await app.request('/jobs')).json();
    expect(body.count).toBe(1);
  });

  it('sets and clears the applied mark', async () => {
    await runIngestion(db, [cinodeAdapter]);
    const app = createApp(db, [cinodeAdapter]);
    const list = await (await app.request('/jobs')).json();
    const id = list.data[0].id;

    const set = await (
      await app.request(`/jobs/${id}/mark`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark: 'applied' }),
      })
    ).json();
    expect(set.data.userMark).toBe('applied');

    const after = await (await app.request('/jobs')).json();
    expect(after.data[0].userMark).toBe('applied');

    const detail = await (await app.request(`/jobs/${id}`)).json();
    expect(detail.data.userMark).toBe('applied');

    const clear = await (
      await app.request(`/jobs/${id}/mark`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark: null }),
      })
    ).json();
    expect(clear.data.userMark).toBeNull();
  });

  it('rejects invalid marks and unknown jobs', async () => {
    await runIngestion(db, [cinodeAdapter]);
    const app = createApp(db, [cinodeAdapter]);
    const list = await (await app.request('/jobs')).json();
    const id = list.data[0].id;

    const bad = await (
      await app.request(`/jobs/${id}/mark`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark: 'interviewing' }),
      })
    ).json();
    expect(bad.error).toBe('invalid_mark');

    const missing = await (
      await app.request('/jobs/nope/mark', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mark: 'applied' }),
      })
    ).json();
    expect(missing.error).toBe('not_found');
  });
});

describe('POST /ingestion/run', () => {
  it('triggers a run and exposes status and counts', async () => {
    const app = createApp(db, [cinodeAdapter]);
    const res = await app.request('/ingestion/run', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('success');
    expect(body.data.counts).toMatchObject({
      fetched: 1,
      created: 1,
      accepted: 1,
    });
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
  });

  it('records the run for later inspection', async () => {
    const app = createApp(db, [cinodeAdapter]);
    await app.request('/ingestion/run', { method: 'POST' });
    const runs = await (await app.request('/ingestion/runs')).json();
    expect(runs.data).toHaveLength(1);
    expect(runs.data[0]).toMatchObject({
      status: 'success',
      sources: ['cinode'],
    });
  });

  it('is idempotent across repeated runs', async () => {
    const app = createApp(db, [cinodeAdapter]);
    await app.request('/ingestion/run', { method: 'POST' });
    const again = await (
      await app.request('/ingestion/run', { method: 'POST' })
    ).json();
    expect(again.data.counts).toMatchObject({
      accepted: 1,
      created: 0,
      deduplicated: 1,
    });
    const body = await (await app.request('/jobs')).json();
    expect(body.count).toBe(1);
  });
});
