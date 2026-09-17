import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { JobDb, UserMark } from '@job-fetcher/database';
import {
  getJobById,
  getUserMarks,
  listJobs,
  setUserMark,
  setJobSeen,
  getSentCvIds,
  setSentCvs,
  getCandidate,
} from '@job-fetcher/database';
import { getSourcesForJob, toSourceRecord } from '@job-fetcher/database';
import type { JobOpening, SourceRecord } from '@job-fetcher/domain';

const MARK_VALUES: readonly UserMark[] = ['applied', 'not_interested'];

type JobWithMark = JobOpening & {
  userMark: UserMark | null;
  seenAt: string | null;
  sentCvIds: string[];
};

export function jobsRoutes(db: Kysely<JobDb>) {
  const app = new Hono();

  const publicJob = (job: JobOpening) => {
    const { rawPayload, ...rest } = job;
    return rest;
  };

  const publicSource = (record: SourceRecord) => {
    const { rawPayload, ...rest } = record;
    return rest;
  };

  const withMark = async (jobs: JobOpening[]): Promise<JobWithMark[]> => {
    const jobIds = jobs.map((job) => job.id);
    const marks = await getUserMarks(db, jobIds);
    const sentCvs = await getSentCvIds(db, jobIds);
    return jobs.map((job) => ({
      ...job,
      userMark: marks[job.id]?.mark ?? null,
      seenAt: marks[job.id]?.seenAt ?? null,
      sentCvIds: sentCvs[job.id] ?? [],
    }));
  };

  app.get('/search', async (c) => {
    const { query } = c.req.query();
    const jobs = await listJobs(db, { query, limit: 100 });
    const withMarks = await withMark(jobs);
    return c.json({ data: withMarks.map(publicJob), count: jobs.length });
  });

  app.get('/', async (c) => {
    const {
      source,
      location,
      status,
      employmentType,
      seniority,
      query,
      limit,
      offset,
    } = c.req.query();
    const jobs = await listJobs(db, {
      source,
      location,
      status,
      employmentType,
      seniority,
      query,
      limit: limit !== undefined ? Number(limit) : 50,
      offset: offset !== undefined ? Number(offset) : 0,
    });
    const withMarks = await withMark(jobs);
    return c.json({ data: withMarks.map(publicJob), count: jobs.length });
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const job = await getJobById(db, id);
    if (!job) return c.json({ error: 'not_found' }, 404);
    const sources = (await getSourcesForJob(db, id))
      .map(toSourceRecord)
      .map(publicSource);
    const marks = await getUserMarks(db, [id]);
    const sentCvs = await getSentCvIds(db, [id]);
    return c.json({
      data: {
        ...publicJob(job),
        sourceRecords: sources,
        userMark: marks[id]?.mark ?? null,
        seenAt: marks[id]?.seenAt ?? null,
        sentCvIds: sentCvs[id] ?? [],
      },
    });
  });

  app.put('/:id/mark', async (c) => {
    const id = c.req.param('id');
    const job = await getJobById(db, id);
    if (!job) return c.json({ error: 'not_found' }, 404);

    const body = await c.req.json().catch(() => null);
    const mark: unknown = body?.mark ?? null;
    if (mark !== null && !MARK_VALUES.includes(mark as UserMark)) {
      return c.json({ error: 'invalid_mark' }, 400);
    }

    await setUserMark(db, id, mark as UserMark | null);
    return c.json({ data: { userMark: mark as UserMark | null } });
  });

  app.put('/:id/seen', async (c) => {
    const id = c.req.param('id');
    const job = await getJobById(db, id);
    if (!job) return c.json({ error: 'not_found' }, 404);

    const body = await c.req.json().catch(() => null);
    const seen: unknown = body?.seen ?? true;
    if (typeof seen !== 'boolean') {
      return c.json({ error: 'invalid_seen' }, 400);
    }

    await setJobSeen(db, id, seen);
    const marks = await getUserMarks(db, [id]);
    return c.json({ data: { seenAt: marks[id]?.seenAt ?? null } });
  });

  app.put('/:id/sent-cvs', async (c) => {
    const id = c.req.param('id');
    const job = await getJobById(db, id);
    if (!job) return c.json({ error: 'not_found' }, 404);

    const body = await c.req.json().catch(() => null);
    const candidateIds: unknown = body?.candidateIds;
    if (
      !Array.isArray(candidateIds) ||
      !candidateIds.every((v) => typeof v === 'string')
    ) {
      return c.json({ error: 'invalid_candidate_ids' }, 400);
    }

    for (const candidateId of candidateIds) {
      const candidate = await getCandidate(db, candidateId);
      if (!candidate) return c.json({ error: 'unknown_candidate' }, 400);
    }

    await setSentCvs(db, id, candidateIds);
    return c.json({ data: { sentCvIds: candidateIds } });
  });

  return app;
}
