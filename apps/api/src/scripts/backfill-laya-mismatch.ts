/**
 * One-off repair sweep for `laya_evaluations` rows whose `mismatch_reasoning`
 * is stuck empty because they were written before the parseReasoningResponse
 * fix in packages/semantic-match/src/laya.ts (the old parser required both
 * the MATCH: and MISMATCH: headers, in order, or it silently dropped the
 * mismatch section). Re-running `backfill:laya` alone only revisits pairs
 * still inside each item's current top-K shortlist; a pair that has since
 * fallen out of the shortlist (new items shifted the nearest-neighbor
 * ranking) never gets re-evaluated there. This script instead re-generates
 * reasoning text directly for every row with empty mismatch_reasoning,
 * regardless of current top-K membership, reusing the row's existing
 * score/choice (no Laya API call needed - only the Ollama reasoning half was
 * broken).
 *
 * Usage: npm run backfill:laya-mismatch --workspace @job-fetcher/api
 */
import { loadEnv } from '@job-fetcher/config';
import {
  createKysely,
  openSqlite,
  runMigrations,
  getCandidate,
  getJobEmbeddingStatus,
  upsertLayaEvaluation,
} from '@job-fetcher/database';
import { createOllamaReasoner } from '@job-fetcher/semantic-match';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_MS = 250;

async function main() {
  const env = loadEnv();

  const sqlite = openSqlite(env.DATABASE_PATH);
  const db = createKysely(sqlite);
  await runMigrations(db);

  const reasoner = createOllamaReasoner({
    host: env.OLLAMA_HOST,
    chatModel: env.OLLAMA_CHAT_MODEL,
    embedModel: env.OLLAMA_EMBED_MODEL,
    numCtx: env.OLLAMA_NUM_CTX,
    numPredict: env.OLLAMA_NUM_PREDICT,
  });

  const rows = await db
    .selectFrom('laya_evaluations')
    .select(['job_opening_id', 'candidate_id', 'score', 'choice', 'truncated'])
    .where((eb) => eb.or([eb('mismatch_reasoning', 'is', null), eb('mismatch_reasoning', '=', '')]))
    .execute();

  console.log(`Found ${rows.length} laya_evaluations row(s) with empty mismatch_reasoning.`);

  let repaired = 0;
  let skipped = 0;
  for (const [index, row] of rows.entries()) {
    const [job, candidate] = await Promise.all([
      getJobEmbeddingStatus(db, row.job_opening_id),
      getCandidate(db, row.candidate_id),
    ]);
    if (!job?.anchor_document || !candidate?.anchor_document) {
      skipped++;
      continue;
    }

    const { reasoning, mismatchReasoning } = await reasoner.generate({
      jobText: job.anchor_document,
      cvText: candidate.anchor_document,
      verdict: row.choice,
      score: row.score,
    });

    await upsertLayaEvaluation(db, {
      jobOpeningId: row.job_opening_id,
      candidateId: row.candidate_id,
      score: row.score,
      choice: row.choice,
      reasoning,
      mismatchReasoning,
      truncated: row.truncated !== 0,
    });
    if (mismatchReasoning) repaired++;
    else skipped++;

    if ((index + 1) % 10 === 0 || index === rows.length - 1) {
      console.log(`  [${index + 1}/${rows.length}] repaired=${repaired} skipped=${skipped}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`Done. Repaired ${repaired}, still empty ${skipped}.`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
