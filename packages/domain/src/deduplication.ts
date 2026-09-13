import type { SourceRecord } from './types';
import { canonicalizeLocation, matchLocations } from './location-matcher';

export type MatchConfidence = 'exact' | 'candidate';

export interface MatchResult {
  isDuplicate: boolean;
  confidence?: MatchConfidence;
  matchedKey?: string;
}

const sanitize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');

export function exactKey(
  record: Pick<SourceRecord, 'sourceName' | 'sourceJobId'>,
): string {
  return `${record.sourceName}:${record.sourceJobId}`;
}

export function normalizeUrl(url: string): string {
  if (!url) return '';
  return url.trim().toLowerCase().replace(/\/+$/, '');
}

export function calculateCanonicalKey(
  record: Pick<SourceRecord, 'title' | 'company' | 'location'>,
): string {
  const title = sanitize(record.title);
  const company = sanitize(record.company);
  const location = sanitize(canonicalizeLocation(record.location));
  return `${title}:${company}:${location}`;
}

export function deduplicateSourceRecords(
  a: SourceRecord,
  b: SourceRecord,
): MatchResult {
  if (
    a.sourceName === b.sourceName &&
    a.sourceJobId !== null &&
    a.sourceJobId === b.sourceJobId
  ) {
    return { isDuplicate: true, confidence: 'exact', matchedKey: exactKey(a) };
  }

  const urlA = normalizeUrl(a.url);
  const urlB = normalizeUrl(b.url);
  if (urlA && urlB && urlA === urlB) {
    return { isDuplicate: true, confidence: 'candidate', matchedKey: urlA };
  }

  const titleMatch = sanitize(a.title) === sanitize(b.title);
  const companyMatch = sanitize(a.company) === sanitize(b.company);
  const locationMatch = matchLocations(a.location, b.location);
  if (titleMatch && companyMatch && locationMatch) {
    return {
      isDuplicate: true,
      confidence: 'candidate',
      matchedKey: calculateCanonicalKey(a),
    };
  }

  return { isDuplicate: false };
}
