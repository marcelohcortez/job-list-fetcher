/**
 * One-off maintenance sweep populating `laya_evaluations` for job/candidate
 * pairs that predate Laya (Docs/laya-integration-plan.md, Phase 6) - the
 * ingestion-time hook (`evaluateLayaForNewJob`/`evaluateLayaForNewCandidate`,
 * see ../laya-runner.ts) only ever evaluates a freshly-ingested item against
 * whatever's already in Chroma at that moment, so anything ingested before
 * this feature (or before the other side of a given pair existed) needs this
 * sweep to get covered. Runs from both directions - job-side and
 * candidate-side - since Chroma's nearest-neighbor search isn't symmetric (a
 * job's top-K candidates don't necessarily include every candidate that
 * would rank that job in its own top-K); each (job, candidate) pair is
 * upserted, so evaluating it twice is wasted compute, not wrong.
 *
 * Usage: npm run backfill:laya --workspace @job-fetcher/api
 */
import { loadEnv } from '@job-fetcher/config';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import {
  createOllamaSanitizer,
  createOllamaCvRefactor,
  createVectorStore,
  createLayaClient,
  createOllamaReasoner,
  type SemanticPipeline,
} from '@job-fetcher/semantic-match';
import { evaluateLayaForNewCandidate, evaluateLayaForNewJob } from '../laya-runner';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_MS = 250;

async function main() {
  const env = loadEnv();
  if (!env.LAYA_API_URL) {
    console.error('LAYA_API_URL is not set - nothing to backfill. See .env.example "Laya".');
    process.exit(1);
  }

  const sqlite = openSqlite(env.DATABASE_PATH);
  const db = createKysely(sqlite);
  await runMigrations(db);

  const semantic: SemanticPipeline = {
    sanitizer: createOllamaSanitizer({
      host: env.OLLAMA_HOST,
      chatModel: env.OLLAMA_CHAT_MODEL,
      embedModel: env.OLLAMA_EMBED_MODEL,
      numCtx: env.OLLAMA_NUM_CTX,
      numPredict: env.OLLAMA_NUM_PREDICT,
    }),
    cvRefactor: createOllamaCvRefactor({
      host: env.OLLAMA_HOST,
      chatModel: env.OLLAMA_CHAT_MODEL,
      embedModel: env.OLLAMA_EMBED_MODEL,
      numCtx: env.OLLAMA_NUM_CTX,
      numPredict: env.OLLAMA_NUM_PREDICT,
    }),
    vectorStore: createVectorStore({
      host: env.CHROMA_HOST,
      port: env.CHROMA_PORT,
    }),
  };
  const layaClient = createLayaClient(
    { apiUrl: env.LAYA_API_URL, apiKey: env.LAYA_API_KEY },
    createOllamaReasoner({
      host: env.OLLAMA_HOST,
      chatModel: env.OLLAMA_CHAT_MODEL,
      embedModel: env.OLLAMA_EMBED_MODEL,
      numCtx: env.OLLAMA_NUM_CTX,
      numPredict: env.OLLAMA_NUM_PREDICT,
    }),
  );

  const jobs = await db
    .selectFrom('job_embeddings')
    .select(['job_opening_id', 'anchor_document'])
    .where('status', '=', 'sanitized')
    .execute();
  console.log(`Backfilling Laya for ${jobs.length} sanitized job(s)...`);
  for (const [index, job] of jobs.entries()) {
    if (!job.anchor_document) continue;
    await evaluateLayaForNewJob(
      db,
      semantic,
      layaClient,
      job.job_opening_id,
      job.anchor_document,
      env.LAYA_TOP_K,
    );
    if ((index + 1) % 10 === 0 || index === jobs.length - 1) {
      console.log(`  jobs [${index + 1}/${jobs.length}]`);
    }
    await sleep(DELAY_MS);
  }

  const candidates = await db
    .selectFrom('candidates')
    .select(['id', 'anchor_document'])
    .where('status', '=', 'sanitized')
    .execute();
  console.log(`Backfilling Laya for ${candidates.length} sanitized candidate(s)...`);
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate.anchor_document) continue;
    await evaluateLayaForNewCandidate(
      db,
      semantic,
      layaClient,
      candidate.id,
      candidate.anchor_document,
      env.LAYA_TOP_K,
    );
    if ((index + 1) % 10 === 0 || index === candidates.length - 1) {
      console.log(`  candidates [${index + 1}/${candidates.length}]`);
    }
    await sleep(DELAY_MS);
  }

  console.log('Done.');
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
