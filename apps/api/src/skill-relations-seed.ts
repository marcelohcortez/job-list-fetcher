import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { normalizeSkillLabel } from '@job-fetcher/domain';
import {
  findSkillByNormalizedLabel,
  insertSkillIfNew,
  insertSkillRelationIfNew,
  type JobDb,
  type SkillRelationType,
} from '@job-fetcher/database';
import type { VectorStore } from '@job-fetcher/semantic-match';

export type Embed = (text: string) => Promise<number[]>;

interface SkillRelationSeed {
  a: string;
  b: string;
  type: SkillRelationType;
  weight: number;
}

/**
 * Curated equivalence/adjacency pairs between skills that real candidates
 * and job ads describe under different names. This is a deliberately
 * hand-maintained starting set, not a computed one - see Docs/adr/0009 for
 * why an embedding-similarity-based version of this was tried and reverted
 * (it couldn't reliably separate genuinely related pairs from generic-
 * vocabulary collisions on the real skill vocabulary). Grow this list as
 * real gaps are found; each entry should be reviewable at a glance.
 *
 * `weight` is what scoring actually uses (see blendScore in
 * apps/api/src/routes/matches.ts); `type` is descriptive/for-review.
 * 'equivalent' pairs are near-synonyms (~0.85-1.0); 'related' pairs are
 * adjacent but distinct skills, credited lower (~0.5-0.7) since holding one
 * doesn't fully substitute for the other.
 */
export const SKILL_RELATION_SEEDS: readonly SkillRelationSeed[] = [
  // Customer-facing / relationship-management cluster
  { a: 'Stakeholder Management', b: 'Client Relationship Management', type: 'equivalent', weight: 0.9 },
  { a: 'Stakeholder Management', b: 'Customer-facing Experience', type: 'related', weight: 0.7 },
  { a: 'Client Relationship Management', b: 'Customer-facing Experience', type: 'equivalent', weight: 0.9 },
  { a: 'Account Management', b: 'Client Relationship Management', type: 'related', weight: 0.7 },
  { a: 'Relationship Building', b: 'Stakeholder Management', type: 'equivalent', weight: 0.9 },
  { a: 'Relationship Building', b: 'Customer-facing Experience', type: 'related', weight: 0.7 },
  { a: 'Cross-functional Communication', b: 'Stakeholder Management', type: 'related', weight: 0.6 },
  { a: 'Customer Success', b: 'Customer-facing Experience', type: 'equivalent', weight: 0.9 },
  { a: 'Technical Account Management', b: 'Client Relationship Management', type: 'related', weight: 0.6 },

  // Sales/solutions engineering cluster
  { a: 'Presales', b: 'Sales Engineering', type: 'equivalent', weight: 0.9 },
  { a: 'Sales Engineering', b: 'Solutions Engineering', type: 'equivalent', weight: 0.9 },
  { a: 'Technical Consulting', b: 'Solutions Engineering', type: 'related', weight: 0.6 },

  // Delivery/process cluster
  { a: 'Project Coordination', b: 'Project Management', type: 'related', weight: 0.7 },
  { a: 'Requirements Analysis', b: 'Business Analysis', type: 'related', weight: 0.6 },
  { a: 'Agile', b: 'Scrum', type: 'related', weight: 0.6 },

  // Infra/platform cluster
  { a: 'DevOps', b: 'Site Reliability Engineering', type: 'related', weight: 0.6 },
  { a: 'DevSecOps', b: 'DevOps', type: 'related', weight: 0.7 },

  // Full-stack overlap
  { a: 'Full-Stack Development', b: 'Frontend Development', type: 'related', weight: 0.5 },
  { a: 'Full-Stack Development', b: 'Backend Development', type: 'related', weight: 0.5 },

  // Sentence-style skill extractions the sanitizer LLM still occasionally
  // produces despite the atomic-skill instruction (see schema.ts's
  // requiredSkills description) - each `a` here is a verbatim label found
  // in `job_required_skills` post-backfill that duplicates or paraphrases
  // an already-atomic skill, so a candidate holding only the atomic form
  // got zero credit against it. Curated by hand against the real extracted
  // vocabulary rather than fixed by further prompt tuning - see this file's
  // top comment and ADR 0009 on why curated relations beat computed
  // skill-level matching here.
  { a: 'Understanding of testing practices and software quality principles', b: 'Testing practices', type: 'equivalent', weight: 0.95 },
  { a: 'Experience with testing practices', b: 'Testing practices', type: 'equivalent', weight: 0.95 },
  { a: 'Software quality principles', b: 'Testing practices', type: 'equivalent', weight: 0.9 },
  // Holding a specific test tool/discipline is treated as practical evidence
  // of "testing practices" generally - 'related' rather than 'equivalent'
  // since naming Jest doesn't prove e.g. TDD discipline and vice versa, but
  // each is real signal a job asking generically for "testing practices"
  // shouldn't zero-credit.
  { a: 'Jest', b: 'Testing practices', type: 'related', weight: 0.6 },
  { a: 'Playwright', b: 'Testing practices', type: 'related', weight: 0.6 },
  { a: 'Vitest', b: 'Testing practices', type: 'related', weight: 0.6 },
  { a: 'E2E Testing', b: 'Testing practices', type: 'related', weight: 0.7 },
  { a: 'TDD', b: 'Testing practices', type: 'related', weight: 0.7 },
  { a: 'Test-Driven Development', b: 'TDD', type: 'equivalent', weight: 0.95 },
  { a: 'Familiarity with CI/CD workflows and developer tooling', b: 'CI/CD', type: 'equivalent', weight: 0.85 },
  { a: 'Familiarity with GitLab CI/CD pipelines', b: 'CI/CD', type: 'equivalent', weight: 0.85 },
  { a: 'Familiarity with GitLab CI/CD pipelines', b: 'GitLab', type: 'related', weight: 0.6 },
  { a: 'Experience with GitHub Workflows and GitHub Actions', b: 'CI/CD', type: 'equivalent', weight: 0.8 },
  { a: 'Experience with Shell', b: 'Bash', type: 'equivalent', weight: 0.85 },
  { a: 'Solid understanding of relational database fundamentals', b: 'Relational databases', type: 'equivalent', weight: 0.9 },
  { a: 'Solid understanding of relational database fundamentals', b: 'SQL', type: 'related', weight: 0.7 },
  { a: 'Solid understanding of the Linux system architecture', b: 'Linux', type: 'equivalent', weight: 0.85 },
  { a: 'Experience with RHEL and RPM-based deployments', b: 'Linux', type: 'related', weight: 0.6 },
  { a: 'Experience with database technologies, preferably SQL and graph databases', b: 'SQL', type: 'related', weight: 0.6 },
  { a: 'Understanding of network protocols such as IPv4, IPv6, UDP, TCP, TLS and HTTP', b: 'Networking', type: 'related', weight: 0.6 },
  { a: 'Experience with at least one container management/orchestration tool (e.g. Docker, Kubernetes, etc.)', b: 'Docker', type: 'related', weight: 0.6 },
  { a: 'Experience with at least one container management/orchestration tool (e.g. Docker, Kubernetes, etc.)', b: 'Kubernetes', type: 'related', weight: 0.6 },
  { a: 'Experience with JavaScript and WebAssembly', b: 'JavaScript', type: 'related', weight: 0.6 },
  { a: 'Experience with REST APIs, asynchronous processing and integration patterns', b: 'API design', type: 'related', weight: 0.5 },
  { a: 'Hands-on experience building scalable, maintainable APIs', b: 'API design', type: 'related', weight: 0.5 },
  { a: 'Experience with server-side application development', b: 'Backend Development', type: 'equivalent', weight: 0.85 },

  // Specific RDBMS vs. generic requirement phrasing - a job asking for
  // "relational databases" generically is satisfied by naming any specific
  // relational engine, same reasoning as the Full-Stack/Frontend/Backend
  // cluster above.
  { a: 'PostgreSQL', b: 'Relational databases', type: 'related', weight: 0.7 },
  { a: 'MySQL', b: 'Relational databases', type: 'related', weight: 0.7 },
  { a: 'PostgreSQL', b: 'Database design fundamentals', type: 'related', weight: 0.5 },
  { a: 'MySQL', b: 'Database design fundamentals', type: 'related', weight: 0.5 },
];

