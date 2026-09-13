import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Kysely } from 'kysely';
import type { SourceAdapter } from '@job-fetcher/source-adapters';
import type { JobDb } from '@job-fetcher/database';
import { jobsRoutes } from './routes/jobs';
import { ingestionRoutes } from './routes/ingestion';
import { cvRoutes } from './routes/cv';

export function createApp(db: Kysely<JobDb>, adapters: SourceAdapter[]) {
  const app = new Hono();

  app.use('*', cors());
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.route('/jobs', jobsRoutes(db));
  app.route('/ingestion', ingestionRoutes(db, adapters));
  app.route('/cv', cvRoutes(db));

  return app;
}
