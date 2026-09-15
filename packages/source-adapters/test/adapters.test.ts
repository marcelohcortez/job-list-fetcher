import { describe, it, expect, vi } from 'vitest';
import { isJobInScope } from '@job-fetcher/domain';
import { CinodeAdapter } from '../src/cinode';
import { TheirStackAdapter } from '../src/theirstack';
import {
  JobTechDevAdapter,
  JOBTECH_DEFAULT_MUNICIPALITY_CODE,
} from '../src/jobtech';
import { GreenhouseAdapter } from '../src/greenhouse';
import { LeverAdapter } from '../src/lever';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CREDS = { accessId: 'id', accessSecret: 'secret' };

const sampleProject = {
  id: 7,
  seoId: 'acme-platform',
  title: 'Platform modernisation',
  description: 'Project description',
  customer: { name: 'Acme Corp' },
  currentState: 0,
  estimatedCloseDate: '2026-09-30T00:00:00.000Z',
  createdDateTime: '2026-09-01T00:00:00.000Z',
  assignments: [
    {
      id: 42,
      seoId: 'senior-software-engineer',
      title: 'Senior Software Engineer',
      description: 'Role description',
      startDate: '2026-10-01T00:00:00.000Z',
    },
  ],
};

/** Serves the token, search, project and role-location calls in that order. */
function cinodeFetcher(overrides: Record<string, unknown> = {}) {
  const urls: string[] = [];
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
    urls.push(url);
    if (url.endsWith('/token')) return jsonResponse({ access_token: 'jwt' });
    if (url.endsWith('/network/requests/received')) {
      return jsonResponse({ requests: [], totalItems: 0 });
    }
    if (url.endsWith('/projects/search')) {
      return jsonResponse({ result: [{ id: 7 }], totalItems: 1 });
    }
    if (url.endsWith('/location')) return jsonResponse({ city: 'Göteborg' });
    return jsonResponse({ ...sampleProject, ...overrides });
  });
  return { fetcher, urls };
}

const sampleRequest = {
  requestId: 314,
  requestSenderCompanyName: 'Partner AB',
  title: 'Senior Data Engineer / ML Engineer - Databricks (Remote first)',
  description: 'Databricks platform work.',
  createdDateTime: '2026-09-05T00:00:00.000Z',
  deadline: '2026-09-30T00:00:00.000Z',
  status: 0,
  isRemote: true,
  location: null,
};

/** Answers the token call, then the received-requests feed; projects are denied. */
function networkFetcher(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/token')) return jsonResponse({ access_token: 'jwt' });
    if (url.endsWith('/network/requests/received')) {
      return jsonResponse({
        requests: [{ ...sampleRequest, ...overrides }],
        totalItems: 1,
      });
    }
    return new Response('', { status: 403 });
  });
}

