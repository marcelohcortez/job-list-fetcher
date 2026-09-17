import { describe, it, expect } from 'vitest';
import {
  matchesTargetTitle,
  matchesTargetLocation,
  isJobInScope,
} from '../src/target-filter';

describe('matchesTargetTitle', () => {
  it('matches exact target roles and seniority-prefixed variants', () => {
    expect(matchesTargetTitle('Senior Full-Stack Developer')).toBe(true);
    expect(matchesTargetTitle('Lead Frontend Developer')).toBe(true);
    expect(matchesTargetTitle('Full-Stack Tech Lead')).toBe(true);
    expect(matchesTargetTitle('Software Engineer')).toBe(true);
    expect(matchesTargetTitle('Software Engineering Manager')).toBe(true);
    expect(matchesTargetTitle('Scrum Master')).toBe(true);
    expect(matchesTargetTitle('Headless CMS Architect')).toBe(true);
    expect(matchesTargetTitle('Technical Business Analyst')).toBe(true);
  });

  it('matches base full-stack and frontend roles without seniority', () => {
    expect(matchesTargetTitle('Full-Stack Developer')).toBe(true);
    expect(matchesTargetTitle('Fullstack Developer')).toBe(true);
    expect(matchesTargetTitle('Full Stack Developer')).toBe(true);
    expect(matchesTargetTitle('Frontend Developer')).toBe(true);
    expect(matchesTargetTitle('Frontend Engineer')).toBe(true);
    expect(matchesTargetTitle('Frontend Architect')).toBe(true);
  });

  it('treats frontend and full-stack spelling variants identically', () => {
    expect(matchesTargetTitle('Front-End Developer')).toBe(true);
    expect(matchesTargetTitle('Front End Developer')).toBe(true);
    expect(matchesTargetTitle('Senior Front-End Developer')).toBe(true);
    expect(matchesTargetTitle('Senior Frontend Developer')).toBe(true);
    expect(matchesTargetTitle('Senior Fullstack Developer')).toBe(true);
    expect(matchesTargetTitle('Front-End Tech Lead')).toBe(true);
  });

  it('treats hyphenated and spaced spellings identically', () => {
    expect(matchesTargetTitle('Senior Full Stack Developer')).toBe(true);
    expect(matchesTargetTitle('Senior  Full-Stack   Developer')).toBe(true);
    expect(matchesTargetTitle('Lead Full Stack Tech Lead')).toBe(true);
  });

  it('does not match on partial or unrelated role phrases', () => {
    expect(matchesTargetTitle('Customer Success Specialist')).toBe(false);
    expect(matchesTargetTitle('Biomedicinsk analytiker')).toBe(false);
    expect(matchesTargetTitle('Sales Representative')).toBe(false);
    expect(matchesTargetTitle('Principal Product Manager')).toBe(false);
  });

  it('matches a target role with its generic suffix word dropped', () => {
    expect(matchesTargetTitle('Customer Enablement')).toBe(true);
    expect(matchesTargetTitle('AI Enablement')).toBe(true);
    expect(matchesTargetTitle('Technical Account')).toBe(true);
  });

  it('does not match a target role core phrase with a different suffix', () => {
    expect(matchesTargetTitle('Customer Enablement Manager')).toBe(false);
    expect(matchesTargetTitle('Technical Account Specialist')).toBe(false);
  });

  it('rejects empty titles', () => {
    expect(matchesTargetTitle('')).toBe(false);
    expect(matchesTargetTitle('   ')).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(matchesTargetTitle('senior software engineer')).toBe(true);
  });

  it('matches curated Swedish role phrases', () => {
    expect(matchesTargetTitle('Systemutvecklare')).toBe(true);
    expect(matchesTargetTitle('Mjukvaruutvecklare')).toBe(true);
    expect(
      matchesTargetTitle('Android-utvecklare till produktnära teknikbolag'),
    ).toBe(true);
    expect(matchesTargetTitle('Senior DevOps-ingenjör')).toBe(true);
    expect(matchesTargetTitle('Lösningsarkitekt')).toBe(true);
  });

  it('matches any hyphenated compound ending in utvecklare or konsult', () => {
    expect(matchesTargetTitle('PHP-utvecklare till kund')).toBe(true);
    expect(
      matchesTargetTitle('Interim SAP SuccessFactors-konsult – POSTNORD'),
    ).toBe(true);
  });

  it('does not match unrelated Swedish engineering/trade titles', () => {
    expect(matchesTargetTitle('Mekanikkonstruktör till försvarsbolag')).toBe(
      false,
    );
    expect(
      matchesTargetTitle('Testingenjör inom avancerad elektronik'),
    ).toBe(false);
    expect(
      matchesTargetTitle(
        'Provledare/elektroingenjör till innovativt bolag',
      ),
    ).toBe(false);
    expect(matchesTargetTitle('Elkonstruktör inom medicinteknik')).toBe(
      false,
    );
  });
});

