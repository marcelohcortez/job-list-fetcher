import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type {
  JobDb,
  JobRequiredSkillLabel,
  LayaVerdict,
  SkillRelationPartner,
  UserMark,
} from '@job-fetcher/database';
import {
  getCandidateSkillIds,
  getJobById,
  getJobRequiredSkillLabels,
  getJobRoleCategories,
  getJobSeniorityLevels,
  getLayaEvaluationsForCandidate,
  getSkillRelationsFor,
  getCandidate,
  listCandidates,
  getUserMarks,
  getSentCvIds,
} from '@job-fetcher/database';
import { matchJobsForCandidate, type SemanticPipeline } from '@job-fetcher/semantic-match';
import type { JobOpening, RoleCategory, SeniorityLevel } from '@job-fetcher/domain';
import { areRoleCategoriesCompatible, areSeniorityLevelsCompatible } from '@job-fetcher/domain';

export interface MatchesConfig {
  /** Max jobs to consider per candidate. Omit for no limit. */
  topK?: number;
  /**
   * Minimum blended match score (see `blendScore`) for a job to count as a
   * match at all.
   */
  minSimilarity: number;
  /**
   * Weight (0-1) given to explicit required-skill coverage in the final
   * score, with the remainder given to whole-document embedding similarity.
   * A job with no extracted required skills falls back to pure similarity -
   * see `blendScore`. See ADR 0009 for why the blend replaced raw cosine
   * similarity: a shared vocabulary of generic domain words (e.g. "IT",
   * "engineer", "cloud") let two very different roles score deceptively
   * high on similarity alone. Defaults to 0.6 when omitted.
   */
  skillOverlapWeight?: number;
  /**
   * Multiplier applied to the blended score when the job's and candidate's
   * role categories (see `categorizeRoleTitle` in `@job-fetcher/domain`) are
   * both known and not compatible - e.g. a `design`-categorized CV against a
   * `product-management` job. Unknown categories on either side are never
   * penalized. See ADR 0012. Defaults to 0.5 when omitted.
   */
  roleMismatchPenalty?: number;
  /**
   * Multiplier applied to the blended score when the job has zero extracted
   * required skills, so scoring falls back to whole-document semantic
   * similarity alone - the least reliable signal (see "Known limitations" in
   * Docs/matching_pipeline.md). Defaults to 0.75 when omitted.
   */
  noRequiredSkillsPenalty?: number;
  /**
   * Multiplier applied to the blended score when the job's and candidate's
   * seniority levels (see `categorizeSeniority` in `@job-fetcher/domain`) are
   * both known and more than one step apart - e.g. a `junior` CV against a
   * `lead-principal` posting. Unknown levels on either side are never
   * penalized. Added during the 2026-09-22 matching-quality audit: nothing
   * in the scoring pipeline checked seniority level at all, so a junior CV
   * could outscore a senior-only posting on skill/similarity overlap alone.
   * Defaults to 0.7 when omitted.
   */
  seniorityMismatchPenalty?: number;
  /**
   * Number of required skills a job needs before `skillCoverage` is trusted
   * at full weight. `skillCoverage` is a ratio, so a job with only 1 required
   * skill that happens to match scores a perfect `1.0` - as strong a signal,
   * by the raw formula, as a job where 10/10 matched - even though one
   * lucky-looking match is far weaker evidence of real fit. Below this
   * count, `skillOverlapWeight` is scaled down proportionally
   * (`jobSkills.length / minSkillsForFullConfidence`) and the remainder
   * shifts to semantic similarity, which cannot be similarly gamed by a
   * single skill. Added during the 2026-09-22 matching-quality audit.
   * Defaults to 3 when omitted.
   */
  minSkillsForFullConfidence?: number;
  /**
   * Weight (0-1) given to Laya's evaluation score in the final blend, on top
   * of the existing skill-coverage/semantic-similarity terms (see
   * Docs/laya-integration-plan.md, Decision 3: additive, current pipeline
   * stays the dominant base). A pair with no persisted Laya evaluation yet
   * falls back to the current two-term blend, renormalized so it isn't
   * unfairly docked for missing data. Defaults to 0.3 when omitted.
   */
  layaWeight?: number;
}