describe('CinodeAdapter', () => {
  it('exchanges credentials for a bearer token before querying', async () => {
    const { fetcher, urls } = cinodeFetcher();
    await new CinodeAdapter(CREDS, {
      rateLimitMs: 0,
      companyId: '1',
      fetcher,
    }).fetchJobs();

    expect(urls[0]).toBe('https://api.cinode.com/token');
    const tokenInit = fetcher.mock.calls[0][1] as RequestInit;
    const basic = Buffer.from('id:secret').toString('base64');
    expect((tokenInit.headers as Record<string, string>).Authorization).toBe(
      `Basic ${basic}`,
    );
    const searchInit = fetcher.mock.calls[1][1] as RequestInit;
    expect((searchInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer jwt',
    );
  });

  it('maps each project role to a validated SourceRecord', async () => {
    const { fetcher } = cinodeFetcher();
    const records = await new CinodeAdapter(CREDS, {
      rateLimitMs: 0,
      companyId: '1',
      fetcher,
    }).fetchJobs();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceName: 'cinode',
      sourceJobId: '7-42',
      title: 'Senior Software Engineer',
      company: 'Acme Corp',
      location: 'Göteborg',
      status: 'active',
      url: 'https://app.cinode.com/projects/acme-platform/roles/senior-software-engineer',
    });
    expect(records[0].deadline).toEqual(new Date('2026-09-30T00:00:00.000Z'));
  });

  it('marks roles on non-open projects as closed', async () => {
    const { fetcher } = cinodeFetcher({ currentState: 40 });
    const records = await new CinodeAdapter(CREDS, {
      rateLimitMs: 0,
      companyId: '1',
      fetcher,
    }).fetchJobs();
    expect(records[0].status).toBe('closed');
  });

  it('keeps the role when it has no location on file', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/token')) return jsonResponse({ access_token: 'jwt' });
      if (url.endsWith('/projects/search')) {
        return jsonResponse({ result: [{ id: 7 }], totalItems: 1 });
      }
      if (url.endsWith('/location')) return new Response('', { status: 404 });
      return jsonResponse(sampleProject);
    });
    const records = await new CinodeAdapter(CREDS, {
      rateLimitMs: 0,
      companyId: '1',
      fetcher,
    }).fetchJobs();
    expect(records[0].location).toBe('');
  });

  it('ingests received network requests as openings', async () => {
    const records = await new CinodeAdapter(CREDS, {
      rateLimitMs: 0,
      companyId: '1',
      fetcher: networkFetcher(),
    }).fetchJobs();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceName: 'cinode',
      sourceJobId: 'request-314',
      title: 'Senior Data Engineer / ML Engineer - Databricks (Remote first)',
      company: 'Partner AB',
      status: 'active',
    });
    expect(records[0].deadline).toEqual(new Date('2026-09-30T00:00:00.000Z'));
  });

  it('labels an address-less remote request as Remote so it stays in scope', async () => {
    const records = await new CinodeAdapter(CREDS, {
      rateLimitMs: 0,
      companyId: '1',
      fetcher: networkFetcher(),
    }).fetchJobs();
    expect(records[0].location).toBe('Remote');
    expect(isJobInScope(records[0].title, records[0].location)).toBe(true);
  });

  it('combines a city with the remote flag', async () => {
    const records = await new CinodeAdapter(CREDS, {
      rateLimitMs: 0,
      companyId: '1',
      fetcher: networkFetcher({ location: { city: 'Göteborg' } }),
    }).fetchJobs();
    expect(records[0].location).toBe('Göteborg (Remote)');
  });

  it('marks revoked and closed requests as closed', async () => {
    const records = await new CinodeAdapter(CREDS, {
      rateLimitMs: 0,
      companyId: '1',
      fetcher: networkFetcher({ status: 20 }),
    }).fetchJobs();
    expect(records[0].status).toBe('closed');
  });

  it('keeps one feed when the other is forbidden', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const records = await new CinodeAdapter(CREDS, {
      rateLimitMs: 0,
      companyId: '1',
      fetcher: networkFetcher(),
    }).fetchJobs();
    expect(records).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Cinode project roles unavailable'),
    );
    warn.mockRestore();
  });

  it('fails the run when every feed is forbidden', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/token')) return jsonResponse({ access_token: 'jwt' });
      return new Response('', { status: 403 });
    });
    await expect(
      new CinodeAdapter(CREDS, {
        rateLimitMs: 0,
        companyId: '1',
        fetcher,
      }).fetchJobs(),
    ).rejects.toThrow(/denied access to every feed/);
    warn.mockRestore();
  });

  it('reports a failed token exchange', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(
      new CinodeAdapter(CREDS, {
        rateLimitMs: 0,
        companyId: '1',
        fetcher,
      }).fetchJobs(),
    ).rejects.toThrow(/token request failed \(401\)/);
  });

  it('throws on non-OK responses', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/token')) return jsonResponse({ access_token: 'jwt' });
      return new Response('err', { status: 429 });
    });
    await expect(
      new CinodeAdapter(CREDS, {
        rateLimitMs: 0,
        companyId: '1',
        fetcher,
      }).fetchJobs(),
    ).rejects.toThrow(/429/);
  });

  it('skips entirely without a companyId', async () => {
    const fetcher = vi.fn(async () => jsonResponse({}));
    const records = await new CinodeAdapter(CREDS, {
      rateLimitMs: 0,
      fetcher,
    }).fetchJobs();
    expect(records).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('TheirStackAdapter', () => {
  it('queries the TheirStack search endpoint with Gothenburg filters', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse({ jobs: [] });
    });
    await new TheirStackAdapter('key', { rateLimitMs: 0, fetcher }).fetchJobs();
    expect(urls[0]).toContain('theirstack.com');
    expect(urls[0]).toContain('Gothenburg');
  });

  it('maps TheirStack jobs to SourceRecords', async () => {
    const job = {
      id: 999,
      title: 'DevOps Engineer',
      company: 'Spotify',
      location: 'Gothenburg',
      url: 'https://theirstack.com/jobs/999',
      status: 'active',
    };
    const fetcher = vi.fn(async () => jsonResponse({ jobs: [job] }));
    const records = await new TheirStackAdapter('key', {
      rateLimitMs: 0,
      fetcher,
    }).fetchJobs();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceName: 'theirstack',
      sourceJobId: '999',
      title: 'DevOps Engineer',
    });
  });

  it('throws on failed API calls', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }));
    await expect(
      new TheirStackAdapter('key', { rateLimitMs: 0, fetcher }).fetchJobs(),
    ).rejects.toThrow(/500/);
  });
});

