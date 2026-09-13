import type { SourceRecord } from '@job-fetcher/domain';
import { SourceRecordSchema } from '@job-fetcher/domain';
import {
  asRecord,
  pick,
  pickDate,
  pickString,
  type AdapterOptions,
} from './base';
import {
  DEFAULT_GREENHOUSE_BOARDS,
  stripHtml,
  toBoardConfigs,
  type BoardConfig,
} from './boards';

export interface GreenhouseAdapterOptions extends AdapterOptions {
  baseUrl?: string;
  boards?: BoardConfig[] | string[];
}

const DEFAULT_BASE_URL = 'https://boards-api.greenhouse.io/v1/boards';

const VAGUE_LOCATION = /^(remote|hybrid|on-?site|in-?office|anywhere|global)$/i;

export class GreenhouseAdapter {
  readonly name = 'greenhouse';
  private readonly baseUrl: string;
  private readonly boards: BoardConfig[];
  private readonly rateLimitMs: number;
  private readonly fetcher: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(options: GreenhouseAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.boards = toBoardConfigs(options.boards, DEFAULT_GREENHOUSE_BOARDS);
    this.rateLimitMs = options.rateLimitMs ?? 100;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  async fetchJobs(): Promise<SourceRecord[]> {
    const records: SourceRecord[] = [];
    for (const board of this.boards) {
      records.push(...(await this.fetchBoard(board)));
    }
    return records;
  }

  private async fetchBoard(board: BoardConfig): Promise<SourceRecord[]> {
    await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
    const response = await this.fetcher(
      `${this.baseUrl}/${board.slug}/jobs?content=true`,
      { headers: { Accept: 'application/json' } },
    );
    if (!response.ok) {
      throw new Error(
        `Greenhouse board ${board.slug} request failed (${response.status})`,
      );
    }
    const payload = asRecord(await response.json());
    const records: SourceRecord[] = [];
    for (const raw of Array.isArray(payload.jobs) ? payload.jobs : []) {
      const job = asRecord(raw);
      const record = this.toSourceRecord(job, board);
      const parsed = SourceRecordSchema.safeParse(record);
      if (parsed.success) records.push(parsed.data as SourceRecord);
      else
        throw new Error(`Invalid Greenhouse record: ${parsed.error.message}`);
    }
    return records;
  }

  private toSourceRecord(
    job: Record<string, unknown>,
    board: BoardConfig,
  ): SourceRecord {
    const id = pick(job, 'id');
    const url = this.resolveUrl(board, job, id);
    const location = this.resolveLocation(job);
    const content = pick(job, 'content');
    return {
      id: id != null ? `${board.slug}:${String(id)}` : crypto.randomUUID(),
      sourceName: 'greenhouse',
      sourceJobId: id != null ? String(id) : null,
      title: pickString(job, 'title'),
      company: board.name,
      location,
      description:
        typeof content === 'string' && content.trim() !== ''
          ? stripHtml(content)
          : null,
      url,
      applicationUrl: url,
      deadline: null,
      status: 'active',
      rawPayload: job,
      fetchedAt: new Date(),
      sourcePublishedAt: pickDate(job, 'first_published', 'updated_at'),
    };
  }

  private resolveUrl(
    board: BoardConfig,
    job: Record<string, unknown>,
    id: unknown,
  ): string {
    const absolute = pickString(job, 'absolute_url');
    if (absolute) return absolute;
    return `https://boards.greenhouse.io/${board.slug}/jobs/${id ?? ''}`;
  }

  private resolveLocation(job: Record<string, unknown>): string {
    const primary = pickString(asRecord(pick(job, 'location')), 'name');
    const metadata = this.customField(job, 'Job Posting Location');
    if (!primary || VAGUE_LOCATION.test(primary.trim())) {
      return metadata || primary || '';
    }
    return primary;
  }

  private customField(job: Record<string, unknown>, name: string): string {
    const metadata = pick(job, 'metadata');
    if (!Array.isArray(metadata)) return '';
    for (const item of metadata) {
      const entry = asRecord(item);
      if (pickString(entry, 'name') !== name) continue;
      const value = pick(entry, 'value');
      if (Array.isArray(value)) return value.map(String).join(', ');
      if (value != null) return String(value);
    }
    return '';
  }
}
