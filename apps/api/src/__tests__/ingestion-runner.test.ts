import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import type { JobDb } from '@job-fetcher/database';
import type { Kysely } from 'kysely';
import type { SourceAdapter } from '@job-fetcher/source-adapters';
import type { SourceRecord } from '@job-fetcher/domain';
import { runIngestion } from '../ingestion-runner';

let sqlite: ReturnType<typeof openSqlite>;
let db: Kysely<JobDb>;

function fakeAdapter(records: SourceRecord[]): SourceAdapter {
  return { name: 'cinode', fetchJobs: () => Promise.resolve(records) };
}

function record(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: 'rec-1',
    sourceName: 'cinode',
    sourceJobId: 'job-1',
    title: 'Software Engineer',
    company: 'Acme Corp',
    location: 'Gothenburg',
    description: 'Backend role',
    url: 'https://example.com/jobs/1',
    status: 'active',
    rawPayload: {},
    fetchedAt: new Date('2026-09-11T10:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  sqlite = openSqlite(':memory:');
  db = createKysely(sqlite);
  await runMigrations(db);
});

describe('runIngestion embedJob hook', () => {
  it('embeds each newly created job exactly once', async () => {
    const embedJob = vi.fn().mockResolvedValue(undefined);
    await runIngestion(db, [fakeAdapter([record()])], { embedJob });
    expect(embedJob).toHaveBeenCalledTimes(1);
    expect(embedJob.mock.calls[0][1]).toContain('Software Engineer');
  });

  it('skips embedding for unchanged records on a repeat run', async () => {
    const embedJob = vi.fn().mockResolvedValue(undefined);
    await runIngestion(db, [fakeAdapter([record()])], { embedJob });
    embedJob.mockClear();
    await runIngestion(db, [fakeAdapter([record()])], { embedJob });
    expect(embedJob).not.toHaveBeenCalled();
  });

  it('records a failure and continues the run when embedding throws', async () => {
    const embedJob = vi.fn().mockRejectedValue(new Error('ollama down'));
    const result = await runIngestion(db, [fakeAdapter([record()])], {
      embedJob,
    });
    expect(result.status).toBe('success');
    expect(result.counts.created).toBe(1);

    const row = await db
      .selectFrom('job_embeddings')
      .selectAll()
      .executeTakeFirst();
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('ollama down');
  });

  it('warns and continues when one connector fails to fetch, without failing the run', async () => {
    const brokenAdapter: SourceAdapter = {
      name: 'cinode',
      fetchJobs: () => Promise.reject(new Error('403 forbidden')),
    };
    const healthyAdapter: SourceAdapter = {
      name: 'greenhouse',
      fetchJobs: () => Promise.resolve([record({ sourceName: 'greenhouse' })]),
    };

    const result = await runIngestion(db, [brokenAdapter, healthyAdapter], {
      retries: 0,
    });

    expect(result.status).toBe('success');
    expect(result.counts.created).toBe(1);
    expect(result.warnings).toEqual(['cinode: 403 forbidden']);
  });

  it('falls back to the regex title check and keeps ingesting later adapters when isTitleInScope throws', async () => {
    const jobtech: SourceAdapter = {
      name: 'jobtech',
      fetchJobs: () =>
        Promise.resolve([record({ id: 'rec-jobtech', sourceName: 'jobtech' })]),
    };
    const greenhouse: SourceAdapter = {
      name: 'greenhouse',
      fetchJobs: () =>
        Promise.resolve([
          record({
            id: 'rec-greenhouse',
            sourceName: 'greenhouse',
            sourceJobId: 'job-2',
            company: 'Other Co',
            url: 'https://example.com/jobs/2',
          }),
        ]),
    };
    const isTitleInScope = vi
      .fn()
      .mockRejectedValueOnce(new Error('ollama down'))
      .mockResolvedValue(true);

    const result = await runIngestion(db, [jobtech, greenhouse], {
      isTitleInScope,
    });

    expect(result.status).toBe('success');
    expect(result.counts.created).toBe(2);
    expect(
      result.warnings.some((w) => w.includes('title scope check failed')),
    ).toBe(true);
  });
});
