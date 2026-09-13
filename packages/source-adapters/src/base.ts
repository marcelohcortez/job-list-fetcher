import type { SourceRecord } from '@job-fetcher/domain';

export interface SourceAdapter {
  readonly name: string;
  fetchJobs(): Promise<SourceRecord[]>;
}

export interface AdapterOptions {
  rateLimitMs?: number;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}

export type RawRecord = Record<string, unknown>;

export function asRecord(value: unknown): RawRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as RawRecord;
  }
  return {};
}

export function pick(record: RawRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export function pickString(record: RawRecord, ...keys: string[]): string {
  const value = pick(record, ...keys);
  return value == null ? '' : String(value);
}

export function pickDate(record: RawRecord, ...keys: string[]): Date | null {
  const value = pick(record, ...keys);
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function extractItems(payload: unknown): RawRecord[] {
  const root = asRecord(payload);
  const rawItems = Array.isArray(payload)
    ? payload
    : Array.isArray(root.jobs)
      ? root.jobs
      : Array.isArray(root.data)
        ? root.data
        : [];
  return rawItems.map(asRecord);
}
