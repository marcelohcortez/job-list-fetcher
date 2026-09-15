import { describe, it, expect, vi } from 'vitest';
import { isJobInScope } from '@job-fetcher/domain';
import { CinodeMarketAdapter } from '../src/cinode-market';

/** One card, shaped exactly like the live market list markup. */
function card({
  id = '22485',
  title = 'Android Platform Software Engineer',
  company = 'TechSeed',
  location = '<a href="/requests/city/goteborg">G&#xF6;teborg</a> <span>(Onsite)</span>',
  announced = 'Announced 14 Sep, 2026',
  deadline = 'Deadline 30 Sep, 2026',
} = {}) {
  return `<div class="requests-list__card" data-href="/requests/${id}">
    <div class="requests-list__card-header">
      <div class="requests-list__title">
        <a class="list__heading" href="/requests/${id}">${title}</a>
      </div>
    </div>
    <div class="list__details">
      <div class="focus__item"><svg><use href="#icon-hash"></use></svg><p>${id}</p></div>
      <div class="focus__item"><svg><use href="#icon-map-pin"></use></svg><p>${location}</p></div>
    </div>
    <div class="requests-list__card-footer">
      <span class="requests-list__card-company list__text"><a href="/x">${company}</a></span>
      <span class="requests-list__card-meta-item list__text">${announced}</span>
      <span class="requests-list__card-meta-item list__text">${deadline}</span>
    </div>
  </div>`;
}

function page(cards: string[], cursor?: string) {
  const button = cursor
    ? `<button id="load-more-button" data-next-cursor="${cursor}">Load more</button>`
    : '';
  return `<html><body><div class="requests-list">${cards.join('')}</div>${button}</body></html>`;
}

function respond(body: string, nextCursor?: string) {
  const headers = new Headers();
  if (nextCursor) headers.set('X-Next-Cursor', nextCursor);
  return new Response(body, { status: 200, headers });
}

describe('CinodeMarketAdapter', () => {
  it('maps a listing to a validated SourceRecord', async () => {
    const fetcher = vi.fn(async () => respond(page([card()])));
    const records = await new CinodeMarketAdapter({
      rateLimitMs: 0,
      fetcher,
    }).fetchJobs();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceName: 'cinode-market',
      sourceJobId: '22485',
      title: 'Android Platform Software Engineer',
      company: 'TechSeed',
      location: 'Göteborg',
      status: 'active',
      url: 'https://market.cinode.com/requests/22485',
    });
    expect(records[0].deadline).toEqual(new Date('2026-09-30T00:00:00.000Z'));
    expect(records[0].sourcePublishedAt).toEqual(
      new Date('2026-09-14T00:00:00.000Z'),
    );
    expect(isJobInScope(records[0].title, records[0].location)).toBe(true);
  });

  it('sends the XHR header the list endpoint requires', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      respond(page([card()])),
    );
    await new CinodeMarketAdapter({ rateLimitMs: 0, fetcher }).fetchJobs();
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe(
      'XMLHttpRequest',
    );
  });

  it('follows the cursor until the site stops returning one', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      if (urls.length === 1) {
        return respond(page([card({ id: '1' })], 'cursorA'), 'cursorA');
      }
      return respond(page([card({ id: '2' })]));
    });
    const records = await new CinodeMarketAdapter({
      rateLimitMs: 0,
      fetcher,
    }).fetchJobs();

    expect(records.map((r) => r.sourceJobId)).toEqual(['1', '2']);
    expect(urls[1]).toBe('https://market.cinode.com/?nextCursor=cursorA');
  });

  it('does not emit the same listing twice across pages', async () => {
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      return call === 1
        ? respond(page([card({ id: '1' })], 'c'), 'c')
        : respond(page([card({ id: '1' })]));
    });
    const records = await new CinodeMarketAdapter({
      rateLimitMs: 0,
      fetcher,
    }).fetchJobs();
    expect(records).toHaveLength(1);
  });

  it('reports only fully remote assignments as remote', async () => {
    const cases: [string, string][] = [
      ['<a>G&#xF6;teborg</a> <span>(Onsite)</span>', 'Göteborg'],
      ['<a>Stockholm</a> <span>(40% remote)</span>', 'Stockholm'],
      ['<a>Stockholm</a> <span>(100% remote)</span>', 'Stockholm (Remote)'],
      ['<span>Remote</span>', 'Remote'],
    ];
    for (const [markup, expected] of cases) {
      const fetcher = vi.fn(async () =>
        respond(page([card({ location: markup })])),
      );
      const records = await new CinodeMarketAdapter({
        rateLimitMs: 0,
        fetcher,
      }).fetchJobs();
      expect(records[0].location).toBe(expected);
    }
  });

  it('warns rather than throwing when the markup no longer parses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi.fn(async () =>
      respond('<html><body>redesign</body></html>'),
    );
    const records = await new CinodeMarketAdapter({
      rateLimitMs: 0,
      fetcher,
    }).fetchJobs();
    expect(records).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Cinode Market returned no listings'),
    );
    warn.mockRestore();
  });

  it('throws on non-OK responses', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(
      new CinodeMarketAdapter({ rateLimitMs: 0, fetcher }).fetchJobs(),
    ).rejects.toThrow(/503/);
  });

  it('stops at maxPages so a broken cursor cannot loop forever', async () => {
    let id = 0;
    const fetcher = vi.fn(async () => {
      id += 1;
      return respond(page([card({ id: String(id) })], 'c'), 'c');
    });
    await new CinodeMarketAdapter({
      rateLimitMs: 0,
      maxPages: 3,
      fetcher,
    }).fetchJobs();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
