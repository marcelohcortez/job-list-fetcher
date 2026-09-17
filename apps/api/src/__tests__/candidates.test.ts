import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import type { JobDb } from '@job-fetcher/database';
import type { Kysely } from 'kysely';
import type { SemanticPipeline } from '@job-fetcher/semantic-match';
import { createApp } from '../app';

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    async getText() {
      return {
        text: 'Anna Andersson. Backend Python TypeScript developer with Kubernetes experience.',
      };
    }
    async destroy() {}
  },
}));

let sqlite: ReturnType<typeof openSqlite>;
let db: Kysely<JobDb>;

function pdfFile(name = 'anna.pdf'): File {
  return new File(['%PDF-1.4 fake content'], name, {
    type: 'application/pdf',
  });
}

function fakeSemantic(overrides: Partial<SemanticPipeline> = {}): SemanticPipeline {
  return {
    sanitizer: {
      sanitizeJob: vi.fn(),
      sanitizeCandidate: vi.fn().mockResolvedValue({
        candidateName: 'Anna Andersson',
        title: 'Backend Developer',
        requiredSkills: ['Python', 'TypeScript', 'Kubernetes'],
        softSkills: [],
        experienceProfile: '5 years',
        coreResponsibilities: ['built backend services'],
      }),
      embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    },
    vectorStore: {
      upsertJob: vi.fn().mockResolvedValue(undefined),
      deleteJob: vi.fn().mockResolvedValue(undefined),
      upsertCandidate: vi.fn().mockResolvedValue(undefined),
      deleteCandidate: vi.fn().mockResolvedValue(undefined),
      getCandidateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
      queryJobsForCandidate: vi.fn().mockResolvedValue([]),
      upsertRolePhrase: vi.fn().mockResolvedValue(undefined),
      queryNearestRolePhrase: vi.fn().mockResolvedValue(null),
      upsertSkill: vi.fn().mockResolvedValue(undefined),
      queryNearestSkill: vi.fn().mockResolvedValue(null),
    },
    cvRefactor: {
      refactorCv: vi.fn().mockImplementation((text: string) => Promise.resolve(text)),
    },
    ...overrides,
  };
}

function testApp(semantic: SemanticPipeline) {
  return createApp(db, [], semantic, { topK: 10, minSimilarity: 0.5 });
}

beforeEach(async () => {
  sqlite = openSqlite(':memory:');
  db = createKysely(sqlite);
  await runMigrations(db);
});

describe('POST /candidates', () => {
  it('uploads, sanitizes and stores a single candidate', async () => {
    const semantic = fakeSemantic();
    const app = testApp(semantic);

    const form = new FormData();
    form.append('file', pdfFile());
    const res = await app.request('/api/candidates', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('sanitized');
    expect(body.data.candidateName).toBe('Anna Andersson');
    expect(semantic.vectorStore.upsertCandidate).toHaveBeenCalled();
  });

  it('marks the candidate failed when sanitizing throws, without crashing the request', async () => {
    const semantic = fakeSemantic({
      sanitizer: {
        sanitizeJob: vi.fn(),
        sanitizeCandidate: vi.fn().mockRejectedValue(new Error('model down')),
        embed: vi.fn(),
      },
    });
    const app = testApp(semantic);

    const form = new FormData();
    form.append('file', pdfFile());
    const res = await app.request('/api/candidates', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('failed');
  });

  it('rejects non-PDF uploads', async () => {
    const app = testApp(fakeSemantic());
    const form = new FormData();
    form.append(
      'file',
      new File(['not a pdf'], 'notes.txt', { type: 'text/plain' }),
    );
    const res = await app.request('/api/candidates', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });
});

describe('POST /candidates/batch', () => {
  it('uploads multiple candidates sequentially', async () => {
    const semantic = fakeSemantic();
    const app = testApp(semantic);

    const form = new FormData();
    form.append('files', pdfFile('one.pdf'));
    form.append('files', pdfFile('two.pdf'));
    const res = await app.request('/api/candidates/batch', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.every((r: { data?: unknown }) => r.data)).toBe(true);

    const list = await (await app.request('/api/candidates')).json();
    expect(list.data).toHaveLength(2);
  });
});

describe('duplicate candidate names', () => {
  it('flags the second CV with the same name as a duplicate instead of a second sanitized profile', async () => {
    const semantic = fakeSemantic();
    const app = testApp(semantic);

    const form1 = new FormData();
    form1.append('file', pdfFile('anna-1.pdf'));
    const first = await (
      await app.request('/api/candidates', { method: 'POST', body: form1 })
    ).json();
    expect(first.data.status).toBe('sanitized');

    const form2 = new FormData();
    form2.append('file', pdfFile('anna-2.pdf'));
    const second = await (
      await app.request('/api/candidates', { method: 'POST', body: form2 })
    ).json();
    expect(second.data.status).toBe('duplicate');
    expect(second.data.duplicateOfId).toBe(first.data.id);
  });

  it('resolves a duplicate by ignoring the new upload', async () => {
    const semantic = fakeSemantic();
    const app = testApp(semantic);

    const form1 = new FormData();
    form1.append('file', pdfFile('anna-1.pdf'));
    const first = await (
      await app.request('/api/candidates', { method: 'POST', body: form1 })
    ).json();

    const form2 = new FormData();
    form2.append('file', pdfFile('anna-2.pdf'));
    const second = await (
      await app.request('/api/candidates', { method: 'POST', body: form2 })
    ).json();

    const res = await app.request(
      `/api/candidates/${second.data.id}/resolve-duplicate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ignore' }),
      },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).data.deleted).toBe(second.data.id);

    const list = await (await app.request('/api/candidates')).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].id).toBe(first.data.id);
  });

  it('resolves a duplicate by replacing the existing candidate', async () => {
    const semantic = fakeSemantic();
    const app = testApp(semantic);

    const form1 = new FormData();
    form1.append('file', pdfFile('anna-1.pdf'));
    const first = await (
      await app.request('/api/candidates', { method: 'POST', body: form1 })
    ).json();

    const form2 = new FormData();
    form2.append('file', pdfFile('anna-2.pdf'));
    const second = await (
      await app.request('/api/candidates', { method: 'POST', body: form2 })
    ).json();

    const res = await app.request(
      `/api/candidates/${second.data.id}/resolve-duplicate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'replace' }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(second.data.id);
    expect(body.data.status).toBe('sanitized');
    expect(semantic.vectorStore.deleteCandidate).toHaveBeenCalledWith(
      first.data.id,
    );

    const list = await (await app.request('/api/candidates')).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].id).toBe(second.data.id);
  });
});

describe('DELETE /candidates/:id', () => {
  it('deletes the row and the vector store entry', async () => {
    const semantic = fakeSemantic();
    const app = testApp(semantic);
    const form = new FormData();
    form.append('file', pdfFile());
    const created = await (
      await app.request('/api/candidates', { method: 'POST', body: form })
    ).json();

    const res = await app.request(`/api/candidates/${created.data.id}`, {
      method: 'DELETE',
    });
    expect((await res.json()).data.deleted).toBe(true);
    expect(semantic.vectorStore.deleteCandidate).toHaveBeenCalledWith(
      created.data.id,
    );
  });
});
