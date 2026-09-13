import type { JobStatus, SourceRecord } from '@job-fetcher/domain';
import { SourceRecordSchema } from '@job-fetcher/domain';
import {
  asRecord,
  extractItems,
  pick,
  pickDate,
  pickString,
  type AdapterOptions,
} from './base';

export interface CinodeAdapterOptions extends AdapterOptions {
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.cinode.com';
export const CINODE_LOCATIONS = ['Göteborg', 'Gothenburg'] as const;

const CLOSED_MARKERS = [
  'closed',
  'inactive',
  'cancelled',
  'filled',
  'unavailable',
];
const OPEN_MARKERS = ['', 'active', 'open', 'ongoing'];

export class CinodeAdapter {
  readonly name = 'cinode';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly rateLimitMs: number;
  private readonly fetcher: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(apiKey: string, options: CinodeAdapterOptions = {}) {
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.rateLimitMs = options.rateLimitMs ?? 100;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  async fetchJobs(): Promise<SourceRecord[]> {
    const results = await Promise.all(
      CINODE_LOCATIONS.map((location) => this.fetchJobsForLocation(location)),
    );
    return results.flat();
  }

  private async fetchJobsForLocation(
    location: string,
  ): Promise<SourceRecord[]> {
    await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
    const endpoint = `${this.baseUrl}/jobs?location=${encodeURIComponent(location)}`;
    const response = await this.fetcher(endpoint, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) {
      throw new Error(
        `Cinode request failed (${response.status}) for "${location}"`,
      );
    }
    return this.mapToSourceRecords(await response.json());
  }

  private mapToSourceRecords(payload: unknown): SourceRecord[] {
    const records: SourceRecord[] = [];
    for (const job of extractItems(payload)) {
      const id = pick(job, 'id');
      const candidate = {
        id: id != null ? String(id) : crypto.randomUUID(),
        sourceName: 'cinode',
        sourceJobId: id != null ? String(id) : null,
        title: pickString(job, 'title'),
        company: pickString(job, 'company', 'companyName'),
        location: pickString(job, 'location', 'city'),
        description:
          pick(job, 'description') != null
            ? pickString(job, 'description')
            : null,
        url: pickString(job, 'url', 'applicationUrl'),
        applicationUrl:
          pick(job, 'applicationUrl') != null
            ? pickString(job, 'applicationUrl')
            : null,
        deadline: pickDate(job, 'deadline', 'deadlineAt', 'closingDate'),
        status: this.mapStatus(pick(job, 'status')),
        rawPayload: asRecord(job),
        fetchedAt: new Date(),
        sourcePublishedAt: pickDate(job, 'publishedAt'),
      };
      const parsed = SourceRecordSchema.safeParse(candidate);
      if (parsed.success) records.push(parsed.data as SourceRecord);
      else throw new Error(`Invalid Cinode record: ${parsed.error.message}`);
    }
    return records;
  }

  private mapStatus(raw: unknown): JobStatus {
    const s = String(raw ?? '').toLowerCase();
    if (CLOSED_MARKERS.includes(s)) return 'closed';
    if (OPEN_MARKERS.includes(s)) return 'active';
    return 'unknown';
  }
}
