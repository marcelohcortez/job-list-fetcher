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
  DEFAULT_LEVER_BOARDS,
  toBoardConfigs,
  type BoardConfig,
} from './boards';

export interface LeverAdapterOptions extends AdapterOptions {
  baseUrl?: string;
  euBaseUrl?: string;
  boards?: BoardConfig[] | string[];
}

const DEFAULT_BASE_URL = 'https://api.lever.co';
const DEFAULT_EU_BASE_URL = 'https://api.eu.lever.co';

export class LeverAdapter {
  readonly name = 'lever';
  private readonly baseUrl: string;
  private readonly euBaseUrl: string;
  private readonly boards: BoardConfig[];
  private readonly rateLimitMs: number;
  private readonly fetcher: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(options: LeverAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.euBaseUrl = options.euBaseUrl ?? DEFAULT_EU_BASE_URL;
    this.boards = toBoardConfigs(options.boards, DEFAULT_LEVER_BOARDS);
    this.rateLimitMs = options.rateLimitMs ?? 150;
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
    const bases =
      board.host === 'eu' ? [this.euBaseUrl] : [this.baseUrl, this.euBaseUrl];

    let lastStatus = 0;
    for (const base of bases) {
      const url = `${base}/v0/postings/${board.slug}?mode=json`;
      const response = await this.fetcher(url, {
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const body = await response.json();
        const records: SourceRecord[] = [];
        for (const raw of Array.isArray(body) ? body : []) {
          const posting = asRecord(raw);
          const record = this.toSourceRecord(posting, board);
          const parsed = SourceRecordSchema.safeParse(record);
          if (parsed.success) records.push(parsed.data as SourceRecord);
          else throw new Error(`Invalid Lever record: ${parsed.error.message}`);
        }
        return records;
      }
      lastStatus = response.status;
    }
    throw new Error(`Lever board ${board.slug} request failed (${lastStatus})`);
  }

  private toSourceRecord(
    posting: Record<string, unknown>,
    board: BoardConfig,
  ): SourceRecord {
    const id = pick(posting, 'id');
    const url = pickString(posting, 'hostedUrl');
    const applyUrl = pickString(posting, 'applyUrl');
    const createdAt = pick(posting, 'createdAt');
    return {
      id: id != null ? `${board.slug}:${String(id)}` : crypto.randomUUID(),
      sourceName: 'lever',
      sourceJobId: id != null ? String(id) : null,
      title: pickString(posting, 'text', 'title'),
      company: board.name,
      location: this.resolveLocation(posting),
      description: this.resolveDescription(posting),
      url,
      applicationUrl: applyUrl || null,
      deadline: null,
      status: 'active',
      rawPayload: posting,
      fetchedAt: new Date(),
      sourcePublishedAt:
        typeof createdAt === 'number' && !Number.isNaN(createdAt)
          ? new Date(createdAt)
          : pickDate(posting, 'createdAt'),
    };
  }

  private resolveLocation(posting: Record<string, unknown>): string {
    const categories = asRecord(pick(posting, 'categories'));
    const workplace = pickString(posting, 'workplaceType');
    let location = pickString(categories, 'location');
    const allLocations = pick(categories, 'allLocations');
    if (!location && Array.isArray(allLocations)) {
      location = allLocations.map(String).join(', ');
    }
    location = location.trim();
    if (location && /\b(remote|hybrid)\b/i.test(location)) return location;
    if (workplace === 'remote' || workplace === 'hybrid') {
      return location
        ? `${workplace === 'remote' ? 'Remote' : 'Hybrid'} - ${location}`
        : workplace === 'remote'
          ? 'Remote'
          : 'Hybrid';
    }
    return location;
  }

  private resolveDescription(posting: Record<string, unknown>): string | null {
    const plain = pick(posting, 'descriptionPlain');
    if (typeof plain === 'string' && plain.trim() !== '') return plain.trim();
    return null;
  }
}