const DEFAULT_SKILL_OVERLAP_WEIGHT = 0.6;
const DEFAULT_ROLE_MISMATCH_PENALTY = 0.5;
const DEFAULT_NO_REQUIRED_SKILLS_PENALTY = 0.75;
const DEFAULT_SENIORITY_MISMATCH_PENALTY = 0.7;
const DEFAULT_MIN_SKILLS_FOR_FULL_CONFIDENCE = 3;
const DEFAULT_LAYA_WEIGHT = 0.3;

type JobWithSimilarity = Omit<JobOpening, 'rawPayload'> & {
  similarity: number;
  baseScore: number;
  semanticSimilarity: number;
  skillCoverage: number | null;
  matchedSkillCount: number;
  requiredSkillCount: number;
  matchedSkills: string[];
  missingSkills: string[];
  layaScore: number | null;
  layaChoice: LayaVerdict | null;
  layaReasoning: string | null;
  layaMismatchReasoning: string | null;
  layaTruncated: boolean;
  userMark: UserMark | null;
  seenAt: string | null;
  sentCvIds: string[];
};

function publicJob(
  job: JobOpening,
  score: {
    similarity: number;
    baseScore: number;
    semanticSimilarity: number;
    skillCoverage: number | null;
    matchedSkillCount: number;
    requiredSkillCount: number;
    matchedSkills: string[];
    missingSkills: string[];
    layaScore: number | null;
    layaChoice: LayaVerdict | null;
    layaReasoning: string | null;
    layaMismatchReasoning: string | null;
    layaTruncated: boolean;
  },
  mark: {
    userMark: UserMark | null;
    seenAt: string | null;
    sentCvIds: string[];
  },
): JobWithSimilarity {
  const { rawPayload, ...rest } = job;
  return { ...rest, ...score, ...mark };
}

/**
 * Blends required-skill coverage (how well the candidate's skills cover the
 * job's canonical required skills) with whole-document embedding
 * similarity. Skill coverage dominates the score when the job has any
 * extracted required skills, since it's a more direct signal than a
 * similarity that can be inflated by shared boilerplate/domain vocabulary.
 *
 * Coverage is exact canonical-id equality, or a curated relation
 * (`skill_relations`) when there's no exact match - e.g. a candidate's
 * "Stakeholder Management" credits a job's "Customer-facing Experience"
 * requirement via a hand-reviewed relation, not computed similarity. An
 * embedding-similarity-based version of this was tried and reverted:
 * calibrated against the real skill vocabulary, embedding similarity
 * between short skill phrases doesn't reliably separate genuinely related
 * pairs from generic-vocabulary collisions ("Communication", "Collaboration"
 * sit close to nearly everything) - it reintroduced the exact false-positive
 * problem ADR 0009 was written to fix, just at the skill level instead of
 * the whole-document level. Curated relations trade automation for
 * reliability: no signal for a pair nobody has reviewed, but no noise
 * either. See the 2026-09-15/16 matches-scoring discussion and
 * Docs/adr/0009.
 *
 * Three further discounts are applied on top of the skill/similarity blend,
 * since none of the signals above ever check *what kind* or *what level* of
 * role the job and candidate are for, and a ratio-based skill coverage
 * doesn't distinguish one lucky match from ten:
 *
 * - `roleMismatchPenalty` (ADR 0012) - both role categories are known and
 *   incompatible (e.g. a `design` CV against a `product-management` job).
 *   This is what catches the failure mode this ADR was written for: a
 *   Designer CV scoring 75% against a Product Manager opening purely on
 *   generic whole-document vocabulary overlap.
 * - `seniorityMismatchPenalty` - both seniority levels are known and more
 *   than one step apart (e.g. a `junior` CV against a `lead-principal`
 *   posting). Added during the 2026-09-22 matching-quality audit: role
 *   category checks *what kind* of role, but nothing checked *what level*.
 * - `noRequiredSkillsPenalty` - the job has zero extracted required skills,
 *   so scoring falls back to semantic similarity alone with no literal
 *   signal to check at all.
 *
 * A `minSkillsForFullConfidence` dampener also applies whenever a job has
 * *some* required skills but very few: `skillCoverage` is a ratio, so 1/1
 * looks as strong as 10/10 by the raw formula even though a single matching
 * skill is far weaker evidence of fit. Below the threshold,
 * `skillOverlapWeight` scales down proportionally and the shortfall goes to
 * semantic similarity instead - see the 2026-09-22 audit note in
 * Docs/matching_pipeline.md for the concrete case this fixes (a 1-required-
 * skill job outranking genuinely well-matched jobs with many overlapping
 * skills).
 */
