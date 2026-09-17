import type { SourceRecord } from '@job-fetcher/domain';
import { SourceRecordSchema } from '@job-fetcher/domain';
import {
  asRecord,
  pick,
  pickDate,
  pickString,
  type AdapterOptions,
} from './base';
import { stripHtml } from './boards';

export interface JobTechAdapterOptions extends AdapterOptions {
  baseUrl?: string;
  municipalityCode?: string;
  queries?: string[];
  limit?: number;
}

const DEFAULT_BASE_URL = 'https://jobsearch.api.jobtechdev.se';
export const JOBTECH_DEFAULT_MUNICIPALITY_CODE = '1480';
export const JOBTECH_DEFAULT_QUERIES = [
  'software engineer',
  'systemutvecklare',
  'data',
  'cybersäkerhet',
  'it',
  'business',
  'analytiker',
];

export class JobTechDevAdapter {
  readonly name = 'jobtech';
  private readonly baseUrl: string;
  private readonly municipalityCode: string;
  private readonly queries: string[];
  private readonly limit: number;
  private readonly rateLimitMs: number;
  private readonly fetcher: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(options: JobTechAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.municipalityCode =
      options.municipalityCode ?? JOBTECH_DEFAULT_MUNICIPALITY_CODE;
    this.queries = options.queries ?? JOBTECH_DEFAULT_QUERIES;
    this.limit = options.limit ?? 100;
    this.rateLimitMs = options.rateLimitMs ?? 100;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  async fetchJobs(): Promise<SourceRecord[]> {
    const seen = new Set<string>();
    const records: SourceRecord[] = [];
    for (const query of this.queries) {
      const results = await this.search(query);
      for (const record of results) {
        const key = `${record.sourceName}:${record.sourceJobId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        records.push(record);
      }
    }
    return records;
  }

  private async search(query: string): Promise<SourceRecord[]> {
    await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
    const params = new URLSearchParams({
      q: query,
      municipality: this.municipalityCode,
      limit: String(this.limit),
      offset: '0',
    });
    const response = await this.fetcher(
      `${this.baseUrl}/search?${params.toString()}`,
      {
        headers: { Accept: 'application/json' },
      },
    );
    if (!response.ok) {
      throw new Error(`JobTech Dev request failed (${response.status})`);
    }
    const payload = asRecord(await response.json());
    const hits = payload.hits;
    const records: SourceRecord[] = [];
    for (const raw of Array.isArray(hits) ? hits : []) {
      const job = asRecord(raw);
      const id = pick(job, 'id');
      const record = this.toSourceRecord(job, id);
      const parsed = SourceRecordSchema.safeParse(record);
      if (parsed.success) records.push(parsed.data as SourceRecord);
      else
        throw new Error(`Invalid JobTech Dev record: ${parsed.error.message}`);
    }
    return records;
  }

  private toSourceRecord(
    job: Record<string, unknown>,
    id: unknown,
  ): SourceRecord {
    const employer = asRecord(pick(job, 'employer'));
    const address = asRecord(pick(job, 'workplace_address'));
    const application = asRecord(pick(job, 'application_details'));
    const description = asRecord(pick(job, 'description'));
    return {
      id: id != null ? String(id) : crypto.randomUUID(),
      sourceName: 'jobtech',
      sourceJobId: id != null ? String(id) : null,
      title: pickString(job, 'headline'),
      company: pickString(employer, 'name', 'workplace'),
      location: pickString(address, 'municipality', 'city'),
      description:
        description.text != null
          ? stripHtml(pickString(description, 'text'))
          : null,
      url: pickString(job, 'webpage_url', 'url'),
      applicationUrl:
        pick(application, 'url') != null
          ? pickString(application, 'url')
          : null,
      deadline: pickDate(job, 'application_deadline'),
      status: 'active',
      rawPayload: job,
      fetchedAt: new Date(),
      sourcePublishedAt: pickDate(job, 'publication_date'),
    };
  }
}
