import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import { CvMatcher, type MatchableJob } from '@job-fetcher/cv-match';
import type { JobDb } from '@job-fetcher/database';
import {
  deleteCvProfile,
  getCvProfile,
  getUserMarks,
  listJobs,
  toCvProfileSummary,
  upsertCvProfile,
} from '@job-fetcher/database';
import type { JobOpening } from '@job-fetcher/domain';
import { extractPdfText } from '../cv/pdf';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_JOBS_FOR_MATCHING = 1000;

type JobJson = Omit<JobOpening, 'rawPayload'>;

function jobJson(job: JobOpening): JobJson {
  const { rawPayload, ...rest } = job;
  return rest;
}

export function cvRoutes(db: Kysely<JobDb>) {
  const app = new Hono();

  app.get('/', async (c) => {
    const profile = await getCvProfile(db);
    if (!profile) return c.json({ error: 'no_cv', data: null }, 404);
    return c.json({ data: toCvProfileSummary(profile) });
  });

  app.post('/', async (c) => {
    const body = await c.req.parseBody();
    const file = body['cv'];
    if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return c.json({ error: 'missing_file' }, 400);
    }
    if (file.type !== 'application/pdf') {
      return c.json({ error: 'invalid_type' }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) return c.json({ error: 'empty_file' }, 400);
    if (bytes.length > MAX_PDF_BYTES) {
      return c.json({ error: 'too_large' }, 413);
    }

    let extractedText: string;
    try {
      extractedText = await extractPdfText(new Uint8Array(bytes));
    } catch {
      return c.json({ error: 'unreadable_pdf' }, 400);
    }

    const profile = await upsertCvProfile(db, {
      fileName: file.name,
      contentType: file.type,
      sizeBytes: bytes.length,
      pdfBytes: bytes,
      extractedText,
    });
    return c.json({ data: toCvProfileSummary(profile) });
  });

  app.delete('/', async (c) => {
    await deleteCvProfile(db);
    return c.json({ data: { deleted: true } });
  });

  app.get('/matches', async (c) => {
    const profile = await getCvProfile(db);
    if (!profile) {
      return c.json({ error: 'no_cv' }, 404);
    }

    const jobs = await listJobs(db, { limit: MAX_JOBS_FOR_MATCHING });
    const matcher = new CvMatcher(profile.extracted_text);
    const byId = new Map<string, JobOpening>(jobs.map((job) => [job.id, job]));
    const matchable: MatchableJob[] = jobs.map((job) => ({
      id: job.id,
      title: job.title,
      description: job.description,
      requirements: job.requirements,
      benefits: job.benefits,
      publishedAt: job.publishedAt?.toISOString() ?? null,
    }));

    const matches = matcher.match(matchable);
    const marks = await getUserMarks(
      db,
      matches.map((match) => match.jobId),
    );

    const data = matches.map((match) => {
      const job = byId.get(match.jobId);
      if (!job) throw new Error(`missing job ${match.jobId}`);
      return {
        ...jobJson(job),
        userMark: marks[job.id] ?? null,
        match: {
          score: match.score,
          titleHits: match.titleHits,
          bodyMatches: match.bodyMatches,
          matchedTerms: match.matchedTerms,
          matchedPhrases: match.matchedPhrases,
        },
      };
    });

    return c.json({ data, count: data.length });
  });

  return app;
}
