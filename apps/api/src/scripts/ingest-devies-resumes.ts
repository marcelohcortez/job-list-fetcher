/**
 * One-off ingestion: loads real Devies employee resumes (pulled via the
 * Devies MCP server, one person at a time, and saved as plain-text files by
 * an interactive session - there is no scriptable service-account path yet,
 * see Docs/devies-tools-integration-plan.md) into job-list-fetcher through
 * the exact same pipeline the manual-upload flow uses (insertCandidate ->
 * processCandidate -> canonicalizeSkills -> replaceCandidateSkills ->
 * markCandidateSanitized). No PDF exists for these, so pdfBytes is empty
 * and contentType is 'text/plain'; extractedText is the resume text itself.
 *
 * Input: a manifest.json (array of {file, name, userId, resumeId}) plus one
 * .txt per entry, in the directory given as argv[2].
 *
 * Usage: npm run ingest:devies-resumes --workspace @job-fetcher/api -- <dir>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '@job-fetcher/config';
import {
  createKysely,
  openSqlite,
  runMigrations,
  insertCandidate,
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

interface ManifestEntry {
  file: string;
  name: string;
  userId: string;
  resumeId: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DELAY_MS = 250;

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: ingest-devies-resumes.ts <directory containing manifest.json + .txt files>');
    process.exit(1);
  }

  const manifest: ManifestEntry[] = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'));
  console.log(`Loaded manifest: ${manifest.length} resumes from ${dir}`);

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

  let ok = 0;
  let failed = 0;
  for (const [index, entry] of manifest.entries()) {
    const rawText = readFileSync(join(dir, entry.file), 'utf-8');
    let candidateId: string | undefined;
    try {
      const inserted = await insertCandidate(db, {
        fileName: `${entry.name} (Devies resume ${entry.resumeId}).txt`,
        contentType: 'text/plain',
        sizeBytes: Buffer.byteLength(rawText, 'utf-8'),
        pdfBytes: new Uint8Array(0),
        extractedText: rawText,
      });
      candidateId = inserted.id;

      const { sanitized, anchorDocument } = await processCandidate(semantic, inserted.id, rawText);
      const skillIds = await canonicalizeSkills(sanitized.requiredSkills);
      await replaceCandidateSkills(db, inserted.id, skillIds);
      await markCandidateSanitized(db, inserted.id, {
        candidateName: sanitized.candidateName || entry.name,
        candidateTitle: sanitized.title,
        sanitizedJson: JSON.stringify(sanitized),
        anchorDocument,
        roleCategory: categorizeRoleTitle(sanitized.title),
        seniorityLevel: categorizeSeniority(sanitized.title, sanitized.experienceProfile),
      });
      ok += 1;
      console.log(`[${index + 1}/${manifest.length}] ok: ${entry.name} -> candidate ${inserted.id}`);
    } catch (err) {
      failed += 1;
      const message = (err as Error).message;
      if (candidateId) {
        await markCandidateFailed(db, candidateId, message).catch(() => {});
      }
      console.warn(`[${index + 1}/${manifest.length}] FAILED: ${entry.name}: ${message}`);
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
