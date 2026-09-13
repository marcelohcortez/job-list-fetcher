import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { SourceAdapter } from '@job-fetcher/source-adapters';
import type { JobDb } from '@job-fetcher/database';
import { listIngestionRuns } from '@job-fetcher/database';
import { runIngestion } from '../ingestion-runner';

export function ingestionRoutes(db: Kysely<JobDb>, adapters: SourceAdapter[]) {
  const app = new Hono();

  app.post('/run', async (c) => {
    const result = await runIngestion(db, adapters);
    return c.json(
      {
        data: {
          runId: result.runId,
          status: result.status,
          counts: result.counts,
        },
      },
      result.status === 'success' ? 200 : 500,
    );
  });

  app.get('/runs', async (c) => {
    const runs = await listIngestionRuns(db);
    return c.json({ data: runs });
  });

  return app;
}
