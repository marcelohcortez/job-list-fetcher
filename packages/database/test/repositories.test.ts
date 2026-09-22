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
  insertCandidate,
  getCandidate,
  listCandidates,
  deleteCandidate,
  markCandidateSanitized,
  markCandidateFailed,
  toCandidateSummary,
} from '../src/repositories/candidates';
import {
  markJobSanitized,
  markJobEmbeddingFailed,
  getJobEmbeddingStatus,
} from '../src/repositories/job-embeddings';
import {
  setUserMark,
  setJobSeen,
  getUserMarks,
} from '../src/repositories/job-marks';
import {
  insertTargetRolePhraseIfNew,
  listTargetRolePhrases,
} from '../src/repositories/target-role-phrases';
import {
  insertSkillRelationIfNew,
  getSkillRelationsFor,
} from '../src/repositories/skill-relations';
import {
  insertSkillIfNew,
  findSkillByNormalizedLabel,
  replaceJobRequiredSkills,
  replaceCandidateSkills,
  getJobRequiredSkillIds,
  getCandidateSkillIds,
} from '../src/repositories/skills';
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

  it('updates a job in place when its title changes its canonical key', async () => {
    const first = await ingestSourceRecord(db, record());
    const updated = await ingestSourceRecord(
      db,
      record({ title: 'Senior Software Engineer' }),
    );

    expect(updated.jobOpeningId).toBe(first.jobOpeningId);
    expect(updated.created).toBe(false);
    expect(await countJobs(db)).toBe(1);
    expect((await getJobById(db, first.jobOpeningId))?.title).toBe(
      'Senior Software Engineer',
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

  it('keeps the original id when a second source lands on the same canonical job that already has a mark', async () => {
    const a = await ingestSourceRecord(
      db,
      record({ id: 'cinode-a', sourceName: 'cinode', sourceJobId: 'c1' }),
    );
    await setUserMark(db, a.jobOpeningId, 'applied');

    const b = await ingestSourceRecord(
      db,
      record({
        id: 'jobtech-b',
        sourceName: 'jobtech',
        sourceJobId: 'j1',
        location: 'Göteborg',
        url: 'https://example.com/jobtech/1',
      }),
    );

    expect(b.jobOpeningId).toBe(a.jobOpeningId);
    const marks = await getUserMarks(db, [a.jobOpeningId]);
    expect(marks[a.jobOpeningId].mark).toBe('applied');
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
      [jobOpeningId]: { mark: 'applied', seenAt: null },
    });

    await setUserMark(db, jobOpeningId, 'not_interested');
    expect(await getUserMarks(db, [jobOpeningId])).toEqual({
      [jobOpeningId]: { mark: 'not_interested', seenAt: null },
    });

    await setUserMark(db, jobOpeningId, null);
    expect(await getUserMarks(db, [jobOpeningId])).toEqual({});
  });

  it('tracks seen status independently from marks', async () => {
    const { jobOpeningId } = await ingestSourceRecord(db, record());

    await setJobSeen(db, jobOpeningId, true);
    const seenState = await getUserMarks(db, [jobOpeningId]);
    expect(seenState[jobOpeningId].mark).toBeNull();
    expect(seenState[jobOpeningId].seenAt).not.toBeNull();

    await setUserMark(db, jobOpeningId, 'applied');
    expect((await getUserMarks(db, [jobOpeningId]))[jobOpeningId].mark).toBe(
      'applied',
    );
    expect(
      (await getUserMarks(db, [jobOpeningId]))[jobOpeningId].seenAt,
    ).not.toBeNull();

    await setJobSeen(db, jobOpeningId, false);
    expect(
      (await getUserMarks(db, [jobOpeningId]))[jobOpeningId].seenAt,
    ).toBeNull();
    expect((await getUserMarks(db, [jobOpeningId]))[jobOpeningId].mark).toBe(
      'applied',
    );
  });

  it('inserts, sanitizes, lists and deletes candidates', async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45]); // %PDF-
    const created = await insertCandidate(db, {
      fileName: 'anna.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
      pdfBytes: pdf,
      extractedText: 'Anna Andersson, software developer',
    });
    expect(created.status).toBe('pending');

    const summary = toCandidateSummary(created);
    expect(summary.wordCount).toBe(4);
    expect(summary.fileName).toBe('anna.pdf');

    await markCandidateSanitized(db, created.id, {
      candidateName: 'Anna Andersson',
      candidateTitle: 'Software Developer',
      sanitizedJson: JSON.stringify({ title: 'Software Developer' }),
      anchorDocument: 'JOB TITLE: Software Developer',
      roleCategory: 'engineering',
      seniorityLevel: 'mid',
    });

    const sanitized = await getCandidate(db, created.id);
    expect(sanitized!.status).toBe('sanitized');
    expect(sanitized!.candidate_name).toBe('Anna Andersson');

    const all = await listCandidates(db);
    expect(all).toHaveLength(1);

    expect(await deleteCandidate(db, created.id)).toBe(true);
    expect(await getCandidate(db, created.id)).toBeUndefined();
  });

  it('marks a candidate as failed when sanitizing errors', async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 45]);
    const created = await insertCandidate(db, {
      fileName: 'broken.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
      pdfBytes: pdf,
      extractedText: 'garbled',
    });

    await markCandidateFailed(db, created.id, 'model returned invalid JSON');
    const failed = await getCandidate(db, created.id);
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toBe('model returned invalid JSON');
  });

  it('tracks job embedding status per job opening', async () => {
    const { jobOpeningId } = await ingestSourceRecord(db, record());

    expect(await getJobEmbeddingStatus(db, jobOpeningId)).toBeUndefined();

    await markJobSanitized(db, jobOpeningId, {
      sanitizedJson: JSON.stringify({ title: 'Software Engineer' }),
      anchorDocument: 'JOB TITLE: Software Engineer',
      roleCategory: 'engineering',
      seniorityLevel: 'mid',
    });
    const sanitized = await getJobEmbeddingStatus(db, jobOpeningId);
    expect(sanitized!.status).toBe('sanitized');

    await markJobEmbeddingFailed(db, jobOpeningId, 'ollama unreachable');
    const failed = await getJobEmbeddingStatus(db, jobOpeningId);
    expect(failed!.status).toBe('failed');
    expect(failed!.error).toBe('ollama unreachable');
  });

  it('inserts a target role phrase once and ignores repeat normalized phrases', async () => {
    const inserted = await insertTargetRolePhraseIfNew(db, {
      id: 'phrase-1',
      phrase: 'Software Engineer',
      normalizedPhrase: 'software engineer',
      source: 'seed',
      createdAt: '2026-09-11T10:00:00.000Z',
    });
    expect(inserted?.id).toBe('phrase-1');

    const duplicate = await insertTargetRolePhraseIfNew(db, {
      id: 'phrase-2',
      phrase: 'software engineer',
      normalizedPhrase: 'software engineer',
      source: 'learned',
      createdAt: '2026-09-11T11:00:00.000Z',
    });
    expect(duplicate).toBeNull();

    const rows = await listTargetRolePhrases(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('seed');
  });

  it('inserts a skill once and finds it by normalized label', async () => {
    const inserted = await insertSkillIfNew(db, {
      id: 'skill-1',
      canonicalLabel: 'Kubernetes',
      normalizedLabel: 'kubernetes',
      createdAt: '2026-09-11T10:00:00.000Z',
    });
    expect(inserted?.id).toBe('skill-1');

    const duplicate = await insertSkillIfNew(db, {
      id: 'skill-2',
      canonicalLabel: 'kubernetes',
      normalizedLabel: 'kubernetes',
      createdAt: '2026-09-11T11:00:00.000Z',
    });
    expect(duplicate).toBeNull();

    const found = await findSkillByNormalizedLabel(db, 'kubernetes');
    expect(found?.id).toBe('skill-1');
  });

  it('replaces a job opening required-skill set wholesale', async () => {
    await ingestSourceRecord(db, record());
    const jobs = await listJobs(db, {});
    const jobOpeningId = jobs[0].id;

    await insertSkillIfNew(db, {
      id: 'skill-python',
      canonicalLabel: 'Python',
      normalizedLabel: 'python',
      createdAt: '2026-09-11T10:00:00.000Z',
    });
    await insertSkillIfNew(db, {
      id: 'skill-go',
      canonicalLabel: 'Go',
      normalizedLabel: 'go',
      createdAt: '2026-09-11T10:00:00.000Z',
    });

    await replaceJobRequiredSkills(db, jobOpeningId, ['skill-python', 'skill-go']);
    expect(await getJobRequiredSkillIds(db, jobOpeningId)).toEqual(
      expect.arrayContaining(['skill-python', 'skill-go']),
    );

    await replaceJobRequiredSkills(db, jobOpeningId, ['skill-python']);
    expect(await getJobRequiredSkillIds(db, jobOpeningId)).toEqual(['skill-python']);
  });

  it('replaces a candidate skill set wholesale', async () => {
    const candidate = await insertCandidate(db, {
      fileName: 'cv.pdf',
      contentType: 'application/pdf',
      sizeBytes: 5,
      pdfBytes: new Uint8Array([1]),
      extractedText: 'text',
    });
    await insertSkillIfNew(db, {
      id: 'skill-react',
      canonicalLabel: 'React',
      normalizedLabel: 'react',
      createdAt: '2026-09-11T10:00:00.000Z',
    });

    await replaceCandidateSkills(db, candidate.id, ['skill-react']);
    expect(await getCandidateSkillIds(db, candidate.id)).toEqual(['skill-react']);

    await replaceCandidateSkills(db, candidate.id, []);
    expect(await getCandidateSkillIds(db, candidate.id)).toEqual([]);
  });

  it('inserts a skill relation once per direction and looks it up by either side', async () => {
    await insertSkillIfNew(db, {
      id: 'skill-stakeholder-mgmt',
      canonicalLabel: 'Stakeholder Management',
      normalizedLabel: 'stakeholder management',
      createdAt: '2026-09-16T10:00:00.000Z',
    });
    await insertSkillIfNew(db, {
      id: 'skill-customer-facing',
      canonicalLabel: 'Customer-facing Experience',
      normalizedLabel: 'customer facing experience',
      createdAt: '2026-09-16T10:00:00.000Z',
    });

    const inserted = await insertSkillRelationIfNew(db, {
      id: 'rel-1',
      skillIdA: 'skill-stakeholder-mgmt',
      skillIdB: 'skill-customer-facing',
      relationType: 'related',
      weight: 0.7,
      createdAt: '2026-09-16T10:00:00.000Z',
    });
    expect(inserted).toBe(true);

    const duplicate = await insertSkillRelationIfNew(db, {
      id: 'rel-1-dup',
      skillIdA: 'skill-stakeholder-mgmt',
      skillIdB: 'skill-customer-facing',
      relationType: 'related',
      weight: 0.9,
      createdAt: '2026-09-16T11:00:00.000Z',
    });
    expect(duplicate).toBe(false);

    const otherDirection = await insertSkillRelationIfNew(db, {
      id: 'rel-2',
      skillIdA: 'skill-customer-facing',
      skillIdB: 'skill-stakeholder-mgmt',
      relationType: 'related',
      weight: 0.7,
      createdAt: '2026-09-16T10:00:00.000Z',
    });
    expect(otherDirection).toBe(true);

    const forward = await getSkillRelationsFor(db, ['skill-stakeholder-mgmt']);
    expect(forward.get('skill-stakeholder-mgmt')).toEqual([
      { skillId: 'skill-customer-facing', weight: 0.7 },
    ]);

    const backward = await getSkillRelationsFor(db, ['skill-customer-facing']);
    expect(backward.get('skill-customer-facing')).toEqual([
      { skillId: 'skill-stakeholder-mgmt', weight: 0.7 },
    ]);

    expect(await getSkillRelationsFor(db, ['skill-unknown'])).toEqual(new Map());
    expect(await getSkillRelationsFor(db, [])).toEqual(new Map());
  });
});
