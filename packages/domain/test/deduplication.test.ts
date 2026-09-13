import { describe, it, expect } from 'vitest';
import type { SourceRecord } from '../src/types';
import {
  calculateCanonicalKey,
  deduplicateSourceRecords,
  normalizeUrl,
} from '../src/deduplication';

function makeRecord(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: 'rec-1',
    sourceName: 'cinode',
    sourceJobId: 'job-1',
    title: 'Software Engineer',
    company: 'Acme Corp',
    location: 'Gothenburg',
    description: null,
    url: 'https://example.com/jobs/1',
    status: 'active',
    rawPayload: {},
    fetchedAt: new Date('2026-09-11T10:00:00.000Z'),
    ...overrides,
  };
}

describe('calculateCanonicalKey', () => {
  it('derives a stable content-based key', () => {
    expect(
      calculateCanonicalKey({
        title: 'Senior Backend Engineer',
        company: 'Acme Corp',
        location: 'Gothenburg',
      }),
    ).toBe('senior-backend-engineer:acme-corp:gothenburg');
  });

  it('treats Göteborg and Gothenburg identically', () => {
    const a = calculateCanonicalKey({
      title: 'T',
      company: 'C',
      location: 'Göteborg',
    });
    const b = calculateCanonicalKey({
      title: 'T',
      company: 'C',
      location: 'Gothenburg',
    });
    expect(a).toBe(b);
  });
});

describe('deduplicateSourceRecords', () => {
  it('flags exact source identity matches', () => {
    const a = makeRecord({ sourceJobId: 'j1' });
    const b = makeRecord({ sourceJobId: 'j1' });
    expect(deduplicateSourceRecords(a, b)).toEqual({
      isDuplicate: true,
      confidence: 'exact',
      matchedKey: 'cinode:j1',
    });
  });

  it('normalizes application URLs', () => {
    expect(normalizeUrl('HTTPS://Example.com/jobs/42/')).toBe(
      'https://example.com/jobs/42',
    );
  });

  it('matches equivalent postings from two sources with candidate confidence', () => {
    const cinode = makeRecord({
      sourceName: 'cinode',
      sourceJobId: 'c-1',
      title: 'Frontend Developer',
      company: 'Volvo Cars',
      location: 'Göteborg',
      url: 'https://cinode.com/jobs/c-1',
    });
    const theirs = makeRecord({
      sourceName: 'theirstack',
      sourceJobId: 't-1',
      title: 'Frontend Developer',
      company: 'Volvo Cars',
      location: 'Gothenburg',
      url: 'https://theirstack.com/jobs/t-1',
    });
    expect(deduplicateSourceRecords(cinode, theirs)).toEqual({
      isDuplicate: true,
      confidence: 'candidate',
      matchedKey: 'frontend-developer:volvo-cars:gothenburg',
    });
  });

  it('is idempotent on repeated ingestion of the same record', () => {
    const r = makeRecord({ sourceJobId: 'j1' });
    expect(deduplicateSourceRecords(r, r)).toEqual(
      deduplicateSourceRecords(r, r),
    );
  });

  it('does not flag unrelated postings', () => {
    const a = makeRecord({
      sourceJobId: 'a-1',
      title: 'Backend Engineer',
      company: 'Acme Corp',
      url: 'https://example.com/jobs/a-1',
    });
    const b = makeRecord({
      sourceJobId: 'b-1',
      title: 'UX Designer',
      company: 'Globex',
      url: 'https://example.com/jobs/b-1',
    });
    expect(deduplicateSourceRecords(a, b).isDuplicate).toBe(false);
  });
});
