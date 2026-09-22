/**
 * One-off maintenance sweep for Cinode Market jobs ingested before the
 * adapter fetched each request's detail page (see cinode-market.ts):
 * their `description` is null because the list/fragment view the adapter
 * used to read never carried body copy or the "Desired skills" tags, only
 * card summaries. This re-pulls each cinode-market job's detail page,
 * fills in its description, and re-runs it through sanitize ->
 * skill-canonicalize so `job_required_skills` reflects the real ad instead
 * of whatever the sanitizer guessed from a title-only prompt.
 *
 * Safe to re-run: `updateJobDescription`, `processJobOpening` and
 * `createSkillCanonicalizer` are all idempotent.
 *
 * Usage: npm run backfill:cinode-descriptions --workspace @job-fetcher/api
 */
import { loadEnv } from '@job-fetcher/config';
import {
  createKysely,
  openSqlite,
  runMigrations,
  updateJobDescription,
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
import { CinodeMarketAdapter, buildCinodeDescription } from '@job-fetcher/source-adapters';
import { createSkillCanonicalizer } from '../skill-taxonomy';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const OLLAMA_DELAY_MS = 250;

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
  const adapter = new CinodeMarketAdapter();

  const jobs = await db
    .selectFrom('job_openings')
    .select(['id', 'source_job_id', 'title', 'company_name', 'description'])
    .where('source_name', '=', 'cinode-market')
    .execute();

  console.log(`Backfilling descriptions for ${jobs.length} Cinode Market jobs...`);

  let ok = 0;
  let failed = 0;
  for (const [index, job] of jobs.entries()) {
    try {
      if (!job.source_job_id) throw new Error('missing source_job_id');
      const detail = await adapter.fetchDetailForId(job.source_job_id);
      const description = buildCinodeDescription(detail);
      await updateJobDescription(db, job.id, description);

      const rawText = buildRawText({ ...job, description });
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
    await sleep(OLLAMA_DELAY_MS);
  }

  console.log(`Done. ok=${ok} failed=${failed}`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