const jobTechHit = {
  id: '31449913',
  headline: 'Software Engineer',
  application_deadline: '2026-09-18T23:59:59',
  publication_date: '2026-09-01T00:00:00',
  webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/31449913',
  description: { text: 'Build software for Volvo Cars.' },
  employer: {
    name: 'Volvo Personvagnar Aktiebolag',
    workplace: 'Volvo Car Corporation',
  },
  workplace_address: { municipality: 'Göteborg', city: 'Gothenburg' },
  application_details: { url: 'https://example.com/apply/31449913' },
};

describe('JobTechDevAdapter', () => {
  it('searches the Gothenburg municipality once per query without a key', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse({ hits: [] });
    });
    const adapter = new JobTechDevAdapter({
      rateLimitMs: 0,
      queries: ['software', 'data'],
      fetcher,
    });
    await adapter.fetchJobs();
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('jobtechdev.se');
    expect(urls[0]).toContain(
      `municipality=${JOBTECH_DEFAULT_MUNICIPALITY_CODE}`,
    );
  });

  it('maps JobTech hits to SourceRecords', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ hits: [jobTechHit] }));
    const records = await new JobTechDevAdapter({
      rateLimitMs: 0,
      queries: ['software'],
      fetcher,
    }).fetchJobs();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceName: 'jobtech',
      sourceJobId: '31449913',
      title: 'Software Engineer',
      company: 'Volvo Personvagnar Aktiebolag',
      location: 'Göteborg',
      url: 'https://arbetsformedlingen.se/platsbanken/annonser/31449913',
      applicationUrl: 'https://example.com/apply/31449913',
    });
    expect(records[0].deadline).toBeInstanceOf(Date);
    expect(records[0].rawPayload).toEqual(jobTechHit);
  });

  it('deduplicates hits returned by multiple queries', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ hits: [jobTechHit] }));
    const records = await new JobTechDevAdapter({
      rateLimitMs: 0,
      queries: ['software', 'systemutvecklare'],
      fetcher,
    }).fetchJobs();
    expect(records).toHaveLength(1);
  });

  it('throws on failed API calls', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 503 }));
    await expect(
      new JobTechDevAdapter({
        rateLimitMs: 0,
        queries: ['it'],
        fetcher,
      }).fetchJobs(),
    ).rejects.toThrow(/503/);
  });
});

const greenhouseJob = {
  id: 8045063,
  title: 'Software Engineer, Backend',
  location: { name: 'Gothenburg, Sweden' },
  absolute_url: 'https://job-boards.greenhouse.io/truecaller/jobs/8045063',
  first_published: '2026-07-03T08:00:00.000Z',
  updated_at: '2026-07-03T08:00:00.000Z',
  content: '<p>Build the backend.</p><ul><li>Go</li></ul>',
  metadata: [{ name: 'Job Posting Location', value: 'Gothenburg' }],
};

