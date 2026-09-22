import type { SourceRecord } from '@job-fetcher/domain';
import { SourceRecordSchema } from '@job-fetcher/domain';
import type { AdapterOptions } from './base';

export interface CinodeMarketAdapterOptions extends AdapterOptions {
  baseUrl?: string;
  maxPages?: number;
}

const DEFAULT_BASE_URL = 'https://market.cinode.com';
const DEFAULT_MAX_PAGES = 20;

/**
 * Cinode Market is the public board where consultancies announce assignment
 * requests. It has no documented API, so we read the same HTML the site's own
 * "load more" button does: the list responds to `X-Requested-With` with a
 * fragment of cards and returns the next page's cursor in `X-Next-Cursor`.
 *
 * Being HTML, it is brittle - a restyle of the card markup will break parsing,
 * which surfaces as zero records rather than an error, so the adapter warns
 * when a page yields no cards.
 */
export class CinodeMarketAdapter {
  readonly name = 'cinode-market';
  private readonly baseUrl: string;
  private readonly maxPages: number;
  private readonly rateLimitMs: number;
  private readonly fetcher: (
    url: string,
    init?: RequestInit,
  ) => Promise<Response>;

  constructor(options: CinodeMarketAdapterOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.rateLimitMs = options.rateLimitMs ?? 250;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  }

  async fetchJobs(): Promise<SourceRecord[]> {
    const records: SourceRecord[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;

    for (let page = 0; page < this.maxPages; page += 1) {
      const url =
        cursor === null
          ? `${this.baseUrl}/`
          : `${this.baseUrl}/?nextCursor=${encodeURIComponent(cursor)}`;
      const response = await this.get(url);
      const html = await response.text();
      const cards = parseCards(html);

      if (cards.length === 0) {
        if (page === 0) {
          console.warn(
            'Cinode Market returned no listings - the card markup may have changed',
          );
        }
        break;
      }

      for (const card of cards) {
        if (seen.has(card.id)) continue;
        seen.add(card.id);
        const detail = await this.fetchDetail(card.id);
        records.push(this.toSourceRecord(card, detail));
      }

      // The first page carries the cursor in the button; fragments return it
      // as a header. Either way, its absence means there is nothing more.
      cursor = response.headers.get('X-Next-Cursor') ?? parseButtonCursor(html);
      if (!cursor) break;
    }

    return records;
  }

  private async get(url: string): Promise<Response> {
    await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
    const response = await this.fetcher(url, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) {
      throw new Error(`Cinode Market request failed (${response.status})`);
    }
    return response;
  }

  /**
   * The list/fragment endpoint only ever carries card summaries (id, title,
   * company, location, dates) - no description or skills, which live only
   * on each request's own detail page. Fetched once per newly-seen card, so
   * cost stays bounded by how many *new* postings appear per run, not by
   * page count. A detail page failing to fetch or parse degrades to a null
   * description rather than failing the whole run - the card's summary
   * fields are still useful without it.
   */
  private async fetchDetail(id: string): Promise<MarketDetail> {
    try {
      const response = await this.get(`${this.baseUrl}/requests/${id}`);
      return parseDetail(await response.text());
    } catch (err) {
      console.warn(
        `Cinode Market detail page for request ${id} failed to fetch - falling back to no description`,
        err,
      );
      return { description: null, skills: [] };
    }
  }

  /**
   * Public so a one-off backfill can re-pull the detail page for a request
   * already in the database (e.g. one ingested before this adapter fetched
   * detail pages at all) without re-scraping the whole list.
   */
  fetchDetailForId(sourceJobId: string): Promise<MarketDetail> {
    return this.fetchDetail(sourceJobId);
  }

  private toSourceRecord(card: MarketCard, detail: MarketDetail): SourceRecord {
    const candidate = {
      id: `cinode-market-${card.id}`,
      sourceName: 'cinode-market',
      sourceJobId: card.id,
      title: card.title,
      company: card.company,
      location: card.location,
      description: buildDescription(detail),
      url: `${this.baseUrl}/requests/${card.id}`,
      applicationUrl: null,
      deadline: card.deadline,
      // The market lists only requests that are still open for responses.
      status: 'active' as const,
      rawPayload: { ...card, deadline: card.deadline?.toISOString() ?? null },
      fetchedAt: new Date(),
      sourcePublishedAt: card.announced,
    };
    const parsed = SourceRecordSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(`Invalid Cinode Market record: ${parsed.error.message}`);
    }
    return parsed.data as SourceRecord;
  }
}

