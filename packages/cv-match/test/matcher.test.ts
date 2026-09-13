import { describe, it, expect } from 'vitest';
import {
  CvMatcher,
  KEEP_MIN_BODY_MATCHES,
  KEEP_MIN_SCORE,
  KEEP_MIN_TITLE_HITS,
  containsPhrase,
  normalizeText,
  termFrequencies,
  tokenize,
  type MatchableJob,
} from '../src';

const CV = `
  Anna Andersson
  Software Developer, 8 years
  Backend and cloud engineering with Node.js, TypeScript, Python.
  Data engineering: built data pipelines with Kafka and Spark, worked with PostgreSQL and Elasticsearch.
  Experience with Docker, Kubernetes, Terraform and CI/CD pipelines.
  Machine learning: trained models for forecasting and anomaly detection.
`;

function job(
  id: string,
  title: string,
  description: string | null = null,
  publishedAt: string | null = null,
): MatchableJob {
  return {
    id,
    title,
    description,
    requirements: null,
    benefits: null,
    publishedAt,
  };
}

describe('normalizeText / tokenize', () => {
  it('lowercases, strips punctuation, tags and collapses whitespace', () => {
    expect(normalizeText('<b>Full-Stack</b> / DevOps')).toBe(
      'full stack devops',
    );
  });

  it('drops stopwords and short tokens', () => {
    expect(tokenize('I work with and on a very Kubernetes platform')).toEqual([
      'kubernetes',
      'platform',
    ]);
  });

  it('counts term frequencies', () => {
    const freqs = termFrequencies('python python python sql sql');
    expect(freqs.get('python')).toBe(3);
    expect(freqs.get('sql')).toBe(2);
  });

  it('detects phrases with word boundaries', () => {
    expect(containsPhrase('machine learning models', 'machine learning')).toBe(
      true,
    );
    expect(containsPhrase('learning machines', 'machine learning')).toBe(false);
  });
});

describe('CvMatcher', () => {
  it('keeps only jobs above the inclusion threshold', () => {
    const matcher = new CvMatcher(CV);
    const results = matcher.match([
      job('neutral', 'Office Administrator', 'Administrative support tasks'),
      job('data', 'Data Engineer', ''),
    ]);
    const ids = results.map((r) => r.jobId);
    expect(ids).not.toContain('neutral');
    expect(ids).toContain('data');

    const scored = results.find((r) => r.jobId === 'data');
    expect(scored!.titleHits).toBeGreaterThanOrEqual(KEEP_MIN_TITLE_HITS);
  });

  it('weighs a title hit above a body hit for the same term', () => {
    const matcher = new CvMatcher(CV);
    const results = matcher.match([
      job('a', 'Analyst', 'Python, Docker and Kubernetes experience'),
      job('b', 'Python Developer', ''),
    ]);
    const titleMatch = results.find((r) => r.jobId === 'b');
    const bodyMatch = results.find((r) => r.jobId === 'a');
    expect(titleMatch!.score).toBeGreaterThan(bodyMatch!.score);
  });

  it('rewards skills mentioned repeatedly in the CV', () => {
    const repeated = new CvMatcher(
      'python python python python python software developer focused on python',
    );
    const once = new CvMatcher('python');
    const ranked = repeated.match([
      job('a', 'Python Developer', 'Strong python experience'),
    ]);
    const single = once.match([
      job('a', 'Python Developer', 'Strong python experience'),
    ]);
    expect(ranked[0].score).toBeGreaterThan(single[0].score);
  });

  it('rewards phrase matches in title over the same phrase in body', () => {
    const matcher = new CvMatcher(CV);
    const results = matcher.match([
      job('title', 'Machine Learning Engineer', ''),
      job('body', 'Analyst', 'Building machine learning models in production'),
    ]);
    const titleMatch = results.find((r) => r.jobId === 'title');
    const bodyMatch = results.find((r) => r.jobId === 'body');
    expect(titleMatch!.score).toBeGreaterThan(bodyMatch!.score);
  });

  it('reports matched terms and phrases', () => {
    const matcher = new CvMatcher(CV);
    const results = matcher.match([
      job(
        'a',
        'Data Engineer',
        'Kafka and Spark pipelines in a data engineering team',
      ),
    ]);
    const hit = results.find((r) => r.jobId === 'a');
    expect(hit!.matchedTerms).toContain('kafka');
    expect(hit!.matchedPhrases).toContain('data engineering');
    expect(hit!.bodyMatches).toBeGreaterThanOrEqual(KEEP_MIN_BODY_MATCHES);
    expect(hit!.score).toBeGreaterThanOrEqual(KEEP_MIN_SCORE);
  });

  it('is deterministic and sorted by newest published date, then score', () => {
    const matcher = new CvMatcher(CV);
    const jobs = [
      job('a', 'Data Engineer', 'Kafka, Spark', '2026-09-01T00:00:00.000Z'),
      job('b', 'Machine Learning Engineer', '', '2026-09-10T00:00:00.000Z'),
      job(
        'c',
        'Backend Cloud Engineer',
        'Node.js TypeScript Docker Kubernetes',
        '2026-09-05T00:00:00.000Z',
      ),
    ];
    const first = matcher.match(jobs);
    const second = matcher.match(jobs);
    expect(first.map((r) => r.jobId)).toEqual(second.map((r) => r.jobId));
    expect(first.map((r) => r.jobId)).toEqual(['b', 'c', 'a']);
    for (let i = 1; i < first.length; i += 1) {
      const prev = Date.parse(first[i - 1].publishedAt!);
      const next = Date.parse(first[i].publishedAt!);
      expect(prev).toBeGreaterThanOrEqual(next);
    }
  });

  it('places jobs without a publish date last', () => {
    const matcher = new CvMatcher(CV);
    const results = matcher.match([
      job('dated', 'Data Engineer', 'Kafka, Spark', '2026-09-01T00:00:00.000Z'),
      job('undated', 'Machine Learning Engineer', ''),
    ]);
    expect(results.map((r) => r.jobId)).toEqual(['dated', 'undated']);
    expect(results[results.length - 1].jobId).toBe('undated');
  });
});
