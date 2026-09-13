import { describe, it, expect } from 'vitest';
import {
  normalizeLocation,
  canonicalizeLocation,
  matchLocations,
} from '../src/location-matcher';

describe('location matcher', () => {
  it('normalizes accents correctly', () => {
    expect(normalizeLocation('GÖTEBORG')).toBe('goteborg');
    expect(normalizeLocation('Gothenburg')).toBe('gothenburg');
  });

  it('canonicalizes Göteborg to gothenburg', () => {
    expect(canonicalizeLocation('Göteborg')).toBe('gothenburg');
    expect(canonicalizeLocation('GÖTEBORG')).toBe('gothenburg');
    expect(canonicalizeLocation('Gothenburg')).toBe('gothenburg');
  });

  it('matches Göteborg and Gothenburg case- and accent-insensitively', () => {
    expect(matchLocations('Gothenburg', 'gothenburg')).toBe(true);
    expect(matchLocations('Göteborg', 'Gothenburg')).toBe(true);
    expect(matchLocations('GÖTEBORG', 'gothenburg')).toBe(true);
  });

  it('handles whitespace and phonetic variants', () => {
    expect(matchLocations('  go the borg  ', 'gothenburg')).toBe(true);
    expect(matchLocations('  Göteborg  ', '  Gothenburg')).toBe(true);
  });

  it('does not match unrelated locations', () => {
    expect(matchLocations('Stockholm', 'Gothenburg')).toBe(false);
  });
});