describe('matchesTargetLocation', () => {
  it('accepts Gothenburg spellings', () => {
    expect(matchesTargetLocation('Gothenburg')).toBe(true);
    expect(matchesTargetLocation('Göteborg')).toBe(true);
    expect(matchesTargetLocation('Goteborg')).toBe(true);
    expect(matchesTargetLocation('Gothenburg, Sweden')).toBe(true);
    expect(matchesTargetLocation('GBG')).toBe(true);
  });

  it('accepts remote and Europe/EMEA-wide postings', () => {
    expect(matchesTargetLocation('Remote')).toBe(true);
    expect(matchesTargetLocation('Global Remote')).toBe(true);
    expect(matchesTargetLocation('Remote - EMEA')).toBe(true);
    expect(matchesTargetLocation('Remote - Europe')).toBe(true);
    expect(matchesTargetLocation('Remote - Germany')).toBe(true);
    expect(matchesTargetLocation('Remote within Sweden')).toBe(true);
    expect(matchesTargetLocation('Global Europe')).toBe(true);
    expect(matchesTargetLocation('Europe')).toBe(true);
    expect(matchesTargetLocation('EMEA')).toBe(true);
    expect(matchesTargetLocation('Global EMEA')).toBe(true);
  });

  it('rejects remote roles tied to non-European regions', () => {
    expect(matchesTargetLocation('Remote - Canada')).toBe(false);
    expect(matchesTargetLocation('Remote - Ontario')).toBe(false);
    expect(matchesTargetLocation('Remote - Toronto')).toBe(false);
    expect(matchesTargetLocation('Remote (U.S.)')).toBe(false);
    expect(matchesTargetLocation('U.S. Remote')).toBe(false);
    expect(matchesTargetLocation('Remote - US')).toBe(false);
    expect(matchesTargetLocation('Remote - Dallas, TX')).toBe(false);
    expect(matchesTargetLocation('Remote - Massachusetts - Boston')).toBe(
      false,
    );
    expect(matchesTargetLocation('Remote - New York, NY')).toBe(false);
    expect(matchesTargetLocation('Remote (APAC)')).toBe(false);
    expect(matchesTargetLocation('Argentina Remote')).toBe(false);
    expect(matchesTargetLocation('Remote - India')).toBe(false);
    expect(matchesTargetLocation('Remote - Israel')).toBe(false);
    expect(
      matchesTargetLocation(
        'Remote-Friendly (Travel-Required) | San Francisco, CA',
      ),
    ).toBe(false);
  });

  it('accepts remote roles tied to EMEA locations', () => {
    expect(matchesTargetLocation('Remote - France - Paris')).toBe(true);
    expect(matchesTargetLocation('Remote - Germany - Berlin')).toBe(true);
    expect(
      matchesTargetLocation('Home Based - Americas; Home based - EMEA'),
    ).toBe(true);
    expect(matchesTargetLocation('Remote - Lyon')).toBe(true);
    expect(matchesTargetLocation('Remote - United Kingdom - London')).toBe(
      true,
    );
    expect(matchesTargetLocation('Remote - Spain - Barcelona')).toBe(true);
  });

  it('rejects other locations and empty values', () => {
    expect(matchesTargetLocation('Stockholm')).toBe(false);
    expect(matchesTargetLocation('Malmö')).toBe(false);
    expect(matchesTargetLocation('New York')).toBe(false);
    expect(matchesTargetLocation('')).toBe(false);
  });
});

describe('isJobInScope', () => {
  it('requires both title and location to match', () => {
    expect(isJobInScope('Software Engineer', 'Gothenburg')).toBe(true);
    expect(isJobInScope('Software Engineer', 'Remote')).toBe(true);
    expect(isJobInScope('Software Engineer', 'New York')).toBe(false);
    expect(isJobInScope('Biomedicinsk analytiker', 'Gothenburg')).toBe(false);
  });
});