function blendScore(
  semanticSimilarity: number,
  candidateSkillIds: ReadonlySet<string>,
  jobSkills: readonly JobRequiredSkillLabel[],
  skillOverlapWeight: number,
  skillRelations: ReadonlyMap<string, SkillRelationPartner[]>,
  roleCategories: {
    job: RoleCategory | null;
    candidate: RoleCategory | null;
    mismatchPenalty: number;
  },
  seniorityLevels: {
    job: SeniorityLevel | null;
    candidate: SeniorityLevel | null;
    mismatchPenalty: number;
  },
  noRequiredSkillsPenalty: number,
  minSkillsForFullConfidence: number,
  laya: { score: number | null; weight: number },
): {
  score: number;
  baseScore: number;
  skillCoverage: number | null;
  matchedSkillCount: number;
  matchedSkills: string[];
  missingSkills: string[];
} {
  const roleMultiplier = areRoleCategoriesCompatible(roleCategories.job, roleCategories.candidate)
    ? 1
    : roleCategories.mismatchPenalty;
  const seniorityMultiplier = areSeniorityLevelsCompatible(
    seniorityLevels.job,
    seniorityLevels.candidate,
  )
    ? 1
    : seniorityLevels.mismatchPenalty;
  const categoryMultiplier = roleMultiplier * seniorityMultiplier;
  // Only spend the LAYA_WEIGHT budget when this pair actually has a
  // persisted evaluation - otherwise its share folds back into whichever
  // signal it would have discounted, so a not-yet-evaluated pair isn't
  // unfairly docked a third of its score for missing data (see
  // Docs/laya-integration-plan.md "Scoring integration").
  const effectiveLayaWeight = laya.score !== null ? laya.weight : 0;
  const layaTerm = effectiveLayaWeight * (laya.score ?? 0);

  if (jobSkills.length === 0) {
    return {
      score:
        (semanticSimilarity * (1 - effectiveLayaWeight) + layaTerm) *
        categoryMultiplier *
        noRequiredSkillsPenalty,
      // Vector-only score, unaffected by `layaWeight` - what `score` would be
      // with no Laya evaluation, so the UI can show the two signals separately.
      baseScore: semanticSimilarity * categoryMultiplier * noRequiredSkillsPenalty,
      skillCoverage: null,
      matchedSkillCount: 0,
      matchedSkills: [],
      missingSkills: [],
    };
  }

  let totalCredit = 0;
  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of jobSkills) {
    if (candidateSkillIds.has(skill.id)) {
      totalCredit += 1;
      matched.push(skill.label);
      continue;
    }
    const relatedCredit = (skillRelations.get(skill.id) ?? []).reduce(
      (best, partner) =>
        candidateSkillIds.has(partner.skillId) ? Math.max(best, partner.weight) : best,
      0,
    );
    if (relatedCredit > 0) {
      totalCredit += relatedCredit;
      matched.push(skill.label);
    } else {
      missing.push(skill.label);
    }
  }

  const skillCoverage = totalCredit / jobSkills.length;
  const confidence = Math.min(1, jobSkills.length / minSkillsForFullConfidence);
  const effectiveSkillOverlapWeight = skillOverlapWeight * confidence;
  const semanticWeight = Math.max(0, 1 - effectiveSkillOverlapWeight - effectiveLayaWeight);
  const score =
    (effectiveSkillOverlapWeight * skillCoverage + semanticWeight * semanticSimilarity + layaTerm) *
    categoryMultiplier;
  // Same blend, recomputed with laya's weight folded back into semantic
  // similarity - i.e. what `score` would be with no Laya evaluation - so the
  // UI can show the skill/vector match and the Laya match separately.
  const baseSemanticWeight = Math.max(0, 1 - effectiveSkillOverlapWeight);
  const baseScore =
    (effectiveSkillOverlapWeight * skillCoverage + baseSemanticWeight * semanticSimilarity) *
    categoryMultiplier;
  return {
    score,
    baseScore,
    skillCoverage,
    matchedSkillCount: matched.length,
    matchedSkills: matched,
    missingSkills: missing,
  };
}

