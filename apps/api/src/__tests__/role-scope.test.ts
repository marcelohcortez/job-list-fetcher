import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createKysely, openSqlite, runMigrations, listTargetRolePhrases } from '@job-fetcher/database';
import type { JobDb } from '@job-fetcher/database';
import type { Kysely } from 'kysely';
import type { VectorStore } from '@job-fetcher/semantic-match';
import { seedTargetRolePhrases, createTitleScopeChecker } from '../role-scope';

let sqlite: ReturnType<typeof openSqlite>;
let db: Kysely<JobDb>;

function fakeVectorStore(
  overrides: Partial<VectorStore> = {},
): VectorStore {
  return {
    upsertJob: vi.fn(),
    deleteJob: vi.fn(),
    upsertCandidate: vi.fn(),
    deleteCandidate: vi.fn(),
    getCandidateEmbedding: vi.fn(),
    queryJobsForCandidate: vi.fn(),
    upsertRolePhrase: vi.fn().mockResolvedValue(undefined),
    queryNearestRolePhrase: vi.fn().mockResolvedValue(null),
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

describe('seedTargetRolePhrases', () => {
  it('embeds and stores every TARGET_ROLES entry exactly once, and is idempotent', async () => {
    const vectorStore = fakeVectorStore();
    const embed = vi.fn().mockResolvedValue([0.1, 0.2]);

    await seedTargetRolePhrases(db, vectorStore, embed);
    const rows = await listTargetRolePhrases(db);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.source === 'seed')).toBe(true);
    expect(vectorStore.upsertRolePhrase).toHaveBeenCalledTimes(rows.length);

    embed.mockClear();
    (vectorStore.upsertRolePhrase as ReturnType<typeof vi.fn>).mockClear();
    await seedTargetRolePhrases(db, vectorStore, embed);
    expect(embed).not.toHaveBeenCalled();
    expect(vectorStore.upsertRolePhrase).not.toHaveBeenCalled();
  });
});

describe('createTitleScopeChecker', () => {
  it('accepts an exact TARGET_ROLES match without touching the vector store', async () => {
    const vectorStore = fakeVectorStore();
    const embed = vi.fn();
    const isTitleInScope = createTitleScopeChecker(db, vectorStore, embed, 0.85);

    expect(await isTitleInScope('Software Engineer')).toBe(true);
    expect(embed).not.toHaveBeenCalled();
  });

  it('accepts a near-variant title via vector similarity and learns it', async () => {
    const vectorStore = fakeVectorStore({
      queryNearestRolePhrase: vi.fn().mockResolvedValue({ id: 'seed-1', similarity: 0.9 }),
    });
    const embed = vi.fn().mockResolvedValue([0.3, 0.4]);
    const isTitleInScope = createTitleScopeChecker(db, vectorStore, embed, 0.85);

    const result = await isTitleInScope('Senior Fullstack Engineer II');
    expect(result).toBe(true);
    expect(vectorStore.upsertRolePhrase).toHaveBeenCalledWith(
      expect.any(String),
      [0.3, 0.4],
      'Senior Fullstack Engineer II',
    );

    const rows = await listTargetRolePhrases(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('learned');
  });

  it('rejects a title whose nearest phrase is below the similarity threshold', async () => {
    const vectorStore = fakeVectorStore({
      queryNearestRolePhrase: vi.fn().mockResolvedValue({ id: 'seed-1', similarity: 0.4 }),
    });
    const embed = vi.fn().mockResolvedValue([0.1, 0.1]);
    const isTitleInScope = createTitleScopeChecker(db, vectorStore, embed, 0.85);

    expect(await isTitleInScope('Warehouse Operative')).toBe(false);
    expect(vectorStore.upsertRolePhrase).not.toHaveBeenCalled();
  });

  it('does not double-learn a title whose normalized phrase is already known', async () => {
    const vectorStore = fakeVectorStore({
      queryNearestRolePhrase: vi.fn().mockResolvedValue({ id: 'seed-1', similarity: 0.9 }),
    });
    const embed = vi.fn().mockResolvedValue([0.5, 0.5]);
    const isTitleInScope = createTitleScopeChecker(db, vectorStore, embed, 0.85);

    await isTitleInScope('Senior Fullstack Engineer II');
    (vectorStore.upsertRolePhrase as ReturnType<typeof vi.fn>).mockClear();

    const again = await isTitleInScope('  senior   fullstack engineer II ');
    expect(again).toBe(true);
    expect(vectorStore.upsertRolePhrase).not.toHaveBeenCalled();
  });
});
