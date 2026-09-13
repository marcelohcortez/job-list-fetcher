import { SKILL_PHRASES } from './skills';
import { containsPhrase, normalizeText, termFrequencies } from './tokenize';

export interface MatchableJob {
  id: string;
  title: string;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  publishedAt: string | null;
}

export interface CvMatch {
  jobId: string;
  score: number;
  titleHits: number;
  bodyMatches: number;
  matchedTerms: string[];
  matchedPhrases: string[];
  publishedAt: string | null;
}

export const TITLE_HIT_WEIGHT = 2;
export const BODY_HIT_WEIGHT = 1;
export const PHRASE_TITLE_WEIGHT = 6;
export const PHRASE_BODY_WEIGHT = 3;

export const KEEP_MIN_TITLE_HITS = 1;
export const KEEP_MIN_BODY_MATCHES = 3;
export const KEEP_MIN_SCORE = 8;

interface Accumulator {
  score: number;
  titleHits: number;
  bodyMatches: number;
}

function publishedTime(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function compareMatches(a: CvMatch, b: CvMatch): number {
  return (
    publishedTime(b.publishedAt) - publishedTime(a.publishedAt) ||
    b.score - a.score ||
    b.titleHits - a.titleHits ||
    a.jobId.localeCompare(b.jobId)
  );
}

export class CvMatcher {
  readonly cvTerms: ReadonlyMap<string, number>;
  readonly cvPhrases: readonly string[];

  constructor(cvText: string) {
    this.cvTerms = termFrequencies(cvText);
    const normalizedCv = normalizeText(cvText);
    this.cvPhrases = SKILL_PHRASES.filter((phrase) =>
      containsPhrase(normalizedCv, phrase),
    );
  }

  match(jobs: readonly MatchableJob[]): CvMatch[] {
    return jobs
      .map((job) => this.scoreJob(job))
      .filter((result) => this.include(result))
      .sort(compareMatches);
  }

  private scoreJob(job: MatchableJob): CvMatch {
    const title = normalizeText(job.title);
    const body = normalizeText(
      [job.description, job.requirements, job.benefits]
        .filter((part): part is string => Boolean(part))
        .join(' '),
    );

    const acc: Accumulator = { score: 0, titleHits: 0, bodyMatches: 0 };
    const matchedTerms: string[] = [];
    const matchedPhrases: string[] = [];

    for (const [term, frequency] of this.cvTerms) {
      const inTitle = containsPhrase(title, term);
      const inBody = containsPhrase(body, term);
      if (!inTitle && !inBody) continue;
      const boost = this.termBoost(frequency);
      if (inTitle) {
        acc.score += TITLE_HIT_WEIGHT * boost;
        acc.titleHits += 1;
      } else {
        acc.score += BODY_HIT_WEIGHT * boost;
        acc.bodyMatches += 1;
      }
      matchedTerms.push(term);
    }

    for (const phrase of this.cvPhrases) {
      if (containsPhrase(title, phrase)) {
        acc.score += PHRASE_TITLE_WEIGHT;
        acc.titleHits += 1;
        matchedPhrases.push(phrase);
      } else if (containsPhrase(body, phrase)) {
        acc.score += PHRASE_BODY_WEIGHT;
        acc.bodyMatches += 1;
        matchedPhrases.push(phrase);
      }
    }

    return {
      jobId: job.id,
      score: acc.score,
      titleHits: acc.titleHits,
      bodyMatches: acc.bodyMatches,
      matchedTerms,
      matchedPhrases,
      publishedAt: job.publishedAt,
    };
  }

  private termBoost(frequency: number): number {
    return Math.min(1 + Math.floor(Math.log2(frequency)), 3);
  }

  private include(result: CvMatch): boolean {
    return (
      result.titleHits >= KEEP_MIN_TITLE_HITS ||
      result.bodyMatches >= KEEP_MIN_BODY_MATCHES ||
      result.score >= KEEP_MIN_SCORE
    );
  }
}
