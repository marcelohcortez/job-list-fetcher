import type { SourceRecord } from '@job-fetcher/domain';
import type { MatchResult } from '@job-fetcher/domain';

export function makeSourceRecord(
  overrides: Partial<SourceRecord> = {},
): SourceRecord {
  return {
    id: `rec-${Math.random().toString(36).slice(2, 8)}`,
    sourceName: 'cinode',
    sourceJobId: 'job-1',
    title: 'Software Engineer',
    company: 'Acme Corp',
    location: 'Gothenburg',
    description: null,
    url: 'https://example.com/jobs/1',
    status: 'active',
    rawPayload: {},
    fetchedAt: new Date('2026-09-11T10:00:00.000Z'),
    ...overrides,
  };
}

export function cinodeResponse(jobs: readonly Record<string, unknown>[]) {
  return new Response(JSON.stringify([...jobs]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function theirstackResponse(jobs: readonly Record<string, unknown>[]) {
  return new Response(JSON.stringify({ jobs: [...jobs] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export type { MatchResult };
