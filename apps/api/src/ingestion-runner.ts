import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SourceRecord } from '@job-fetcher/domain';
import { isJobEligible, matchesTargetTitle, matchesTargetLocation } from '@job-fetcher/domain';
import type { SourceAdapter } from '@job-fetcher/source-adapters';
import type { JobDb, IngestResult } from '@job-fetcher/database';
import {
  createIngestionRun,
  finishIngestionRun,
  ingestSourceRecord,
  markJobEmbeddingFailed,
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
  warnings: string[];
}

/**
 * Sanitizes + embeds a newly created/updated job opening into the vector
 * store. Injected so `runIngestion` stays unit-testable without a live
 * Ollama/Chroma - production wiring passes a real implementation from
 * `index.ts`, tests default to a no-op.
 */
export type EmbedJob = (jobOpeningId: string, rawText: string) => Promise<void>;

/**
 * Whether a job title falls within the platform's target roles. Injected so
 * production wiring can layer a vector similarity check on top of the exact
 * `matchesTargetTitle` regex match - tests default to the regex alone.
 */
export type TitleScopeCheck = (title: string) => Promise<boolean>;

export interface RunOptions {
  now?: Date;
  retries?: number;
  backoffMs?: number;
  embedJob?: EmbedJob;
  isTitleInScope?: TitleScopeCheck;
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
  const warnings: string[] = [];
  const warnedScopeErrors = new Set<string>();
  const isTitleInScope: TitleScopeCheck =
    options.isTitleInScope ?? ((title) => Promise.resolve(matchesTargetTitle(title)));

  for (const adapter of adapters) {
    let records: SourceRecord[];
    try {
      records = await withRetries(
        () => adapter.fetchJobs(),
        options.retries ?? DEFAULT_RETRIES,
        options.backoffMs ?? DEFAULT_BACKOFF_MS,
      );
    } catch (err) {
      // A single connector failing to fetch is not a reason to fail the
      // whole run - other sources still ingest fine. Surface it as a
      // warning instead so the caller can tell the user which one broke.
      warnings.push(`${adapter.name}: ${(err as Error).message}`);
      continue;
    }

    counts.fetched += records.length;
    for (const record of records) {
      const eligibility = isJobEligible(record.deadline, record.status, now, record.publishedAt);
      if (!eligibility.isEligible) {
        counts.rejected += 1;
        continue;
      }
      if (!matchesTargetLocation(record.location)) {
        counts.rejected += 1;
        continue;
      }
      let inScope: boolean;
      try {
        inScope = await isTitleInScope(record.title);
      } catch (err) {
        // The vector-similarity fallback depends on Ollama/Chroma being
        // reachable; a hiccup there must not abort the whole run and strand
        // every adapter queued behind this one - fall back to the regex-only
        // check for this record instead.
        const message = `${adapter.name}: title scope check failed (${(err as Error).message})`;
        if (!warnedScopeErrors.has(message)) {
          warnedScopeErrors.add(message);
          warnings.push(message);
        }
        inScope = matchesTargetTitle(record.title);
      }
      if (!inScope) {
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

      if (!result.unchanged && options.embedJob) {
        const rawText = [record.title, record.company, record.description]
          .filter((part): part is string => Boolean(part))
          .join('\n\n');
        try {
          await options.embedJob(result.jobOpeningId, rawText);
        } catch (err) {
          await markJobEmbeddingFailed(
            db,
            result.jobOpeningId,
            (err as Error).message,
          ).catch(() => {});
          console.warn(
            `Embedding failed for job ${result.jobOpeningId}: ${(err as Error).message}`,
          );
        }
      }
    }
  }

  await finishIngestionRun(db, {
    id: runId,
    endTime: new Date(),
    status,
    counts,
    error: [error, ...warnings].filter(Boolean).join('; ') || undefined,
  });

  return { runId, status, counts, error, warnings };
}
