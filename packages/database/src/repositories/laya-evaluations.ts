import type { Kysely } from 'kysely';
import type { JobDb, LayaVerdict } from '../schema';

export interface LayaEvaluationView {
  score: number;
  choice: LayaVerdict;
  reasoning: string;
  mismatchReasoning: string | null;
}

export async function upsertLayaEvaluation(
  db: Kysely<JobDb>,
  input: {
    jobOpeningId: string;
    candidateId: string;
    score: number;
    choice: LayaVerdict;
    reasoning: string;
    mismatchReasoning?: string | null;
    modelVersion?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insertInto('laya_evaluations')
    .values({
      job_opening_id: input.jobOpeningId,
      candidate_id: input.candidateId,
      score: input.score,
      choice: input.choice,
      reasoning: input.reasoning,
      mismatch_reasoning: input.mismatchReasoning ?? null,
      model_version: input.modelVersion ?? null,
      evaluated_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['job_opening_id', 'candidate_id']).doUpdateSet((eb) => ({
        score: eb.ref('excluded.score'),
        choice: eb.ref('excluded.choice'),
        reasoning: eb.ref('excluded.reasoning'),
        mismatch_reasoning: eb.ref('excluded.mismatch_reasoning'),
        model_version: eb.ref('excluded.model_version'),
        evaluated_at: eb.ref('excluded.evaluated_at'),
      })),
    )
    .execute();
}

/** Every Laya evaluation for one candidate against a bounded set of jobs, keyed by job id - used by `blendScore` (see matches.ts). */
export async function getLayaEvaluationsForCandidate(
  db: Kysely<JobDb>,
  candidateId: string,
  jobOpeningIds: readonly string[],
): Promise<Map<string, LayaEvaluationView>> {
  if (jobOpeningIds.length === 0) return new Map();
  const rows = await db
    .selectFrom('laya_evaluations')
    .select(['job_opening_id', 'score', 'choice', 'reasoning', 'mismatch_reasoning'])
    .where('candidate_id', '=', candidateId)
    .where('job_opening_id', 'in', jobOpeningIds)
    .execute();
  return new Map(
    rows.map((row) => [
      row.job_opening_id,
      {
        score: row.score,
        choice: row.choice,
        reasoning: row.reasoning,
        mismatchReasoning: row.mismatch_reasoning,
      },
    ]),
  );
}