interface MarketCard {
  id: string;
  title: string;
  company: string;
  location: string;
  deadline: Date | null;
  announced: Date | null;
}

export interface MarketDetail {
  description: string | null;
  skills: string[];
}

/** The desired-skills tags are appended as their own line rather than dropped - see `parseDetail`. */
export function buildDescription(detail: MarketDetail): string | null {
  const description = [
    detail.description,
    detail.skills.length > 0 ? `Desired skills: ${detail.skills.join(', ')}` : null,
  ]
    .filter((part): part is string => part != null && part !== '')
    .join('\n\n');
  return description || null;
}

/**
 * A request's own page carries the body copy as rich-text HTML
 * (`.wysiwyg-output`, `<p>`/`<br>` only - no nested divs, so a non-greedy
 * match to the next `</div></div>` is safe) plus a "Desired skills" tag
 * list (`.details__skill a[title]`) the market maintainers curate by hand -
 * a cleaner signal than whatever a sanitizer LLM would extract from prose,
 * so it's appended to the description as its own line rather than dropped.
 */
function parseDetail(html: string): MarketDetail {
  const bodyMatch = html.match(
    /<div class="wysiwyg-output">([\s\S]*?)<\/div>\s*<\/div>/,
  );
  const description = bodyMatch ? decodeHtml(stripTags(bodyMatch[1])) : null;

  const skillsSectionMatch = html.match(
    /<section class="details__skills">([\s\S]*?)<\/section>/,
  );
  const skills = skillsSectionMatch
    ? [...skillsSectionMatch[1].matchAll(/class="details__skill">\s*<a[^>]*title="([^"]*)"/g)].map(
        (match) => decodeHtml(match[1]),
      )
    : [];

  return { description: description || null, skills };
}

const CARD_DELIMITER = 'requests-list__card"';

function parseCards(html: string): MarketCard[] {
  const cards: MarketCard[] = [];
  for (const chunk of html.split(CARD_DELIMITER).slice(1)) {
    const id = firstMatch(chunk, /data-href="\/requests\/(\d+)"/);
    if (!id) continue;
    cards.push({
      id,
      title: textOf(
        chunk,
        /requests-list__title[^>]*>([\s\S]*?)<\/(?:a|h\d|div|span)>/,
      ),
      company: textOf(chunk, /card-company list__text[^>]*>([\s\S]*?)<\/span>/),
      location: parseLocation(chunk),
      deadline: parseCardDate(chunk, 'Deadline'),
      announced: parseCardDate(chunk, 'Announced'),
    });
  }
  return cards;
}

function parseButtonCursor(html: string): string | null {
  return firstMatch(html, /data-next-cursor="([^"]+)"/);
}

/**
 * A card's details are icon-labelled blocks; the location is the one carrying
 * the map-pin icon, reading as "Göteborg (Onsite)" or "Stockholm (40% remote)".
 *
 * Only a fully remote assignment is reported as remote. A partly remote one
 * still ties the consultant to its city, and calling it "remote" would let any
 * city through the location filter on the strength of the word alone.
 */
function parseLocation(chunk: string): string {
  for (const match of chunk.matchAll(
    /<div class="focus__item">([\s\S]*?)<\/div>/g,
  )) {
    if (!match[1].includes('#icon-map-pin')) continue;
    const text = decodeHtml(stripTags(match[1]));
    const city = text.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const suffix = firstMatch(text, /\(([^)]*)\)\s*$/) ?? '';
    const isFullyRemote =
      /^100\s*%\s*remote$/i.test(suffix) || /^remote$/i.test(suffix);
    if (!city) return isFullyRemote || /remote/i.test(text) ? 'Remote' : text;
    return isFullyRemote ? `${city} (Remote)` : city;
  }
  return '';
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Card dates read as "Deadline 30 Sep, 2026"; there is no time component. */
function parseCardDate(chunk: string, label: string): Date | null {
  const pattern = new RegExp(
    `${label}\\s+(\\d{1,2})\\s+([A-Za-z]{3})[a-z]*,?\\s+(\\d{4})`,
  );
  const match = stripTags(chunk).match(pattern);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (month === undefined) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
}

function firstMatch(value: string, pattern: RegExp): string | null {
  const match = value.match(pattern);
  return match ? match[1] : null;
}

function textOf(chunk: string, pattern: RegExp): string {
  const match = chunk.match(pattern);
  if (!match) return '';
  return decodeHtml(stripTags(match[1] ?? ''));
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
