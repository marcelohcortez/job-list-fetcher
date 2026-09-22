import { describe, it, expect } from 'vitest';
import { categorizeSeniority, areSeniorityLevelsCompatible } from '../src/seniority';

describe('categorizeSeniority', () => {
  it('classifies from title keywords', () => {
    expect(categorizeSeniority('Senior Software Engineer', '')).toBe('senior');
    expect(categorizeSeniority('Junior Developer', '')).toBe('junior');
    expect(categorizeSeniority('Principal Engineer', '')).toBe('lead-principal');
    expect(categorizeSeniority('Tech Lead', '')).toBe('lead-principal');
  });

  it('prefers the more specific title cue over a later-matching one', () => {
    expect(categorizeSeniority('Senior Principal Engineer', '')).toBe('lead-principal');
  });

  it('falls back to years-of-experience in experienceProfile when the title has no cue', () => {
    expect(categorizeSeniority('Software Engineer', '5+ years of experience required')).toBe(
      'senior',
    );
    expect(categorizeSeniority('Software Engineer', '10 years of experience')).toBe(
      'lead-principal',
    );
    expect(categorizeSeniority('Software Engineer', '1 year of experience')).toBe('junior');
  });

  it('parses non-English years cues (digits are locale-invariant)', () => {
    expect(categorizeSeniority('Systemutvecklare', 'Minst 3 års erfarenhet av utveckling')).toBe(
      'mid',
    );
  });

  it('returns null when neither title nor experience profile carries a signal', () => {
    expect(categorizeSeniority('Software Engineer', 'Relevant degree required')).toBeNull();
    expect(categorizeSeniority('', '')).toBeNull();
  });
});

describe('areSeniorityLevelsCompatible', () => {
  it('treats equal levels as compatible', () => {
    expect(areSeniorityLevelsCompatible('senior', 'senior')).toBe(true);
  });

  it('treats one step apart as compatible', () => {
    expect(areSeniorityLevelsCompatible('mid', 'senior')).toBe(true);
    expect(areSeniorityLevelsCompatible('junior', 'mid')).toBe(true);
  });

  it('treats a skip-level gap as incompatible', () => {
    expect(areSeniorityLevelsCompatible('junior', 'senior')).toBe(false);
    expect(areSeniorityLevelsCompatible('junior', 'lead-principal')).toBe(false);
  });

  it('treats unknown levels as always compatible', () => {
    expect(areSeniorityLevelsCompatible(null, 'lead-principal')).toBe(true);
    expect(areSeniorityLevelsCompatible('junior', null)).toBe(true);
  });
});
