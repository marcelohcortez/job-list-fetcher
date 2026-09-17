import type { SourceRecord } from '@job-fetcher/domain';
import { SourceRecordSchema } from '@job-fetcher/domain';
import { asRecord, type AdapterOptions } from './base';
import { stripHtml } from './boards';

export interface KeymanAdapterOptions extends AdapterOptions {
  baseUrl?: string;
  categoryId?: number;
}

const DEFAULT_BASE_URL = 'https://www.keyman.se/sv';
const DEFAULT_CATEGORY_ID = 19; // "Data/IT" category on keyman.se

/**
 * KeyMan publishes consulting assignments as ordinary WordPress posts in a
 * single "Data/IT" category, with role, location and deadline embedded as
 * an HTML table inside the post body rather than as WP fields - see
 * resolveField below.
 */
export class KeymanAdapter {
  readonly name = 'keyman';
  private readonly baseUrl: string;
  private readonly categoryId: number;
  private readonly rateLimitMs: number;
  private readonly fetcher: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(options: KeymanAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.categoryId = options.categoryId ?? DEFAULT_CATEGORY_ID;
    this.rateLimitMs = options.rateLimitMs ?? 150;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  async fetchJobs(): Promise<SourceRecord[]> {
    await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
    const url = `${this.baseUrl}/wp-json/wp/v2/posts?categories=${this.categoryId}&per_page=100`;
    const response = await this.fetcher(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Keyman posts request failed (${response.status})`);
    }
    const body = await response.json();
    const posts = Array.isArray(body) ? body : [];
    const records: SourceRecord[] = [];
    for (const raw of posts) {
      const post = asRecord(raw);
      const record = this.toSourceRecord(post);
      const parsed = SourceRecordSchema.safeParse(record);
      if (parsed.success) records.push(parsed.data as SourceRecord);
      else throw new Error(`Invalid Keyman record: ${parsed.error.message}`);
    }
    return records;
  }

  private toSourceRecord(post: Record<string, unknown>): SourceRecord {
    const id = post.id != null ? String(post.id) : null;
    const title = this.resolveRendered(post.title);
    const rawContent = this.resolveRaw(post.content);
    const url = typeof post.link === 'string' ? post.link : '';
    const date = typeof post.date === 'string' ? new Date(post.date) : null;

    const location = this.resolveField(rawContent, 'Ort');
    const deadlineText = this.resolveField(rawContent, 'Sista svarsdatum');
    const deadlineMatch = deadlineText.match(/(\d{4}-\d{2}-\d{2})/);
    const deadline = deadlineMatch ? new Date(deadlineMatch[1]) : null;
    const company = this.resolveCompany(title);

    return {
      id: id != null ? `keyman:${id}` : crypto.randomUUID(),
      sourceName: 'keyman',
      sourceJobId: id,
      title,
      company,
      location,
      description: rawContent ? stripHtml(rawContent) : null,
      url,
      applicationUrl: null,
      deadline: deadline && !Number.isNaN(deadline.getTime()) ? deadline : null,
      status: 'active',
      rawPayload: post,
      fetchedAt: new Date(),
      sourcePublishedAt: date && !Number.isNaN(date.getTime()) ? date : null,
    };
  }

  private resolveRendered(value: unknown): string {
    return stripHtml(this.resolveRaw(value));
  }

  private resolveRaw(value: unknown): string {
    const record = asRecord(value);
    return typeof record.rendered === 'string' ? record.rendered : '';
  }

  /** Reads a "<strong>Label</strong></td><td ...>Value</td>" table cell. */
  private resolveField(contentHtml: string, label: string): string {
    const pattern = new RegExp(
      `<strong>${label}</strong>\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`,
      'i',
    );
    const match = contentHtml.match(pattern);
    return match ? stripHtml(match[1]).trim() : '';
  }

  private resolveCompany(title: string): string {
    const match = title.match(/\btill\s+([A-ZÅÄÖ][\w&.\- ]{1,40})$/);
    return match ? match[1].trim() : 'KeyMan';
  }
}
