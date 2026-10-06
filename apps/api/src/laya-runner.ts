import type { Kysely } from 'kysely';
import type { JobDb } from '@job-fetcher/database';
import {
  getCandidate,
  getJobEmbeddingStatus,
  getJobRoleCategories,
  upsertLayaEvaluation,
} from '@job-fetcher/database';
import { areRoleCategoriesCompatible, type RoleCategory } from '@job-fetcher/domain';
import {
  matchCandidatesForJob,
  matchJobsForCandidate,
  type LayaClient,
  type SemanticPipeline,
} from '@job-fetcher/semantic-match';

/**
 * Ingestion-time Laya wiring (Docs/laya-integration-plan.md, Decision 4 /
 * Phase 3): run once, right after a job or CV is sanitized and inserted
 * into Chroma, against that item's freshly-queried top-K counterpart
 * shortlist. Never throws - a Laya call failing/timing out for one pair (or
 * Laya being unreachable entirely) is logged and leaves that pair
 * unevaluated rather than failing the ingestion it's attached to.
 */
/**
 * Skips Laya for pairs whose role categories are both known and
 * incompatible (e.g. `design` CV vs `engineering` job): such a pair is
 * already heavily penalized by the role-mismatch multiplier, and Laya's
 * verdict on it is uninformative (it rates almost everything strong or
 * moderate) while still costing an inference call. Unknown categories are
 * never skipped.
 */
function isRolePairCompatible(jobCategory: string | null, candidateCategory: string | null): boolean {
  return areRoleCategoriesCompatible(jobCategory as RoleCategory | null, candidateCategory as RoleCategory | null);
}

async function evaluatePair(
  db: Kysely<JobDb>,
  layaClient: LayaClient,
  jobOpeningId: string,
  jobText: string,
  candidateId: string,
  cvText: string,
): Promise<void> {
  try {
    const evaluation = await layaClient.evaluate({ jobText, cvText });
    await upsertLayaEvaluation(db, {
      jobOpeningId,
      candidateId,
      score: evaluation.score,
      choice: evaluation.choice,
      reasoning: evaluation.reasoning,
      mismatchReasoning: evaluation.mismatchReasoning,
      truncated: evaluation.truncated,
    });
  } catch (err) {
    console.warn(
      `[laya] Evaluation failed for job ${jobOpeningId} / candidate ${candidateId}: ` +
        `${(err as Error).message}`,
    );
  }
}

export async function evaluateLayaForNewJob(
  db: Kysely<JobDb>,
  pipeline: SemanticPipeline,
  layaClient: LayaClient,
  jobOpeningId: string,
  jobAnchorDocument: string,
  topK: number,
): Promise<void> {
  const hits = await matchCandidatesForJob(pipeline, jobOpeningId, topK);
  const jobCategory = (await getJobRoleCategories(db, [jobOpeningId])).get(jobOpeningId) ?? null;
  for (const hit of hits) {
    const candidate = await getCandidate(db, hit.id);
    if (!candidate?.anchor_document) continue;
    if (!isRolePairCompatible(jobCategory, candidate.role_category)) continue;
    await evaluatePair(db, layaClient, jobOpeningId, jobAnchorDocument, hit.id, candidate.anchor_document);
  }
}

export async function evaluateLayaForNewCandidate(
  db: Kysely<JobDb>,
  pipeline: SemanticPipeline,
  layaClient: LayaClient,
  candidateId: string,
  candidateAnchorDocument: string,
  topK: number,
): Promise<void> {
  const hits = await matchJobsForCandidate(pipeline, candidateId, topK);
  const candidateCategory = (await getCandidate(db, candidateId))?.role_category ?? null;
  for (const hit of hits) {
    const jobEmbedding = await getJobEmbeddingStatus(db, hit.id);
    if (!jobEmbedding?.anchor_document) continue;
    if (!isRolePairCompatible(jobEmbedding.role_category, candidateCategory)) continue;
    await evaluatePair(
      db,
      layaClient,
      hit.id,
      jobEmbedding.anchor_document,
      candidateId,
      candidateAnchorDocument,
    );
  }
}
