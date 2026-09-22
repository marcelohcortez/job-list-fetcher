/**
 * One-off maintenance sweep for candidates sanitized before two prompt
 * fixes (see ADR 0014): (1) `refactor.ts`'s CV-rewrite pass no longer
 * deduplicates or drops a repeated tool/technology mention across job
 * entries - deduplication happens only downstream, when skills are
 * resolved to canonical ids and stored, never in this free-text rewrite -
 * and (2) `ollama.ts`'s sanitizer prompt now treats a base tool and a
 * compound/derived term as distinct (e.g. "Git" no longer gets dropped
 * just because "GitOps" is also present). Candidates uploaded before
 * either fix can be silently missing skills the CV actually lists. This
 * script forces every existing sanitized candidate through
 * refactor -> sanitize -> skill-canonicalize again, using whatever
 * prompts/pipeline are current. Only touches candidates with status
 * 'sanitized' - 'duplicate' rows aren't used for matching (see matches.ts)
 * and 'failed'/'pending' rows have no extracted text worth reprocessing
 * here. Safe to re-run: `processCandidate` and `createSkillCanonicalizer`
 * are both idempotent (upsert/onConflict-do-nothing), and
 * `replaceCandidateSkills` fully replaces the skill set each time rather
 * than merging into stale links.
 *
 * Usage: npm run backfill:cvs --workspace @job-fetcher/api
 */
import { loadEnv } from '@job-fetcher/config';
import {
  createKysely,
  openSqlite,
  runMigrations,
  listCandidates,
  markCandidateSanitized,
  markCandidateFailed,
  replaceCandidateSkills,
} from '@job-fetcher/database';
import {
  createOllamaSanitizer,
  createOllamaCvRefactor,
  createVectorStore,
  processCandidate,
  type SemanticPipeline,
} from '@job-fetcher/semantic-match';
import { categorizeRoleTitle, categorizeSeniority } from '@job-fetcher/domain';
import { createSkillCanonicalizer } from '../skill-taxonomy';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_MS = 250;

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

  const candidates = (await listCandidates(db)).filter((c) => c.status === 'sanitized');

  console.log(`Backfilling ${candidates.length} sanitized candidates...`);

  let ok = 0;
  let failed = 0;
  for (const [index, candidate] of candidates.entries()) {
    try {
      const { sanitized, anchorDocument } = await processCandidate(
        semantic,
        candidate.id,
        candidate.extracted_text,
      );
      const skillIds = await canonicalizeSkills(sanitized.requiredSkills);
      await replaceCandidateSkills(db, candidate.id, skillIds);
      await markCandidateSanitized(db, candidate.id, {
        candidateName: sanitized.candidateName,
        candidateTitle: sanitized.title,
        sanitizedJson: JSON.stringify(sanitized),
        anchorDocument,
        roleCategory: categorizeRoleTitle(sanitized.title),
        seniorityLevel: categorizeSeniority(sanitized.title, sanitized.experienceProfile),
      });
      ok += 1;
    } catch (err) {
      failed += 1;
      await markCandidateFailed(db, candidate.id, (err as Error).message).catch(() => {});
      console.warn(`[${index + 1}/${candidates.length}] failed ${candidate.id}: ${(err as Error).message}`);
    }
    console.log(`[${index + 1}/${candidates.length}] ok=${ok} failed=${failed}`);
    await sleep(DELAY_MS);
  }

  console.log(`Done. ok=${ok} failed=${failed}`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
