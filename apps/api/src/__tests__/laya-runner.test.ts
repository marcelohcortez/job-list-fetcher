import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createKysely,
  insertCandidate,
  markCandidateSanitized,
  markJobSanitized,
  openSqlite,
  runMigrations,
} from '@job-fetcher/database';
import type { JobDb } from '@job-fetcher/database';
import type { Kysely } from 'kysely';
import type { LayaClient, SemanticPipeline } from '@job-fetcher/semantic-match';
import { evaluateLayaForNewCandidate, evaluateLayaForNewJob } from '../laya-runner';
import { runIngestion } from '../ingestion-runner';

let db: Kysely<JobDb>;

async function addCandidate(name: string, roleCategory: string | null) {
  const candidate = await insertCandidate(db, {
    fileName: `${name}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: 5,
    pdfBytes: new Uint8Array([1]),
    extractedText: 'text',
  });
  await markCandidateSanitized(db, candidate.id, {
    candidateName: name,
    candidateTitle: name,
    sanitizedJson: '{}',
    anchorDocument: `CV ${name}`,
    roleCategory,
    seniorityLevel: null,
  });
  return candidate.id;
}

function pipelineWith(jobIds: string[], candidateIds: string[]): SemanticPipeline {
  return {
    vectorStore: {
      getCandidateEmbedding: vi.fn().mockResolvedValue([0.1]),
      getJobEmbedding: vi.fn().mockResolvedValue([0.1]),
      queryJobsForCandidate: vi.fn().mockResolvedValue(jobIds.map((id) => ({ id, similarity: 0.5 }))),
      queryCandidatesForJob: vi.fn().mockResolvedValue(candidateIds.map((id) => ({ id, similarity: 0.5 }))),
    },
  } as unknown as SemanticPipeline;
}

const evaluation = {
  score: 0.9,
  choice: 'strong' as const,
  reasoning: 'r',
  mismatchReasoning: 'm',
  truncated: false,
};

beforeEach(async () => {
  db = createKysely(openSqlite(':memory:'));
  await runMigrations(db);
});

describe('laya-runner role-category gate', () => {
  it('skips incompatible pairs for a new job but evaluates compatible and unknown ones', async () => {
    await runIngestion(db, [
      {
        name: 'cinode',
        fetchJobs: () =>
          Promise.resolve([
            {
              id: 'rec-1',
              sourceName: 'cinode',
              sourceJobId: 'job-1',
              title: 'Software Engineer',
              company: 'Acme',
              location: 'Gothenburg',
              description: 'Backend',
              url: 'https://example.com/1',
              status: 'active',
              rawPayload: {},
              fetchedAt: new Date('2026-09-11T10:00:00.000Z'),
            },
          ]),
      },
    ]);
    const jobId = (await db.selectFrom('job_openings').select('id').executeTakeFirstOrThrow()).id;
    await markJobSanitized(db, jobId, {
      sanitizedJson: '{}',
      anchorDocument: 'JOB',
      roleCategory: 'engineering',
      seniorityLevel: null,
    });
    const designer = await addCandidate('Designer', 'design');
    const engineer = await addCandidate('Engineer', 'engineering');
    const unknown = await addCandidate('Unknown', null);

    const evaluate = vi.fn().mockResolvedValue(evaluation);
    const client = { evaluate } as unknown as LayaClient;

    await evaluateLayaForNewJob(db, pipelineWith([], [designer, engineer, unknown]), client, jobId, 'JOB', 10);

    const evaluated = (await db.selectFrom('laya_evaluations').select('candidate_id').execute()).map(
      (row) => row.candidate_id,
    );
    expect(evaluated.sort()).toEqual([engineer, unknown].sort());
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluated).not.toContain(designer);
  });

  it('skips incompatible pairs for a new candidate', async () => {
    const designer = await addCandidate('Designer', 'design');
    await runIngestion(db, [
      {
        name: 'cinode',
        fetchJobs: () =>
          Promise.resolve(
            ['a', 'b'].map((key) => ({
              id: `rec-${key}`,
              sourceName: 'cinode' as const,
              sourceJobId: `job-${key}`,
              title: key === 'a' ? 'Software Engineer' : 'Backend Developer',
              company: 'Acme',
              location: 'Gothenburg',
              description: 'x',
              url: `https://example.com/${key}`,
              status: 'active' as const,
              rawPayload: {},
              fetchedAt: new Date('2026-09-11T10:00:00.000Z'),
            })),
          ),
      },
    ]);
    const jobs = await db.selectFrom('job_openings').select(['id', 'title']).execute();
    const engineeringJob = jobs.find((job) => job.title === 'Software Engineer')!.id;
    const designJob = jobs.find((job) => job.title === 'Backend Developer')!.id;
    await markJobSanitized(db, engineeringJob, {
      sanitizedJson: '{}',
      anchorDocument: 'JOB A',
      roleCategory: 'engineering',
      seniorityLevel: null,
    });
    await markJobSanitized(db, designJob, {
      sanitizedJson: '{}',
      anchorDocument: 'JOB B',
      roleCategory: 'design',
      seniorityLevel: null,
    });

    const evaluate = vi.fn().mockResolvedValue(evaluation);
    const client = { evaluate } as unknown as LayaClient;

    await evaluateLayaForNewCandidate(db, pipelineWith([engineeringJob, designJob], []), client, designer, 'CV', 10);

    const evaluated = (await db.selectFrom('laya_evaluations').select('job_opening_id').execute()).map(
      (row) => row.job_opening_id,
    );
    expect(evaluated).toEqual([designJob]);
  });
});
