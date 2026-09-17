import type { SanitizedProfile } from './schema';

/**
 * Reconstructs a sanitized profile (job or candidate) into a plain,
 * standardized paragraph instead of raw JSON - JSON punctuation degrades
 * embedding similarity. Job ads and CVs are both rendered through this same
 * template under the same headers, which is what makes their vectors
 * comparable. The candidate's name is intentionally never passed in here:
 * it must not influence the embedded text.
 */
export function buildAnchorDocument(profile: SanitizedProfile): string {
  return [
    `JOB TITLE: ${profile.title}`,
    `TECHNICAL SKILLS: ${profile.requiredSkills.join(', ')}`,
    `SOFT SKILLS: ${profile.softSkills.join(', ')}`,
    `EXPERIENCE PROFILE: ${profile.experienceProfile}`,
    `CORE RESPONSIBILITIES: ${profile.coreResponsibilities.join('. ')}`,
  ].join('\n');
}
