import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import type { JobDb } from '@job-fetcher/database';
import type { Kysely } from 'kysely';
import type { SourceAdapter } from '@job-fetcher/source-adapters';
import type { SourceRecord } from '@job-fetcher/domain';
import { createApp } from '../app';
import { runIngestion } from '../ingestion-runner';

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    async getText() {
      return {
        text: 'Anna Andersson Engineer. Backend Python TypeScript developer with Kubernetes and machine learning experience.',
      };
    }
    async destroy() {}
  },
}));

let sqlite: ReturnType<typeof openSqlite>;
let db: Kysely<JobDb>;

function fakeAdapter(records: SourceRecord[]): SourceAdapter {
  return {
    name: 'cinode',
    fetchJobs: () => Promise.resolve(records),
  };
}

function pipedPdf(): File {
  return new File(['%PDF-1.4 fake content'], 'anna-cv.pdf', {
    type: 'application/pdf',
  });
}

const matchingAdapter = fakeAdapter([
  {
    id: 'rec-1',
    sourceName: 'cinode',
    sourceJobId: 'job-1',
    title: 'Software Engineer',
    company: 'Acme Corp',
    location: 'Gothenburg',
    description:
      'Backend engineer with Python, TypeScript and Kubernetes, building machine learning pipelines.',
    url: 'https://example.com/jobs/1',
    status: 'active',
    rawPayload: {},
    fetchedAt: new Date('2026-09-11T10:00:00.000Z'),
  },
  {
    id: 'rec-2',
    sourceName: 'cinode',
    sourceJobId: 'job-2',
    title: 'Office Administrator',
    company: 'Acme Corp',
    location: 'Gothenburg',
    description: 'Administrative support and calendar management.',
    url: 'https://example.com/jobs/2',
    status: 'active',
    rawPayload: {},
    fetchedAt: new Date('2026-09-11T10:00:00.000Z'),
  },
]);

beforeEach(async () => {
  sqlite = openSqlite(':memory:');
  db = createKysely(sqlite);
  await runMigrations(db);
});

describe('POST /cv', () => {
  it('rejects uploads without a file', async () => {
    const app = createApp(db, [matchingAdapter]);
    const form = new FormData();
    const res = await app.request('/cv', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('missing_file');
  });

  it('rejects non-PDF files', async () => {
    const app = createApp(db, [matchingAdapter]);
    const form = new FormData();
    form.append('cv', new File(['hello'], 'cv.txt', { type: 'text/plain' }));
    const res = await app.request('/cv', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_type');
  });

  it('stores the CV and serves matches without touching the main list', async () => {
    await runIngestion(db, [matchingAdapter]);
    const app = createApp(db, [matchingAdapter]);

    const form = new FormData();
    form.append('cv', pipedPdf());
    const upload = await app.request('/cv', { method: 'POST', body: form });
    expect(upload.status).toBe(200);
    const uploaded = await upload.json();
    expect(uploaded.data.fileName).toBe('anna-cv.pdf');
    expect(uploaded.data.wordCount).toBeGreaterThan(0);

    const profile = await (await app.request('/cv')).json();
    expect(profile.data.fileName).toBe('anna-cv.pdf');

    const main = await (await app.request('/jobs')).json();
    expect(main.count).toBe(1);
    expect(main.data[0].title).toBe('Software Engineer');

    const matches = await (await app.request('/cv/matches')).json();
    expect(matches.count).toBe(1);
    expect(matches.data[0].title).toBe('Software Engineer');
    expect(matches.data[0].match.score).toBeGreaterThan(0);
    expect(matches.data[0].match.matchedTerms).toContain('python');

    const removed = await app.request('/cv', { method: 'DELETE' });
    expect(removed.status).toBe(200);
    const after = await app.request('/cv');
    expect(after.status).toBe(404);
  });

  it('returns 404 for matches before a CV exists', async () => {
    const app = createApp(db, [matchingAdapter]);
    const res = await app.request('/cv/matches');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('no_cv');
  });
});
