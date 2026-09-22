/**
 * One-off maintenance sweep for jobs sanitized before the skill taxonomy
 * (ADR 0009) existed - `runIngestion`'s `embedJob` hook only fires for
 * created/updated records, so a job that re-ingests unchanged never gets a
 * chance to backfill its `job_required_skills` links. This script forces
 * every existing job opening through sanitize -> skill-canonicalize once,
 * regardless of ingestion status. Safe to re-run: `processJobOpening` and
 * `createSkillCanonicalizer` are both idempotent (upsert/onConflict-do-nothing).
 *
 * Usage: npm run backfill:skills --workspace @job-fetcher/api
 */
import { loadEnv } from '@job-fetcher/config';
import {
  createKysely,
  openSqlite,
  runMigrations,
  markJobSanitized,
  markJobEmbeddingFailed,
  replaceJobRequiredSkills,
} from '@job-fetcher/database';
import {
  createOllamaSanitizer,
  createOllamaCvRefactor,
  createVectorStore,
  processJobOpening,
  type SemanticPipeline,
} from '@job-fetcher/semantic-match';
import { categorizeRoleTitle, categorizeSeniority } from '@job-fetcher/domain';
import { createSkillCanonicalizer } from '../skill-taxonomy';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_MS = 250;

function buildRawText(job: { title: string; company_name: string | null; description: string | null }): string {
  return [job.title, job.company_name, job.description]
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}

async function main() {
  const env = loadEnv();

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
  const canonicalizeSkills = createSkillCanonicalizer(
    db,
    semantic.vectorStore,
    semantic.sanitizer.embed,
    env.SKILL_MATCH_MIN_SIMILARITY,
  );

  const jobs = await db
    .selectFrom('job_openings')
    .select(['id', 'title', 'company_name', 'description'])
    .execute();

  console.log(`Backfilling skills for ${jobs.length} job openings...`);

  let ok = 0;
  let failed = 0;
  for (const [index, job] of jobs.entries()) {
    const rawText = buildRawText(job);
    try {
      const { sanitized, anchorDocument } = await processJobOpening(semantic, job.id, rawText);
      await markJobSanitized(db, job.id, {
        sanitizedJson: JSON.stringify(sanitized),
        anchorDocument,
        roleCategory: categorizeRoleTitle(sanitized.title),
        seniorityLevel: categorizeSeniority(sanitized.title, sanitized.experienceProfile),
      });
      const skillIds = await canonicalizeSkills(sanitized.requiredSkills);
      await replaceJobRequiredSkills(db, job.id, skillIds);
      ok += 1;
    } catch (err) {
      failed += 1;
      await markJobEmbeddingFailed(db, job.id, (err as Error).message).catch(() => {});
      console.warn(`[${index + 1}/${jobs.length}] failed ${job.id}: ${(err as Error).message}`);
    }
    if ((index + 1) % 10 === 0 || index === jobs.length - 1) {
      console.log(`[${index + 1}/${jobs.length}] ok=${ok} failed=${failed}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`Done. ok=${ok} failed=${failed}`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
