import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SourceRecord } from '@job-fetcher/domain';
import { isJobEligible, isJobInScope } from '@job-fetcher/domain';
import type { SourceAdapter } from '@job-fetcher/source-adapters';
import type { JobDb, IngestResult } from '@job-fetcher/database';
import {
  createIngestionRun,
  finishIngestionRun,
  ingestSourceRecord,
} from '@job-fetcher/database';

export interface RunCounts {
  fetched: number;
  accepted: number;
  rejected: number;
  created: number;
  updated: number;
  deduplicated: number;
  failed: number;
}

export interface RunResult {
  runId: string;
  status: 'success' | 'failed';
  counts: RunCounts;
  error?: string;
}

export interface RunOptions {
  now?: Date;
  retries?: number;
  backoffMs?: number;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetries<T>(
  fn: () => Promise<T>,
  retries: number,
  backoffMs: number,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > retries) throw err;
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }
}

function emptyCounts(): RunCounts {
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

export async function runIngestion(
  db: Kysely<JobDb>,
  adapters: SourceAdapter[],
  options: RunOptions = {},
): Promise<RunResult> {
  const now = options.now ?? new Date();
  const runId = randomUUID();
  const counts = emptyCounts();

  await createIngestionRun(db, {
    id: runId,
    startTime: now,
    sources: adapters.map((a) => a.name),
    counts,
  });

  let status: RunResult['status'] = 'success';
  let error: string | undefined;

  for (const adapter of adapters) {
    let records: SourceRecord[];
    try {
      records = await withRetries(
        () => adapter.fetchJobs(),
        options.retries ?? DEFAULT_RETRIES,
        options.backoffMs ?? DEFAULT_BACKOFF_MS,
      );
    } catch (err) {
      status = 'failed';
      error = `${adapter.name}: ${(err as Error).message}`;
      counts.failed += 1;
      continue;
    }

    counts.fetched += records.length;
    for (const record of records) {
      const eligibility = isJobEligible(record.deadline, record.status, now);
      if (!eligibility.isEligible) {
        counts.rejected += 1;
        continue;
      }
      if (!isJobInScope(record.title, record.location)) {
        counts.rejected += 1;
        continue;
      }
      counts.accepted += 1;
      let result: IngestResult;
      try {
        result = await ingestSourceRecord(db, record);
      } catch (err) {
        status = 'failed';
        error = `${adapter.name}: ${(err as Error).message}`;
        counts.failed += 1;
        continue;
      }
      if (result.created) counts.created += 1;
      else if (result.unchanged) counts.deduplicated += 1;
      else counts.updated += 1;
    }
  }

  await finishIngestionRun(db, {
    id: runId,
    endTime: new Date(),
    status,
    counts,
    error,
  });

  return { runId, status, counts, error };
}
