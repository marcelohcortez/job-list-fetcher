import { serve } from '@hono/node-server';
import { loadEnv } from '@job-fetcher/config';
import { createKysely, openSqlite, runMigrations } from '@job-fetcher/database';
import {
  GreenhouseAdapter,
  JobTechDevAdapter,
  LeverAdapter,
  TheirStackAdapter,
  CinodeMarketAdapter,
  TeamtailorAdapter,
  KeymanAdapter,
  type SourceAdapter,
} from '@job-fetcher/source-adapters';
import {
  createOllamaSanitizer,
  createOllamaCvRefactor,
  createVectorStore,
  processJobOpening,
  type SemanticPipeline,
} from '@job-fetcher/semantic-match';
import { markJobSanitized, replaceJobRequiredSkills } from '@job-fetcher/database';
import { categorizeRoleTitle, categorizeSeniority } from '@job-fetcher/domain';
import { createApp } from './app';
import type { EmbedJob } from './ingestion-runner';
import { seedTargetRolePhrases, createTitleScopeChecker } from './role-scope';
import { createSkillCanonicalizer } from './skill-taxonomy';
import { seedSkillRelations } from './skill-relations-seed';
import { loadConfigFromDb } from './config-registry';

function parseList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parseQueries(value: string | undefined): string[] | undefined {
  return parseList(value);
}

function main() {
  const env = loadEnv();

  const sqlite = openSqlite(env.DATABASE_PATH);
  const db = createKysely(sqlite);
  const migrationsDone = runMigrations(db);

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

  void migrationsDone
    .then(() =>
      loadConfigFromDb(db, { vectorStore: semantic.vectorStore, embed: semantic.sanitizer.embed }),
    )
    .catch((err) => console.warn(`Startup migration/config load failed: ${(err as Error).message}`));

  seedTargetRolePhrases(db, semantic.vectorStore, semantic.sanitizer.embed).catch(
    (err) => console.warn(`Target role phrase seeding failed: ${(err as Error).message}`),
  );
  seedSkillRelations(db, semantic.vectorStore, semantic.sanitizer.embed).catch(
    (err) => console.warn(`Skill relation seeding failed: ${(err as Error).message}`),
  );
  const isTitleInScope = createTitleScopeChecker(
    db,
    semantic.vectorStore,
    semantic.sanitizer.embed,
    env.ROLE_MATCH_MIN_SIMILARITY,
  );
  const canonicalizeSkills = createSkillCanonicalizer(
    db,
    semantic.vectorStore,
    semantic.sanitizer.embed,
    env.SKILL_MATCH_MIN_SIMILARITY,
  );

  const embedJob: EmbedJob = async (jobOpeningId, rawText) => {
    const { sanitized, anchorDocument } = await processJobOpening(
      semantic,
      jobOpeningId,
      rawText,
    );
    await markJobSanitized(db, jobOpeningId, {
      sanitizedJson: JSON.stringify(sanitized),
      anchorDocument,
      roleCategory: categorizeRoleTitle(sanitized.title),
      seniorityLevel: categorizeSeniority(sanitized.title, sanitized.experienceProfile),
    });
    const skillIds = await canonicalizeSkills(sanitized.requiredSkills);
    await replaceJobRequiredSkills(db, jobOpeningId, skillIds);
  };

  const adapters: SourceAdapter[] = [
    new JobTechDevAdapter({
      queries: parseQueries(env.JOBTECH_QUERIES),
      municipalityCode: env.JOBTECH_MUNICIPALITY_CODE,
    }),
    new GreenhouseAdapter({ boards: parseList(env.GREENHOUSE_BOARDS) }),
    new LeverAdapter({ boards: parseList(env.LEVER_BOARDS) }),
    new TeamtailorAdapter(),
    new KeymanAdapter(),
  ];
  if (env.THEIRSTACK_API_KEY) {
    adapters.push(new TheirStackAdapter(env.THEIRSTACK_API_KEY));
  }
  if (env.CINODE_MARKET_ENABLED) {
    adapters.push(new CinodeMarketAdapter());
  }

  console.log(`Active sources: ${adapters.map((a) => a.name).join(', ')}`);

  const app = createApp(
    db,
    adapters,
    semantic,
    {
      topK: env.MATCH_TOP_K,
      minSimilarity: env.MATCH_MIN_SIMILARITY,
      skillOverlapWeight: env.SKILL_OVERLAP_WEIGHT,
      roleMismatchPenalty: env.ROLE_MISMATCH_PENALTY,
      noRequiredSkillsPenalty: env.NO_REQUIRED_SKILLS_PENALTY,
      seniorityMismatchPenalty: env.SENIORITY_MISMATCH_PENALTY,
      minSkillsForFullConfidence: env.MIN_SKILLS_FOR_FULL_CONFIDENCE,
    },
    embedJob,
    isTitleInScope,
    canonicalizeSkills,
  );

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Job List Fetcher API listening on :${info.port}`);
  });
}

main();
