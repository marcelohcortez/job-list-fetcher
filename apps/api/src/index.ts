import { serve } from '@hono/node-server';
import { loadEnv } from '@job-fetcher/config';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import {
  GreenhouseAdapter,
  JobTechDevAdapter,
  LeverAdapter,
  TheirStackAdapter,
  type SourceAdapter,
} from '@job-fetcher/source-adapters';
import { createApp } from './app';

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseQueries(value: string | undefined): string[] | undefined {
  return parseList(value);
}

function main() {
  const env = loadEnv();

  const sqlite = openSqlite(env.DATABASE_PATH);
  const db = createKysely(sqlite);
  void runMigrations(db);

  const adapters: SourceAdapter[] = [
    new JobTechDevAdapter({
      queries: parseQueries(env.JOBTECH_QUERIES),
      municipalityCode: env.JOBTECH_MUNICIPALITY_CODE,
    }),
    new GreenhouseAdapter({ boards: parseList(env.GREENHOUSE_BOARDS) }),
    new LeverAdapter({ boards: parseList(env.LEVER_BOARDS) }),
  ];
  if (env.THEIRSTACK_API_KEY) {
    adapters.push(new TheirStackAdapter(env.THEIRSTACK_API_KEY));
  }

  const app = createApp(db, adapters);

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Job List Fetcher API listening on :${info.port}`);
  });
}

main();
