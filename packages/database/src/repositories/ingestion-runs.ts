import type { Kysely } from 'kysely';
import type { JobDb } from '../schema';
import type { IngestionRun } from '@job-fetcher/domain';

export async function createIngestionRun(
  db: Kysely<JobDb>,
  run: {
    id: string;
    startTime: Date;
    sources: string[];
    counts: IngestionRun['counts'];
  },
): Promise<void> {
  await db
    .insertInto('ingestion_runs')
    .values({
      id: run.id,
      start_time: run.startTime.toISOString(),
      end_time: null,
      status: 'running',
      sources: JSON.stringify(run.sources),
      counts: JSON.stringify(run.counts),
      error: null,
    })
    .execute();
}

export async function finishIngestionRun(
  db: Kysely<JobDb>,
  run: {
    id: string;
    endTime: Date;
    status: 'success' | 'failed';
    counts: IngestionRun['counts'];
    error?: string;
  },
): Promise<void> {
  await db
    .updateTable('ingestion_runs')
    .set({
      end_time: run.endTime.toISOString(),
      status: run.status,
      counts: JSON.stringify(run.counts),
      error: run.error ?? null,
    })
    .where('id', '=', run.id)
    .execute();
}

export async function listIngestionRuns(
  db: Kysely<JobDb>,
  limit = 20,
): Promise<IngestionRun[]> {
  const rows = await db
    .selectFrom('ingestion_runs')
    .selectAll()
    .orderBy('start_time', 'desc')
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    startTime: new Date(row.start_time),
    endTime: row.end_time ? new Date(row.end_time) : null,
    status: row.status as IngestionRun['status'],
    sources: JSON.parse(row.sources) as string[],
    counts: row.counts
      ? (JSON.parse(row.counts) as IngestionRun['counts'])
      : emptyCounts(),
    error: row.error ?? undefined,
  }));
}

function emptyCounts(): IngestionRun['counts'] {
  return {
    fetched: 0,
    accepted: 0,
    rejected: 0,
    created: 0,
    updated: 0,
    deduplicated: 0,
    failed: 0,
  };
}
