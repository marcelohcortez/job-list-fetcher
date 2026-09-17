import type { SourceRecord } from '@job-fetcher/domain';
import { SourceRecordSchema } from '@job-fetcher/domain';
import { asRecord, type AdapterOptions } from './base';
import { stripHtml } from './boards';

export interface TeamtailorBoard {
  host: string;
  name: string;
}

export interface TeamtailorAdapterOptions extends AdapterOptions {
  boards?: TeamtailorBoard[];
}

export const DEFAULT_TEAMTAILOR_BOARDS: readonly TeamtailorBoard[] = [
  { host: 'career.nionit.com', name: 'Nion' },
  { host: 'career.deploja.se', name: 'Deploja' },
  { host: 'jobb.xamera.se', name: 'Xamera' },
  { host: 'career.accelerate-iver.com', name: 'Accelerate' },
  { host: 'ictech.teamtailor.com', name: 'Ictech' },
  { host: 'justergroupab.teamtailor.com', name: 'Justera Group' },
  { host: 'combine.teamtailor.com', name: 'Combine' },
  { host: 'job.novacura.com', name: 'Novacura' },
];

/**
 * Teamtailor career sites all expose the same public, unauthenticated
 * `/jobs.json` JSON Feed (with an embedded schema.org `_jobposting` per
 * item), so one adapter covers every board rather than one class per site.
 */
export class TeamtailorAdapter {
  readonly name = 'teamtailor';
  readonly sourceNames: string[];
  private readonly boards: TeamtailorBoard[];
  private readonly rateLimitMs: number;
  private readonly fetcher: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(options: TeamtailorAdapterOptions = {}) {
    this.boards = options.boards ?? [...DEFAULT_TEAMTAILOR_BOARDS];
    this.sourceNames = this.boards.map((board) => board.name);
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

  private async fetchBoard(board: TeamtailorBoard): Promise<SourceRecord[]> {
    await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
    const url = `https://${board.host}/jobs.json`;
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Teamtailor board ${board.host} request failed (${response.status})`);
    }
    const body = asRecord(await response.json());
    const items = Array.isArray(body.items) ? body.items : [];
    const records: SourceRecord[] = [];
    for (const raw of items) {
      const item = asRecord(raw);
      const record = this.toSourceRecord(item, board);
      const parsed = SourceRecordSchema.safeParse(record);
      if (parsed.success) records.push(parsed.data as SourceRecord);
      else throw new Error(`Invalid Teamtailor record: ${parsed.error.message}`);
    }
    return records;
  }

  private toSourceRecord(
    item: Record<string, unknown>,
    board: TeamtailorBoard,
  ): SourceRecord {
    const posting = asRecord(item._jobposting);
    const id = item.id != null ? String(item.id) : null;
    const url = typeof item.url === 'string' ? item.url : '';
    const contentHtml =
      typeof item.content_html === 'string' ? item.content_html : '';
    const validThrough =
      typeof posting.validThrough === 'string' ? new Date(posting.validThrough) : null;
    const datePublished =
      typeof item.date_published === 'string' ? new Date(item.date_published) : null;
    const hiringOrganization = asRecord(posting.hiringOrganization);

    return {
      id: id != null ? `${board.host}:${id}` : crypto.randomUUID(),
      sourceName: board.name,
      sourceJobId: id,
      title: typeof item.title === 'string' ? item.title : '',
      company:
        typeof hiringOrganization.name === 'string'
          ? hiringOrganization.name
          : board.name,
      location: this.resolveLocation(posting),
      description: contentHtml ? stripHtml(contentHtml) : null,
      url,
      applicationUrl: null,
      deadline: validThrough && !Number.isNaN(validThrough.getTime()) ? validThrough : null,
      status: 'active',
      rawPayload: item,
      fetchedAt: new Date(),
      sourcePublishedAt:
        datePublished && !Number.isNaN(datePublished.getTime()) ? datePublished : null,
    };
  }

  private resolveLocation(posting: Record<string, unknown>): string {
    const places = Array.isArray(posting.jobLocation) ? posting.jobLocation : [];
    const place = asRecord(places[0]);
    const address = asRecord(place.address);
    const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '');
    return parts.join(', ');
  }
}
