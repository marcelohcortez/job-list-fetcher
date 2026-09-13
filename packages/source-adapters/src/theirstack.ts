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

export interface TheirStackAdapterOptions extends AdapterOptions {
  baseUrl?: string;
  locationQuery?: string;
  locationCountryCode?: string;
}

const DEFAULT_BASE_URL = 'https://api.theirstack.com';
export const THEIRSTACK_DEFAULT_LOCATION = 'Gothenburg';

export class TheirStackAdapter {
  readonly name = 'theirstack';
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly locationQuery: string;
  private readonly rateLimitMs: number;
  private readonly fetcher: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(apiKey: string, options: TheirStackAdapterOptions = {}) {
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.locationQuery = options.locationQuery ?? THEIRSTACK_DEFAULT_LOCATION;
    this.rateLimitMs = options.rateLimitMs ?? 200;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  async fetchJobs(): Promise<SourceRecord[]> {
    const response = await this.searchJobs();
    return this.mapToSourceRecords(response);
  }

  private async searchJobs(): Promise<unknown> {
    await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
    const params = new URLSearchParams({
      'location[0]': this.locationQuery,
      'country_code[0]': 'SE',
      per_page: '50',
      page_number: '1',
    });
    const response = await this.fetcher(
      `${this.baseUrl}/v1/job-search?${params.toString()}`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
    );
    if (!response.ok) {
      throw new Error(`TheirStack request failed (${response.status})`);
    }
    return response.json();
  }

  private mapToSourceRecords(payload: unknown): SourceRecord[] {
    const records: SourceRecord[] = [];
    for (const job of extractItems(payload)) {
      const id = pick(job, 'id');
      const candidate = {
        id: id != null ? String(id) : crypto.randomUUID(),
        sourceName: 'theirstack',
        sourceJobId: id != null ? String(id) : null,
        title: pickString(job, 'title', 'job_title'),
        company: pickString(job, 'company', 'company_name'),
        location: pickString(job, 'location', 'city'),
        description:
          pick(job, 'description', 'job_description') != null
            ? pickString(job, 'description', 'job_description')
            : null,
        url: pickString(job, 'url', 'apply_url'),
        applicationUrl:
          pick(job, 'apply_url') != null ? pickString(job, 'apply_url') : null,
        deadline: pickDate(job, 'deadline', 'deadline_at'),
        status: this.mapStatus(pick(job, 'status', 'state')),
        rawPayload: asRecord(job),
        fetchedAt: new Date(),
        sourcePublishedAt: pickDate(job, 'published_at', 'posted_at'),
      };
      const parsed = SourceRecordSchema.safeParse(candidate);
      if (parsed.success) records.push(parsed.data as SourceRecord);
      else
        throw new Error(`Invalid TheirStack record: ${parsed.error.message}`);
    }
    return records;
  }

  private mapStatus(raw: unknown): JobStatus {
    const s = String(raw ?? '').toLowerCase();
    if (['closed', 'expired', 'filled', 'removed'].includes(s)) return 'closed';
    if (s === '' || s === 'active' || s === 'open') return 'active';
    return 'unknown';
  }
}
