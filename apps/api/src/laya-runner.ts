import type { Kysely } from 'kysely';
import type { JobDb } from '@job-fetcher/database';
import { getCandidate, getJobEmbeddingStatus, upsertLayaEvaluation } from '@job-fetcher/database';
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
  for (const hit of hits) {
    const candidate = await getCandidate(db, hit.id);
    if (!candidate?.anchor_document) continue;
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
  for (const hit of hits) {
    const jobEmbedding = await getJobEmbeddingStatus(db, hit.id);
    if (!jobEmbedding?.anchor_document) continue;
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