describe('GreenhouseAdapter', () => {
  it('fetches each configured board', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse({ jobs: [] });
    });
    await new GreenhouseAdapter({
      rateLimitMs: 0,
      boards: [
        { slug: 'truecaller', name: 'Truecaller' },
        { slug: 'wolt', name: 'Wolt' },
      ],
      fetcher,
    }).fetchJobs();
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('boards-api.greenhouse.io');
    expect(urls[0]).toContain('/truecaller/jobs?content=true');
  });

  it('maps jobs to SourceRecords with stripped HTML descriptions', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ jobs: [greenhouseJob] }));
    const records = await new GreenhouseAdapter({
      rateLimitMs: 0,
      boards: [{ slug: 'truecaller', name: 'Truecaller' }],
      fetcher,
    }).fetchJobs();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toMatchObject({
      sourceName: 'greenhouse',
      sourceJobId: '8045063',
      title: 'Software Engineer, Backend',
      company: 'Truecaller',
      location: 'Gothenburg, Sweden',
      url: 'https://job-boards.greenhouse.io/truecaller/jobs/8045063',
      status: 'active',
    });
    expect(record.description).toContain('Build the backend.');
    expect(record.description).not.toContain('<');
    expect(record.sourcePublishedAt).toBeInstanceOf(Date);
  });

  it('falls back to a metadata location for vague locations', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        jobs: [{ ...greenhouseJob, location: { name: 'Remote' } }],
      }),
    );
    const records = await new GreenhouseAdapter({
      rateLimitMs: 0,
      boards: [{ slug: 'truecaller', name: 'Truecaller' }],
      fetcher,
    }).fetchJobs();
    expect(records[0].location).toBe('Gothenburg');
  });

  it('throws on failed board requests', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 }));
    await expect(
      new GreenhouseAdapter({
        rateLimitMs: 0,
        boards: [{ slug: 'nope', name: 'Nope' }],
        fetcher,
      }).fetchJobs(),
    ).rejects.toThrow(/404/);
  });
});

const leverPosting = {
  id: '1e8c984e-fa8e-4dbb-8f74-6f608ae3bfa1',
  text: 'Senior Software Engineer - TV Playback',
  hostedUrl:
    'https://jobs.lever.co/spotify/1e8c984e-fa8e-4dbb-8f74-6f608ae3bfa1',
  applyUrl:
    'https://jobs.lever.co/spotify/1e8c984e-fa8e-4dbb-8f74-6f608ae3bfa1/apply',
  categories: { location: 'Stockholm, Sweden', commitment: 'Full-time' },
  workplaceType: 'hybrid',
  createdAt: 1730000000000,
  descriptionPlain: 'Join the band.',
};

describe('LeverAdapter', () => {
  it('fetches each configured board from the global API', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse([leverPosting]);
    });
    await new LeverAdapter({
      rateLimitMs: 0,
      boards: [{ slug: 'spotify', name: 'Spotify' }],
      fetcher,
    }).fetchJobs();
    expect(urls[0]).toContain('api.lever.co');
    expect(urls[0]).toContain('/postings/spotify?mode=json');
  });

  it('uses the EU instance when configured', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse([leverPosting]);
    });
    await new LeverAdapter({
      rateLimitMs: 0,
      boards: [{ slug: 'tomtom', name: 'TomTom', host: 'eu' }],
      fetcher,
    }).fetchJobs();
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('api.eu.lever.co');
  });

  it('falls back to the EU instance when global 404s', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return url.includes('api.eu.lever.co')
        ? jsonResponse([leverPosting])
        : new Response('', { status: 404 });
    });
    const records = await new LeverAdapter({
      rateLimitMs: 0,
      boards: [{ slug: 'tomtom', name: 'TomTom' }],
      fetcher,
    }).fetchJobs();
    expect(urls).toHaveLength(2);
    expect(records[0].sourceName).toBe('lever');
  });

  it('maps postings to SourceRecords with remote-friendly locations', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([
        {
          ...leverPosting,
          workplaceType: 'remote',
          categories: { location: 'Remote - EMEA' },
        },
      ]),
    );
    const records = await new LeverAdapter({
      rateLimitMs: 0,
      boards: [{ slug: 'spotify', name: 'Spotify' }],
      fetcher,
    }).fetchJobs();
    expect(records[0]).toMatchObject({
      sourceName: 'lever',
      sourceJobId: '1e8c984e-fa8e-4dbb-8f74-6f608ae3bfa1',
      title: 'Senior Software Engineer - TV Playback',
      company: 'Spotify',
      location: 'Remote - EMEA',
      url: 'https://jobs.lever.co/spotify/1e8c984e-fa8e-4dbb-8f74-6f608ae3bfa1',
      applicationUrl:
        'https://jobs.lever.co/spotify/1e8c984e-fa8e-4dbb-8f74-6f608ae3bfa1/apply',
      status: 'active',
    });
    expect(records[0].description).toBe('Join the band.');
    expect(records[0].sourcePublishedAt).toBeInstanceOf(Date);
  });

  it('throws when all instances fail', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 503 }));
    await expect(
      new LeverAdapter({
        rateLimitMs: 0,
        boards: [{ slug: 'nope', name: 'Nope' }],
        fetcher,
      }).fetchJobs(),
    ).rejects.toThrow(/503/);
  });
});
