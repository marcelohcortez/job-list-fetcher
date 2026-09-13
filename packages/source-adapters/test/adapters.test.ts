import { describe, it, expect, vi } from 'vitest';
import { CinodeAdapter, CINODE_LOCATIONS } from '../src/cinode';
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

const sampleJob = {
  id: 'cinode-123',
  title: 'Software Engineer',
  company: 'Tech Corp',
  location: 'Gothenburg',
  description: 'Desc',
  url: 'https://cinode.com/jobs/123',
  deadline: '2026-09-30T00:00:00.000Z',
  status: 'active',
};

describe('CinodeAdapter', () => {
  it('queries both Göteborg and Gothenburg', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse([sampleJob]);
    });
    const adapter = new CinodeAdapter('key', { rateLimitMs: 0, fetcher });
    await adapter.fetchJobs();
    expect(CINODE_LOCATIONS).toEqual(['Göteborg', 'Gothenburg']);
    expect(urls).toHaveLength(2);
  });

  it('maps raw jobs to validated SourceRecords', async () => {
    const fetcher = vi.fn(async () => jsonResponse([sampleJob]));
    const adapter = new CinodeAdapter('key', { rateLimitMs: 0, fetcher });
    const records = await adapter.fetchJobs();
    expect(records[0]).toMatchObject({
      sourceName: 'cinode',
      sourceJobId: 'cinode-123',
      title: 'Software Engineer',
      url: 'https://cinode.com/jobs/123',
    });
    expect(records[0].rawPayload).toEqual(sampleJob);
  });

  it('throws on non-OK responses', async () => {
    const fetcher = vi.fn(async () => new Response('err', { status: 429 }));
    await expect(
      new CinodeAdapter('key', { rateLimitMs: 0, fetcher }).fetchJobs(),
    ).rejects.toThrow(/429/);
  });

  it('rejects records that fail boundary validation', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([{ ...sampleJob, url: 'not-a-url' }]),
    );
    await expect(
      new CinodeAdapter('key', { rateLimitMs: 0, fetcher }).fetchJobs(),
    ).rejects.toThrow(/Invalid/);
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
