import { describe, it, expect, vi } from 'vitest';
import { TheirStackAdapter } from '../src/theirstack';
import {
  JobTechDevAdapter,
  JOBTECH_DEFAULT_MUNICIPALITY_CODE,
} from '../src/jobtech';
import { GreenhouseAdapter } from '../src/greenhouse';
import { LeverAdapter } from '../src/lever';
import { TeamtailorAdapter } from '../src/teamtailor';
import { KeymanAdapter } from '../src/keyman';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

  it('includes the lists sections (requirements, responsibilities) alongside the intro', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([
        {
          ...leverPosting,
          lists: [
            {
              text: 'What You Will Do:',
              content: '<ul><li>Ship features</li><li>Review code</li></ul>',
            },
            {
              text: 'What You Will Bring:',
              content: '<ul><li>5+ years with Python</li><li>Strong SQL</li></ul>',
            },
          ],
        },
      ]),
    );
    const records = await new LeverAdapter({
      rateLimitMs: 0,
      boards: [{ slug: 'spotify', name: 'Spotify' }],
      fetcher,
    }).fetchJobs();
    expect(records[0].description).toContain('Join the band.');
    expect(records[0].description).toContain('What You Will Do:');
    expect(records[0].description).toContain('Ship features');
    expect(records[0].description).toContain('What You Will Bring:');
    expect(records[0].description).toContain('5+ years with Python');
    expect(records[0].description).not.toContain('<ul>');
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

const teamtailorFeed = {
  items: [
    {
      id: 'ecec636d-fa40-4325-83d3-bdf04f862052',
      title: 'Data engineer',
      url: 'https://career.nionit.com/jobs/8325044-data-engineer',
      date_published: '2026-09-04T16:40:24+02:00',
      content_html: '<p>Build data pipelines.</p>',
      _jobposting: {
        '@type': 'JobPosting',
        validThrough: '2026-10-01T00:00:00.000Z',
        hiringOrganization: { name: 'Nion' },
        jobLocation: [
          {
            address: {
              addressLocality: 'Gothenburg',
              addressCountry: 'SE',
            },
          },
        ],
      },
    },
  ],
};

describe('TeamtailorAdapter', () => {
  it('fetches each configured board from jobs.json', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse({ items: [] });
    });
    await new TeamtailorAdapter({
      rateLimitMs: 0,
      boards: [{ host: 'career.nionit.com', name: 'Nion' }],
      fetcher,
    }).fetchJobs();
    expect(urls).toEqual(['https://career.nionit.com/jobs.json']);
  });

  it('maps feed items to SourceRecords', async () => {
    const fetcher = vi.fn(async () => jsonResponse(teamtailorFeed));
    const records = await new TeamtailorAdapter({
      rateLimitMs: 0,
      boards: [{ host: 'career.nionit.com', name: 'Nion' }],
      fetcher,
    }).fetchJobs();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceName: 'Nion',
      sourceJobId: 'ecec636d-fa40-4325-83d3-bdf04f862052',
      title: 'Data engineer',
      company: 'Nion',
      location: 'Gothenburg, SE',
      url: 'https://career.nionit.com/jobs/8325044-data-engineer',
      status: 'active',
    });
    expect(records[0].description).toBe('Build data pipelines.');
    expect(records[0].deadline).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(records[0].sourcePublishedAt).toBeInstanceOf(Date);
  });

  it('throws on failed board requests', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }));
    await expect(
      new TeamtailorAdapter({
        rateLimitMs: 0,
        boards: [{ host: 'career.nionit.com', name: 'Nion' }],
        fetcher,
      }).fetchJobs(),
    ).rejects.toThrow(/500/);
  });

  it('exposes each configured board name for the UI to list as a source', () => {
    const adapter = new TeamtailorAdapter({
      boards: [
        { host: 'career.nionit.com', name: 'Nion' },
        { host: 'career.deploja.se', name: 'Deploja' },
        { host: 'jobb.xamera.se', name: 'Xamera' },
      ],
    });
    expect(adapter.sourceNames).toEqual(['Nion', 'Deploja', 'Xamera']);
  });
});

const keymanPost = {
  id: 31545,
  date: '2026-09-16T00:00:00',
  link: 'https://www.keyman.se/sv/data-it/product-owner-station-till-okq8-16326/',
  title: { rendered: 'Product Owner Station till OKQ8' },
  content: {
    rendered:
      '<table><tbody>' +
      '<tr><td><strong>Roll</strong></td><td>Produktägare</td></tr>' +
      '<tr><td><strong>Ort</strong></td><td>Göteborg</td></tr>' +
      '<tr><td><strong>Land</strong></td><td>Sweden</td></tr>' +
      '<tr><td><strong>Sista svarsdatum</strong></td><td>2026-09-18 (löpande)</td></tr>' +
      '</tbody></table><p>Uppdragsbeskrivning här.</p>',
  },
};

describe('KeymanAdapter', () => {
  it('queries the Data/IT category', async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      urls.push(url);
      return jsonResponse([]);
    });
    await new KeymanAdapter({ rateLimitMs: 0, fetcher }).fetchJobs();
    expect(urls[0]).toContain('keyman.se');
    expect(urls[0]).toContain('categories=19');
  });

  it('parses the role table embedded in the post body', async () => {
    const fetcher = vi.fn(async () => jsonResponse([keymanPost]));
    const records = await new KeymanAdapter({
      rateLimitMs: 0,
      fetcher,
    }).fetchJobs();

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceName: 'keyman',
      sourceJobId: '31545',
      title: 'Product Owner Station till OKQ8',
      company: 'OKQ8',
      location: 'Göteborg',
      url: 'https://www.keyman.se/sv/data-it/product-owner-station-till-okq8-16326/',
      status: 'active',
    });
    expect(records[0].deadline).toEqual(new Date('2026-09-18'));
    expect(records[0].description).toContain('Uppdragsbeskrivning här.');
  });

  it('falls back to KeyMan when no client name is in the title', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([{ ...keymanPost, title: { rendered: 'IAM-specialist' } }]),
    );
    const records = await new KeymanAdapter({
      rateLimitMs: 0,
      fetcher,
    }).fetchJobs();
    expect(records[0].company).toBe('KeyMan');
  });

  it('throws on failed requests', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }));
    await expect(
      new KeymanAdapter({ rateLimitMs: 0, fetcher }).fetchJobs(),
    ).rejects.toThrow(/500/);
  });
});
