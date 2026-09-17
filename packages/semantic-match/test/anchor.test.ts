import { describe, it, expect } from 'vitest';
import { buildAnchorDocument } from '../src/anchor';

describe('buildAnchorDocument', () => {
  it('renders a plain header-labelled paragraph, not JSON', () => {
    const doc = buildAnchorDocument({
      title: 'Senior DevOps Engineer',
      requiredSkills: ['AWS', 'Docker', 'Kubernetes'],
      softSkills: ['communication'],
      experienceProfile: '4-6 years',
      coreResponsibilities: ['optimize infrastructure', 'own uptime'],
    });

    expect(doc).toBe(
      [
        'JOB TITLE: Senior DevOps Engineer',
        'TECHNICAL SKILLS: AWS, Docker, Kubernetes',
        'SOFT SKILLS: communication',
        'EXPERIENCE PROFILE: 4-6 years',
        'CORE RESPONSIBILITIES: optimize infrastructure. own uptime',
      ].join('\n'),
    );
    expect(doc).not.toContain('{');
  });

  it('produces identical structure for job and candidate profiles sharing the same fields', () => {
    const shared = {
      requiredSkills: ['Python'],
      softSkills: [],
      experienceProfile: '5 years',
      coreResponsibilities: ['build APIs'],
    };
    const jobDoc = buildAnchorDocument({ title: 'Backend Engineer', ...shared });
    const candidateDoc = buildAnchorDocument({
      title: 'Backend Engineer',
      ...shared,
    });
    expect(jobDoc).toBe(candidateDoc);
  });
});