/**
 * Turns Laya's raw scores for one candidate into a within-shortlist
 * percentile rank (0 = worst evaluated pair, 1 = best, ties share their
 * average rank). Laya's absolute score is compressed into a narrow band
 * (~0.82-0.90) regardless of verdict, so as an absolute term it adds a
 * near-constant to every pair and cannot separate a good match from a bad
 * one; the ordering within a candidate's shortlist is the only part of it
 * that carries signal. With fewer than two evaluated pairs there is no
 * ordering to rank, so those pairs get no Laya term (weight folds back).
 */
function layaRankScores(evaluations: ReadonlyMap<string, { score: number }>): Map<string, number> {
  const ranks = new Map<string, number>();
  if (evaluations.size < 2) return ranks;
  const scores = [...evaluations.values()].map((evaluation) => evaluation.score);
  for (const [jobId, { score }] of evaluations) {
    const below = scores.filter((other) => other < score).length;
    const tied = scores.filter((other) => other === score).length;
    ranks.set(jobId, (below + (tied - 1) / 2) / (scores.length - 1));
  }
  return ranks;
}

async function matchesForCandidate(
  db: Kysely<JobDb>,
  pipeline: SemanticPipeline,
  config: MatchesConfig,
  candidateId: string,
): Promise<JobWithSimilarity[]> {
  const hits = await matchJobsForCandidate(pipeline, candidateId, config.topK);
  const candidateSkillIds = new Set(await getCandidateSkillIds(db, candidateId));
  const candidate = await getCandidate(db, candidateId);
  const candidateRoleCategory = (candidate?.role_category ?? null) as RoleCategory | null;
  const candidateSeniorityLevel = (candidate?.seniority_level ?? null) as SeniorityLevel | null;

  const entries = (
    await Promise.all(
      hits.map(async (hit) => {
        const job = await getJobById(db, hit.id);
        if (!job) return null;
        const jobSkills = await getJobRequiredSkillLabels(db, hit.id);
        return { hit, job, jobSkills };
      }),
    )
  ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  // One batched fetch covers every job skill this candidate's matches could
  // need a curated relation for.
  const jobSkillIds = new Set<string>();
  for (const entry of entries) {
    for (const skill of entry.jobSkills) jobSkillIds.add(skill.id);
  }
  const skillRelations = await getSkillRelationsFor(db, [...jobSkillIds]);
  const jobRoleCategories = await getJobRoleCategories(
    db,
    entries.map((entry) => entry.job.id),
  );
  const jobSeniorityLevels = await getJobSeniorityLevels(
    db,
    entries.map((entry) => entry.job.id),
  );
  const jobIds = entries.map((entry) => entry.job.id);
  const marks = await getUserMarks(db, jobIds);
  const sentCvs = await getSentCvIds(db, jobIds);
  const layaEvaluations = await getLayaEvaluationsForCandidate(db, candidateId, jobIds);
  const layaRanks = layaRankScores(layaEvaluations);

  const jobs: JobWithSimilarity[] = [];
  for (const { hit, job, jobSkills } of entries) {
    const layaEvaluation = layaEvaluations.get(job.id) ?? null;
    const jobRoleCategory = (jobRoleCategories.get(job.id) ?? null) as RoleCategory | null;
    const { score, baseScore, skillCoverage, matchedSkillCount, matchedSkills, missingSkills } =
      blendScore(
        hit.similarity,
        candidateSkillIds,
        jobSkills,
        config.skillOverlapWeight ?? DEFAULT_SKILL_OVERLAP_WEIGHT,
        skillRelations,
        {
          job: jobRoleCategory,
          candidate: candidateRoleCategory,
          mismatchPenalty: config.roleMismatchPenalty ?? DEFAULT_ROLE_MISMATCH_PENALTY,
        },
        {
          job: (jobSeniorityLevels.get(job.id) ?? null) as SeniorityLevel | null,
          candidate: candidateSeniorityLevel,
          mismatchPenalty: config.seniorityMismatchPenalty ?? DEFAULT_SENIORITY_MISMATCH_PENALTY,
        },
        config.noRequiredSkillsPenalty ?? DEFAULT_NO_REQUIRED_SKILLS_PENALTY,
        config.minSkillsForFullConfidence ?? DEFAULT_MIN_SKILLS_FOR_FULL_CONFIDENCE,
        { score: layaRanks.get(job.id) ?? null, weight: config.layaWeight ?? DEFAULT_LAYA_WEIGHT },
      );
    // `minSimilarity` gates the blended skill/vector/Laya score. Laya's
    // verdict gets no veto: it rates nearly every pair strong/moderate, so
    // letting it bypass the threshold surfaced 1-of-8-skill matches.
    if (score < config.minSimilarity) continue;
    jobs.push(
      publicJob(
        job,
        {
          similarity: score,
          baseScore,
          semanticSimilarity: hit.similarity,
          skillCoverage,
          matchedSkillCount,
          requiredSkillCount: jobSkills.length,
          matchedSkills,
          missingSkills,
          layaScore: layaEvaluation?.score ?? null,
          layaChoice: layaEvaluation?.choice ?? null,
          layaReasoning: layaEvaluation?.reasoning ?? null,
          layaMismatchReasoning: layaEvaluation?.mismatchReasoning ?? null,
          layaTruncated: layaEvaluation?.truncated ?? false,
        },
        {
          userMark: marks[job.id]?.mark ?? null,
          seenAt: marks[job.id]?.seenAt ?? null,
          sentCvIds: sentCvs[job.id] ?? [],
        },
      ),
    );
  }
  return jobs.sort((a, b) => b.similarity - a.similarity);
}

export function matchesRoutes(
  db: Kysely<JobDb>,
  pipeline: SemanticPipeline,
  config: MatchesConfig,
) {
  const app = new Hono();

  app.get('/', async (c) => {
    const candidates = (await listCandidates(db)).filter(
      (candidate) => candidate.status === 'sanitized',
    );
    const data = await Promise.all(
      candidates.map(async (candidate) => ({
        candidateId: candidate.id,
        candidateName: candidate.candidate_name,
        candidateTitle: candidate.candidate_title,
        fileName: candidate.file_name,
        matches: await matchesForCandidate(db, pipeline, config, candidate.id),
      })),
    );
    return c.json({ data });
  });

  app.get('/candidates/:id', async (c) => {
    const id = c.req.param('id');
    const candidate = await getCandidate(db, id);
    if (!candidate) return c.json({ error: 'not_found' }, 404);
    if (candidate.status !== 'sanitized') {
      return c.json({
        data: {
          candidateId: candidate.id,
          candidateName: candidate.candidate_name,
          candidateTitle: candidate.candidate_title,
          fileName: candidate.file_name,
          matches: [],
        },
      });
    }
    const matches = await matchesForCandidate(db, pipeline, config, id);
    return c.json({
      data: {
        candidateId: candidate.id,
        candidateName: candidate.candidate_name,
        candidateTitle: candidate.candidate_title,
        fileName: candidate.file_name,
        matches,
      },
    });
  });

  return app;
}
