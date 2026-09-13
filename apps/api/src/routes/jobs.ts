import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { JobDb, UserMark } from '@job-fetcher/database';
import {
  getJobById,
  getUserMarks,
  listJobs,
  setUserMark,
} from '@job-fetcher/database';
import { getSourcesForJob, toSourceRecord } from '@job-fetcher/database';
import type { JobOpening, SourceRecord } from '@job-fetcher/domain';

const MARK_VALUES: readonly UserMark[] = ['applied', 'not_interested'];

type JobWithMark = JobOpening & { userMark: UserMark | null };

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
    const marks = await getUserMarks(
      db,
      jobs.map((job) => job.id),
    );
    return jobs.map((job) => ({
      ...job,
      userMark: marks[job.id] ?? null,
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
    return c.json({
      data: {
        ...publicJob(job),
        sourceRecords: sources,
        userMark: marks[id] ?? null,
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

  return app;
}
