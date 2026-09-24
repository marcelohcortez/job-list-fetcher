import { describe, it, expect, beforeEach } from 'vitest';
import { createKysely, runMigrations, openSqlite } from '../src/db';
import type { Kysely } from 'kysely';
import type { JobDb } from '../src/schema';
import { ingestSourceRecord } from '../src/repositories/jobs';
import { insertCandidate } from '../src/repositories/candidates';
import {
  upsertLayaEvaluation,
  getLayaEvaluationsForCandidate,
} from '../src/repositories/laya-evaluations';

let sqlite: ReturnType<typeof openSqlite>;
let db: Kysely<JobDb>;

beforeEach(async () => {
  sqlite = openSqlite(':memory:');
  db = createKysely(sqlite);
  await runMigrations(db);
});

async function seedJob(id: string) {
  await ingestSourceRecord(db, {
    id,
    sourceName: 'cinode',
    sourceJobId: id,
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'Remote',
    description: null,
    url: `https://example.com/${id}`,
    status: 'active',
    rawPayload: {},
    fetchedAt: new Date(),
  });
  const jobs = await db.selectFrom('job_openings').select('id').execute();
  return jobs[jobs.length - 1].id;
}

describe('laya-evaluations repository', () => {
  it('upserts and reads back a pair, scoped per candidate', async () => {
    const jobOpeningId = await seedJob('rec-1');
    const candidate = await insertCandidate(db, {
      fileName: 'cv.pdf',
      contentType: 'application/pdf',
      sizeBytes: 5,
      pdfBytes: new Uint8Array([1]),
      extractedText: 'text',
    });

    await upsertLayaEvaluation(db, {
      jobOpeningId,
      candidateId: candidate.id,
      score: 0.72,
      choice: 'moderate',
      reasoning: 'Solid backend overlap.',
      mismatchReasoning: 'Missing cloud experience.',
    });

    const evaluations = await getLayaEvaluationsForCandidate(db, candidate.id, [jobOpeningId]);
    expect(evaluations.get(jobOpeningId)).toEqual({
      score: 0.72,
      choice: 'moderate',
      reasoning: 'Solid backend overlap.',
      mismatchReasoning: 'Missing cloud experience.',
    });
  });

  it('overwrites an existing evaluation for the same pair on re-evaluation', async () => {
    const jobOpeningId = await seedJob('rec-2');
    const candidate = await insertCandidate(db, {
      fileName: 'cv2.pdf',
      contentType: 'application/pdf',
      sizeBytes: 5,
      pdfBytes: new Uint8Array([1]),
      extractedText: 'text',
    });

    await upsertLayaEvaluation(db, {
      jobOpeningId,
      candidateId: candidate.id,
      score: 0.2,
      choice: 'weak',
      reasoning: 'first pass',
    });
    await upsertLayaEvaluation(db, {
      jobOpeningId,
      candidateId: candidate.id,
      score: 0.9,
      choice: 'strong',
      reasoning: 're-evaluated',
    });

    const evaluations = await getLayaEvaluationsForCandidate(db, candidate.id, [jobOpeningId]);
    expect(evaluations.get(jobOpeningId)?.choice).toBe('strong');
    expect(evaluations.get(jobOpeningId)?.score).toBe(0.9);
  });

  it('returns an empty map for a candidate with no evaluations', async () => {
    const jobOpeningId = await seedJob('rec-3');
    const evaluations = await getLayaEvaluationsForCandidate(db, 'no-such-candidate', [jobOpeningId]);
    expect(evaluations.size).toBe(0);
  });
});
