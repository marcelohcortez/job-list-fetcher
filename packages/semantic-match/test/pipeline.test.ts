import { describe, it, expect, vi } from 'vitest';
import {
  processJobOpening,
  processCandidate,
  matchJobsForCandidate,
} from '../src/pipeline';
import type { SanitizerClient } from '../src/ollama';
import type { VectorStore } from '../src/chroma';
import type { CvRefactorClient } from '../src/refactor';
import type { SemanticPipeline } from '../src/pipeline';

function fakeSanitizer(): SanitizerClient {
  return {
    sanitizeJob: vi.fn().mockResolvedValue({
      title: 'Backend Engineer',
      requiredSkills: ['Python'],
      softSkills: [],
      experienceProfile: '5 years',
      coreResponsibilities: ['build APIs'],
    }),
    sanitizeCandidate: vi.fn().mockResolvedValue({
      candidateName: 'Anna Andersson',
      title: 'Backend Engineer',
      requiredSkills: ['Python'],
      softSkills: [],
      experienceProfile: '5 years',
      coreResponsibilities: ['built APIs'],
    }),
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  };
}

function fakeCvRefactor(): CvRefactorClient {
  return {
    refactorCv: vi.fn().mockImplementation((text: string) => Promise.resolve(`refactored: ${text}`)),
  };
}

function fakeVectorStore(): VectorStore {
  return {
    upsertJob: vi.fn().mockResolvedValue(undefined),
    deleteJob: vi.fn().mockResolvedValue(undefined),
    upsertCandidate: vi.fn().mockResolvedValue(undefined),
    deleteCandidate: vi.fn().mockResolvedValue(undefined),
    getCandidateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    queryJobsForCandidate: vi
      .fn()
      .mockResolvedValue([{ id: 'job-1', similarity: 0.9 }]),
    upsertRolePhrase: vi.fn().mockResolvedValue(undefined),
    queryNearestRolePhrase: vi.fn().mockResolvedValue(null),
    upsertSkill: vi.fn().mockResolvedValue(undefined),
    queryNearestSkill: vi.fn().mockResolvedValue(null),
  };
}

describe('processJobOpening', () => {
  it('sanitizes, builds an anchor and upserts the embedding under the job id', async () => {
    const sanitizer = fakeSanitizer();
    const vectorStore = fakeVectorStore();
    const cvRefactor = fakeCvRefactor();
    const pipeline: SemanticPipeline = { sanitizer, vectorStore, cvRefactor };

    const result = await processJobOpening(pipeline, 'job-1', 'raw job text');

    expect(sanitizer.sanitizeJob).toHaveBeenCalledWith('raw job text');
    expect(result.anchorDocument).toContain('JOB TITLE: Backend Engineer');
    expect(vectorStore.upsertJob).toHaveBeenCalledWith(
      'job-1',
      [0.1, 0.2, 0.3],
      result.anchorDocument,
    );
  });
});

describe('processCandidate', () => {
  it('never embeds the candidate name', async () => {
    const sanitizer = fakeSanitizer();
    const vectorStore = fakeVectorStore();
    const cvRefactor = fakeCvRefactor();
    const pipeline: SemanticPipeline = { sanitizer, vectorStore, cvRefactor };

    const result = await processCandidate(pipeline, 'cand-1', 'raw cv text');

    expect(result.anchorDocument).not.toContain('Anna Andersson');
    expect(vectorStore.upsertCandidate).toHaveBeenCalledWith(
      'cand-1',
      [0.1, 0.2, 0.3],
      result.anchorDocument,
    );
  });

  it('refactors the CV before sanitizing', async () => {
    const sanitizer = fakeSanitizer();
    const vectorStore = fakeVectorStore();
    const cvRefactor = fakeCvRefactor();
    const pipeline: SemanticPipeline = { sanitizer, vectorStore, cvRefactor };

    await processCandidate(pipeline, 'cand-1', 'raw cv text');

    expect(cvRefactor.refactorCv).toHaveBeenCalledWith('raw cv text');
    expect(sanitizer.sanitizeCandidate).toHaveBeenCalledWith(
      'refactored: raw cv text',
    );
  });
});

describe('matchJobsForCandidate', () => {
  it('returns empty when the candidate has no stored embedding', async () => {
    const sanitizer = fakeSanitizer();
    const vectorStore = fakeVectorStore();
    const cvRefactor = fakeCvRefactor();
    vi.mocked(vectorStore.getCandidateEmbedding).mockResolvedValueOnce(null);
    const pipeline: SemanticPipeline = { sanitizer, vectorStore, cvRefactor };

    const matches = await matchJobsForCandidate(pipeline, 'cand-1', 10);
    expect(matches).toEqual([]);
  });

  it('queries the job collection with the candidate embedding', async () => {
    const sanitizer = fakeSanitizer();
    const vectorStore = fakeVectorStore();
    const cvRefactor = fakeCvRefactor();
    const pipeline: SemanticPipeline = { sanitizer, vectorStore, cvRefactor };

    const matches = await matchJobsForCandidate(pipeline, 'cand-1', 5);

    expect(vectorStore.queryJobsForCandidate).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      5,
    );
    expect(matches).toEqual([{ id: 'job-1', similarity: 0.9 }]);
  });
});
