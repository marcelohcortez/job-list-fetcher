import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import {
  insertCandidate,
  insertSkillIfNew,
  insertSkillRelationIfNew,
  markCandidateSanitized,
  markJobSanitized,
  replaceCandidateSkills,
  replaceJobRequiredSkills,
} from '@job-fetcher/database';
import type { JobDb } from '@job-fetcher/database';
import type { Kysely } from 'kysely';
import type { SourceAdapter } from '@job-fetcher/source-adapters';
import type { SourceRecord } from '@job-fetcher/domain';
import type { SemanticPipeline } from '@job-fetcher/semantic-match';
import { createApp } from '../app';
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

async function addSanitizedCandidate(
  name: string,
  roleCategory: string | null = null,
  seniorityLevel: string | null = null,
) {
  const candidate = await insertCandidate(db, {
    fileName: `${name}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: 5,
    pdfBytes: new Uint8Array([1]),
    extractedText: 'text',
  });
  await markCandidateSanitized(db, candidate.id, {
    candidateName: name,
    sanitizedJson: '{}',
    anchorDocument: 'JOB TITLE: Backend Developer',
    roleCategory,
    seniorityLevel,
  });
  return candidate.id;
}

beforeEach(async () => {
  sqlite = openSqlite(':memory:');
  db = createKysely(sqlite);
  await runMigrations(db);
});

describe('GET /matches', () => {
  it('returns ranked, similarity-filtered matches per sanitized candidate', async () => {
    const { jobOpeningId } = await (async () => {
      await runIngestion(db, [fakeAdapter([record()])]);
      const jobs = await db.selectFrom('job_openings').select('id').execute();
      return { jobOpeningId: jobs[0].id };
    })();
    expect(jobOpeningId).toBeTruthy();

    const candidateId = await addSanitizedCandidate('Anna Andersson');

    const semantic: SemanticPipeline = {
      sanitizer: {
        sanitizeJob: vi.fn(),
        sanitizeCandidate: vi.fn(),
        embed: vi.fn(),
      },
      vectorStore: {
        upsertJob: vi.fn(),
        deleteJob: vi.fn(),
        upsertCandidate: vi.fn(),
        deleteCandidate: vi.fn(),
        getCandidateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
        queryJobsForCandidate: vi
          .fn()
          .mockResolvedValue([
            { id: jobOpeningId, similarity: 0.87 },
            { id: 'unknown-job', similarity: 0.2 },
          ]),
        upsertRolePhrase: vi.fn(),
        queryNearestRolePhrase: vi.fn(),
        upsertSkill: vi.fn(),
        queryNearestSkill: vi.fn(),
      },
      cvRefactor: {
        refactorCv: vi.fn(),
      },
    };

    const app = createApp(db, [], semantic, { topK: 10, minSimilarity: 0.5 });
    const res = await app.request('/api/matches');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].candidateId).toBe(candidateId);
    expect(body.data[0].candidateName).toBe('Anna Andersson');
    // below-threshold and unknown-job hits are filtered out
    expect(body.data[0].matches).toHaveLength(1);
    // no required skills were extracted for this job, so score falls back
    // to semantic similarity, discounted by the default
    // NO_REQUIRED_SKILLS_PENALTY (0.75): 0.87 * 0.75 = 0.6525
    expect(body.data[0].matches[0].similarity).toBeCloseTo(0.6525);
    expect(body.data[0].matches[0].semanticSimilarity).toBe(0.87);
    expect(body.data[0].matches[0].skillCoverage).toBeNull();
    expect(body.data[0].matches[0].title).toBe('Software Engineer');
  });

  it('weighs required-skill coverage over raw embedding similarity', async () => {
    await runIngestion(db, [fakeAdapter([record()])]);
    const jobs = await db.selectFrom('job_openings').select('id').execute();
    const jobOpeningId = jobs[0].id;

    const candidateId = await addSanitizedCandidate('Erik Eriksson');

    const pythonSkill = await insertSkillIfNew(db, {
      id: 'skill-python',
      canonicalLabel: 'Python',
      normalizedLabel: 'python',
      createdAt: new Date().toISOString(),
    });
    const securitySkill = await insertSkillIfNew(db, {
      id: 'skill-security',
      canonicalLabel: 'Application Security',
      normalizedLabel: 'application security',
      createdAt: new Date().toISOString(),
    });
    expect(pythonSkill && securitySkill).toBeTruthy();

    // Job requires both skills; candidate only has one - a high whole-doc
    // similarity (generic IT vocabulary overlap) must not paper over that.
    await replaceJobRequiredSkills(db, jobOpeningId, ['skill-python', 'skill-security']);
    await replaceCandidateSkills(db, candidateId, ['skill-python']);

    const semantic: SemanticPipeline = {
      sanitizer: { sanitizeJob: vi.fn(), sanitizeCandidate: vi.fn(), embed: vi.fn() },
      vectorStore: {
        upsertJob: vi.fn(),
        deleteJob: vi.fn(),
        upsertCandidate: vi.fn(),
        deleteCandidate: vi.fn(),
        getCandidateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
        queryJobsForCandidate: vi
          .fn()
          .mockResolvedValue([{ id: jobOpeningId, similarity: 0.8 }]),
        upsertRolePhrase: vi.fn(),
        queryNearestRolePhrase: vi.fn(),
        upsertSkill: vi.fn(),
        queryNearestSkill: vi.fn(),
      },
      cvRefactor: {
        refactorCv: vi.fn(),
      },
    };

    const app = createApp(db, [], semantic, {
      topK: 10,
      minSimilarity: 0,
      skillOverlapWeight: 0.6,
    });
    const body = await (await app.request('/api/matches')).json();

    const match = body.data[0].matches[0];
    // skillCoverage = 1/2, semanticSimilarity = 0.8. Only 2 of the default
    // MIN_SKILLS_FOR_FULL_CONFIDENCE (3) required skills are present, so
    // skillOverlapWeight is dampened to 0.6 * (2/3) = 0.4 before blending:
    // score = 0.4 * 0.5 + 0.6 * 0.8 = 0.68
    expect(match.skillCoverage).toBeCloseTo(0.5);
    expect(match.matchedSkillCount).toBe(1);
    expect(match.requiredSkillCount).toBe(2);
    expect(match.semanticSimilarity).toBe(0.8);
    expect(match.similarity).toBeCloseTo(0.68);
  });

  it('credits a curated skill relation when there is no exact match', async () => {
    await runIngestion(db, [fakeAdapter([record()])]);
    const jobs = await db.selectFrom('job_openings').select('id').execute();
    const jobOpeningId = jobs[0].id;

    const candidateId = await addSanitizedCandidate('Priya Patel');

    await insertSkillIfNew(db, {
      id: 'skill-customer-facing',
      canonicalLabel: 'Customer-facing Experience',
      normalizedLabel: 'customer facing experience',
      createdAt: new Date().toISOString(),
    });
    await insertSkillIfNew(db, {
      id: 'skill-stakeholder-mgmt',
      canonicalLabel: 'Stakeholder Management',
      normalizedLabel: 'stakeholder management',
      createdAt: new Date().toISOString(),
    });
    await insertSkillIfNew(db, {
      id: 'skill-kubernetes',
      canonicalLabel: 'Kubernetes',
      normalizedLabel: 'kubernetes',
      createdAt: new Date().toISOString(),
    });
    await insertSkillRelationIfNew(db, {
      id: 'rel-1',
      skillIdA: 'skill-customer-facing',
      skillIdB: 'skill-stakeholder-mgmt',
      relationType: 'related',
      weight: 0.7,
      createdAt: new Date().toISOString(),
    });

    // Job requires "Customer-facing Experience" (no exact match) and
    // "Kubernetes" (also no match, and no curated relation to it either).
    await replaceJobRequiredSkills(db, jobOpeningId, [
      'skill-customer-facing',
      'skill-kubernetes',
    ]);
    await replaceCandidateSkills(db, candidateId, ['skill-stakeholder-mgmt']);

    const semantic: SemanticPipeline = {
      sanitizer: { sanitizeJob: vi.fn(), sanitizeCandidate: vi.fn(), embed: vi.fn() },
      vectorStore: {
        upsertJob: vi.fn(),
        deleteJob: vi.fn(),
        upsertCandidate: vi.fn(),
        deleteCandidate: vi.fn(),
        getCandidateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
        queryJobsForCandidate: vi
          .fn()
          .mockResolvedValue([{ id: jobOpeningId, similarity: 0.8 }]),
        upsertRolePhrase: vi.fn(),
        queryNearestRolePhrase: vi.fn(),
        upsertSkill: vi.fn(),
        queryNearestSkill: vi.fn(),
      },
      cvRefactor: {
        refactorCv: vi.fn(),
      },
    };

    const app = createApp(db, [], semantic, {
      topK: 10,
      minSimilarity: 0,
      skillOverlapWeight: 0.6,
    });
    const body = await (await app.request('/api/matches')).json();

    const match = body.data[0].matches[0];
    // "Customer-facing Experience" credited at 0.7 (related), "Kubernetes"
    // at 0 -> skillCoverage = 0.7/2 = 0.35. Only 2 of the default
    // MIN_SKILLS_FOR_FULL_CONFIDENCE (3) required skills are present, so
    // skillOverlapWeight is dampened to 0.6 * (2/3) = 0.4 before blending:
    // score = 0.4*0.35 + 0.6*0.8 = 0.62
    expect(match.skillCoverage).toBeCloseTo(0.35);
    expect(match.matchedSkillCount).toBe(1);
    expect(match.matchedSkills).toEqual(['Customer-facing Experience']);
    expect(match.missingSkills).toEqual(['Kubernetes']);
    expect(match.similarity).toBeCloseTo(0.62);
  });

  it('penalizes a role-category mismatch (Designer CV vs Product Manager job)', async () => {
    await runIngestion(db, [fakeAdapter([record({ title: 'AI Product Manager' })])]);
    const jobs = await db.selectFrom('job_openings').select('id').execute();
    const jobOpeningId = jobs[0].id;
    await markJobSanitized(db, jobOpeningId, {
      sanitizedJson: JSON.stringify({ title: 'AI Product Manager' }),
      anchorDocument: 'JOB TITLE: AI Product Manager',
      roleCategory: 'product-management',
      seniorityLevel: null,
    });

    const candidateId = await addSanitizedCandidate('Alexander Zakabluk', 'design');

    const semantic: SemanticPipeline = {
      sanitizer: { sanitizeJob: vi.fn(), sanitizeCandidate: vi.fn(), embed: vi.fn() },
      vectorStore: {
        upsertJob: vi.fn(),
        deleteJob: vi.fn(),
        upsertCandidate: vi.fn(),
        deleteCandidate: vi.fn(),
        getCandidateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
        // High raw similarity on shared generic vocabulary alone, and no
        // discrete required skills extracted for this job - exactly the
        // reported failure mode (ADR 0012).
        queryJobsForCandidate: vi.fn().mockResolvedValue([{ id: jobOpeningId, similarity: 0.75 }]),
        upsertRolePhrase: vi.fn(),
        queryNearestRolePhrase: vi.fn(),
        upsertSkill: vi.fn(),
        queryNearestSkill: vi.fn(),
      },
      cvRefactor: {
        refactorCv: vi.fn(),
      },
    };

    const app = createApp(db, [], semantic, { topK: 10, minSimilarity: 0.65 });
    const body = await (await app.request('/api/matches')).json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].candidateId).toBe(candidateId);
    // 0.75 * ROLE_MISMATCH_PENALTY (0.5) * NO_REQUIRED_SKILLS_PENALTY (0.75)
    // = 0.28125, well under the default MATCH_MIN_SIMILARITY (0.65) - no
    // longer surfaces as a match at all.
    expect(body.data[0].matches).toHaveLength(0);
  });

  it('penalizes a seniority mismatch (junior CV vs lead-principal job)', async () => {
    await runIngestion(db, [fakeAdapter([record({ title: 'Principal Engineer' })])]);
    const jobs = await db.selectFrom('job_openings').select('id').execute();
    const jobOpeningId = jobs[0].id;
    await markJobSanitized(db, jobOpeningId, {
      sanitizedJson: JSON.stringify({ title: 'Principal Engineer' }),
      anchorDocument: 'JOB TITLE: Principal Engineer',
      roleCategory: null,
      seniorityLevel: 'lead-principal',
    });

    await addSanitizedCandidate('Junior Dev', null, 'junior');

    const semantic: SemanticPipeline = {
      sanitizer: { sanitizeJob: vi.fn(), sanitizeCandidate: vi.fn(), embed: vi.fn() },
      vectorStore: {
        upsertJob: vi.fn(),
        deleteJob: vi.fn(),
        upsertCandidate: vi.fn(),
        deleteCandidate: vi.fn(),
        getCandidateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
        queryJobsForCandidate: vi.fn().mockResolvedValue([{ id: jobOpeningId, similarity: 0.9 }]),
        upsertRolePhrase: vi.fn(),
        queryNearestRolePhrase: vi.fn(),
        upsertSkill: vi.fn(),
        queryNearestSkill: vi.fn(),
      },
      cvRefactor: { refactorCv: vi.fn() },
    };

    const app = createApp(db, [], semantic, { topK: 10, minSimilarity: 0 });
    const body = await (await app.request('/api/matches')).json();

    const match = body.data[0].matches[0];
    // No required skills extracted, so score = semanticSimilarity *
    // seniorityMultiplier * NO_REQUIRED_SKILLS_PENALTY
    // = 0.9 * SENIORITY_MISMATCH_PENALTY (0.7) * 0.75 = 0.4725
    expect(match.similarity).toBeCloseTo(0.4725);
  });

  it('dampens skill-coverage weight when a job has far fewer required skills than MIN_SKILLS_FOR_FULL_CONFIDENCE', async () => {
    await runIngestion(db, [fakeAdapter([record()])]);
    const jobs = await db.selectFrom('job_openings').select('id').execute();
    const jobOpeningId = jobs[0].id;

    const candidateId = await addSanitizedCandidate('Solo Skill');

    await insertSkillIfNew(db, {
      id: 'skill-only',
      canonicalLabel: 'PHP',
      normalizedLabel: 'php',
      createdAt: new Date().toISOString(),
    });
    await replaceJobRequiredSkills(db, jobOpeningId, ['skill-only']);
    await replaceCandidateSkills(db, candidateId, ['skill-only']);

    const semantic: SemanticPipeline = {
      sanitizer: { sanitizeJob: vi.fn(), sanitizeCandidate: vi.fn(), embed: vi.fn() },
      vectorStore: {
        upsertJob: vi.fn(),
        deleteJob: vi.fn(),
        upsertCandidate: vi.fn(),
        deleteCandidate: vi.fn(),
        getCandidateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
        queryJobsForCandidate: vi.fn().mockResolvedValue([{ id: jobOpeningId, similarity: 0.5 }]),
        upsertRolePhrase: vi.fn(),
        queryNearestRolePhrase: vi.fn(),
        upsertSkill: vi.fn(),
        queryNearestSkill: vi.fn(),
      },
      cvRefactor: { refactorCv: vi.fn() },
    };

    const app = createApp(db, [], semantic, { topK: 10, minSimilarity: 0, skillOverlapWeight: 0.6 });
    const body = await (await app.request('/api/matches')).json();

    const match = body.data[0].matches[0];
    // 1/1 skill matched -> skillCoverage = 1, but only 1 of the default
    // MIN_SKILLS_FOR_FULL_CONFIDENCE (3) required skills exists, so
    // skillOverlapWeight is dampened to 0.6 * (1/3) = 0.2 rather than
    // trusting a single lucky match at full weight:
    // score = 0.2 * 1 + 0.8 * 0.5 = 0.6 (vs. 0.8 undampened)
    expect(match.skillCoverage).toBe(1);
    expect(match.requiredSkillCount).toBe(1);
    expect(match.similarity).toBeCloseTo(0.6);
  });

  it('excludes candidates that have not finished sanitizing', async () => {
    await insertCandidate(db, {
      fileName: 'pending.pdf',
      contentType: 'application/pdf',
      sizeBytes: 5,
      pdfBytes: new Uint8Array([1]),
      extractedText: 'text',
    });

    const semantic: SemanticPipeline = {
      sanitizer: {
        sanitizeJob: vi.fn(),
        sanitizeCandidate: vi.fn(),
        embed: vi.fn(),
      },
      vectorStore: {
        upsertJob: vi.fn(),
        deleteJob: vi.fn(),
        upsertCandidate: vi.fn(),
        deleteCandidate: vi.fn(),
        getCandidateEmbedding: vi.fn(),
        queryJobsForCandidate: vi.fn(),
        upsertRolePhrase: vi.fn(),
        queryNearestRolePhrase: vi.fn(),
        upsertSkill: vi.fn(),
        queryNearestSkill: vi.fn(),
      },
      cvRefactor: {
        refactorCv: vi.fn(),
      },
    };

    const app = createApp(db, [], semantic, { topK: 10, minSimilarity: 0.5 });
    const body = await (await app.request('/api/matches')).json();
    expect(body.data).toEqual([]);
  });
});
