import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Kysely } from 'kysely';
import type { SourceAdapter } from '@job-fetcher/source-adapters';
import type { JobDb } from '@job-fetcher/database';
import type { SemanticPipeline } from '@job-fetcher/semantic-match';
import { jobsRoutes } from './routes/jobs';
import { ingestionRoutes } from './routes/ingestion';
import { candidatesRoutes } from './routes/candidates';
import { matchesRoutes, type MatchesConfig } from './routes/matches';
import { configRoutes } from './routes/config';
import type { EmbedJob, TitleScopeCheck } from './ingestion-runner';
import type { SkillCanonicalizer } from './skill-taxonomy';

const noopCanonicalizeSkills: SkillCanonicalizer = () => Promise.resolve([]);

export function createApp(
  db: Kysely<JobDb>,
  adapters: SourceAdapter[],
  semantic: SemanticPipeline,
  matchesConfig: MatchesConfig,
  embedJob?: EmbedJob,
  isTitleInScope?: TitleScopeCheck,
  canonicalizeSkills: SkillCanonicalizer = noopCanonicalizeSkills,
) {
  const app = new Hono();

  app.use('*', cors());
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.get('/api/sources', (c) => {
    const sources = Array.from(
      new Set(adapters.flatMap((adapter) => adapter.sourceNames ?? [adapter.name])),
    ).sort((a, b) => a.localeCompare(b));
    return c.json({ data: sources });
  });
  app.route('/api/jobs', jobsRoutes(db));
  app.route('/api/ingestion', ingestionRoutes(db, adapters, embedJob, isTitleInScope));
  app.route('/api/candidates', candidatesRoutes(db, semantic, canonicalizeSkills));
  app.route('/api/matches', matchesRoutes(db, semantic, matchesConfig));
  app.route('/api/config', configRoutes(db, { vectorStore: semantic.vectorStore, embed: semantic.sanitizer.embed }));

  return app;
}
