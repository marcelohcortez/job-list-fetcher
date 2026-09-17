import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import type { JobDb } from '@job-fetcher/database';
import type { Kysely } from 'kysely';
import type { VectorStore } from '@job-fetcher/semantic-match';
import { createSkillCanonicalizer } from '../skill-taxonomy';

let sqlite: ReturnType<typeof openSqlite>;
let db: Kysely<JobDb>;

function fakeVectorStore(overrides: Partial<VectorStore> = {}): VectorStore {
  return {
    upsertJob: vi.fn(),
    deleteJob: vi.fn(),
    upsertCandidate: vi.fn(),
    deleteCandidate: vi.fn(),
    getCandidateEmbedding: vi.fn(),
    queryJobsForCandidate: vi.fn(),
    upsertRolePhrase: vi.fn(),
    queryNearestRolePhrase: vi.fn(),
    upsertSkill: vi.fn().mockResolvedValue(undefined),
    queryNearestSkill: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

beforeEach(async () => {
  sqlite = openSqlite(':memory:');
  db = createKysely(sqlite);
  await runMigrations(db);
});

describe('createSkillCanonicalizer', () => {
  it('mints a new canonical skill for a never-seen label', async () => {
    const vectorStore = fakeVectorStore();
    const embed = vi.fn().mockResolvedValue([0.1, 0.2]);
    const canonicalize = createSkillCanonicalizer(db, vectorStore, embed, 0.82);

    const ids = await canonicalize(['Kubernetes']);
    expect(ids).toHaveLength(1);
    expect(vectorStore.upsertSkill).toHaveBeenCalledWith(ids[0], [0.1, 0.2], 'kubernetes');
  });

  it('collapses pure formatting variants without an embedding round trip', async () => {
    const vectorStore = fakeVectorStore();
    const embed = vi.fn().mockResolvedValue([0.1, 0.2]);
    const canonicalize = createSkillCanonicalizer(db, vectorStore, embed, 0.82);

    const [firstId] = await canonicalize(['Front-End']);
    embed.mockClear();
    (vectorStore.upsertSkill as ReturnType<typeof vi.fn>).mockClear();

    const [secondId] = await canonicalize(['front end']);
    expect(secondId).toBe(firstId);
    expect(embed).not.toHaveBeenCalled();
    expect(vectorStore.upsertSkill).not.toHaveBeenCalled();
  });

  it('folds a near-variant or cross-language label into an existing skill via vector similarity', async () => {
    const vectorStore = fakeVectorStore({
      queryNearestSkill: vi.fn().mockResolvedValue({ id: 'seed-js', similarity: 0.9 }),
    });
    const embed = vi.fn().mockResolvedValue([0.3, 0.4]);
    const canonicalize = createSkillCanonicalizer(db, vectorStore, embed, 0.82);

    const ids = await canonicalize(['frontend-utveckling']);
    expect(ids).toEqual(['seed-js']);
    expect(vectorStore.upsertSkill).not.toHaveBeenCalled();
  });

  it('mints a new skill when the nearest match is below the similarity threshold', async () => {
    const vectorStore = fakeVectorStore({
      queryNearestSkill: vi.fn().mockResolvedValue({ id: 'seed-js', similarity: 0.4 }),
    });
    const embed = vi.fn().mockResolvedValue([0.5, 0.5]);
    const canonicalize = createSkillCanonicalizer(db, vectorStore, embed, 0.82);

    const ids = await canonicalize(['Underwater Basket Weaving']);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe('seed-js');
    expect(vectorStore.upsertSkill).toHaveBeenCalled();
  });

  it('de-duplicates ids across multiple raw skills that resolve to the same skill', async () => {
    const vectorStore = fakeVectorStore();
    const embed = vi.fn().mockResolvedValue([0.1, 0.2]);
    const canonicalize = createSkillCanonicalizer(db, vectorStore, embed, 0.82);

    const ids = await canonicalize(['React', 'react', 'React ']);
    expect(ids).toHaveLength(1);
  });

  it('skips blank skill strings', async () => {
    const vectorStore = fakeVectorStore();
    const embed = vi.fn().mockResolvedValue([0.1, 0.2]);
    const canonicalize = createSkillCanonicalizer(db, vectorStore, embed, 0.82);

    const ids = await canonicalize(['', '   ']);
    expect(ids).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
  });
});