function normalize(label: string): string {
  return normalizeSkillLabel(label);
}

/**
 * Resolves a seed's plain-text label to a skill id, creating (and
 * embedding) the skill if it doesn't exist yet - mirrors
 * `createSkillCanonicalizer`'s creation path so a seeded skill behaves
 * identically to one discovered through normal ingestion (findable via
 * `queryNearestSkill`, not a silent duplicate).
 */
async function resolveSkillId(
  db: Kysely<JobDb>,
  vectorStore: VectorStore,
  embed: Embed,
  label: string,
): Promise<string> {
  const normalized = normalize(label);
  const existing = await findSkillByNormalizedLabel(db, normalized);
  if (existing) return existing.id;

  const id = randomUUID();
  const inserted = await insertSkillIfNew(db, {
    id,
    canonicalLabel: label,
    normalizedLabel: normalized,
    createdAt: new Date().toISOString(),
  });
  if (!inserted) {
    // Lost a race with a concurrent insert of the same normalized label.
    const raced = await findSkillByNormalizedLabel(db, normalized);
    if (raced) return raced.id;
    throw new Error(`Failed to resolve or create skill "${label}"`);
  }
  const embedding = await embed(normalized);
  await vectorStore.upsertSkill(inserted.id, embedding, normalized);
  return inserted.id;
}

/**
 * Seeds `SKILL_RELATION_SEEDS` into the database. Idempotent - safe to call
 * on every startup, like `seedTargetRolePhrases`.
 */
export async function seedSkillRelations(
  db: Kysely<JobDb>,
  vectorStore: VectorStore,
  embed: Embed,
): Promise<void> {
  for (const seed of SKILL_RELATION_SEEDS) {
    const idA = await resolveSkillId(db, vectorStore, embed, seed.a);
    const idB = await resolveSkillId(db, vectorStore, embed, seed.b);

    await insertSkillRelationIfNew(db, {
      id: randomUUID(),
      skillIdA: idA,
      skillIdB: idB,
      relationType: seed.type,
      weight: seed.weight,
      createdAt: new Date().toISOString(),
    });
    await insertSkillRelationIfNew(db, {
      id: randomUUID(),
      skillIdA: idB,
      skillIdB: idA,
      relationType: seed.type,
      weight: seed.weight,
      createdAt: new Date().toISOString(),
    });
  }
}
