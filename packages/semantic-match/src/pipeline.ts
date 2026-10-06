import { buildAnchorDocument } from './anchor';
import type { SanitizerClient } from './ollama';
import type { VectorStore } from './chroma';
import type { CvRefactorClient } from './refactor';
import type { SanitizedCandidate, SanitizedJob } from './schema';

export interface SemanticPipeline {
  sanitizer: SanitizerClient;
  vectorStore: VectorStore;
  cvRefactor: CvRefactorClient;
}

/**
 * Minimum source-text length (chars) below which an empty requiredSkills +
 * softSkills extraction isn't surprising - a short posting/CV can
 * legitimately name nothing. Above it, an empty result is far more likely
 * to be a silent extraction failure than a truly skill-less source, so it's
 * worth a loud log rather than sailing through unnoticed.
 */
const EXTRACTION_COMPLETENESS_MIN_LENGTH = 800;

function warnIfSuspiciouslyEmpty(
  kind: 'job opening' | 'candidate',
  id: string,
  rawText: string,
  sanitized: Pick<SanitizedJob, 'requiredSkills' | 'softSkills'>,
): void {
  if (
    rawText.length >= EXTRACTION_COMPLETENESS_MIN_LENGTH &&
    sanitized.requiredSkills.length === 0 &&
    sanitized.softSkills.length === 0
  ) {
    console.warn(
      `[semantic-match] Suspiciously empty skill extraction for ${kind} ${id}: ` +
        `${rawText.length} chars of source text yielded zero requiredSkills and ` +
        'zero softSkills. Likely a truncated/failed extraction, not a genuinely ' +
        'skill-less source - worth a manual look.',
    );
  }
}

/**
 * Unions a second extraction pass's skills into the main sanitized profile's
 * requiredSkills, deduped case/whitespace-insensitively so a skill the main
 * pass already found (the common case) never appears twice - see
 * SKILLS_EXTRACTION_SYSTEM_PROMPT in ollama.ts for why this second pass
 * exists. Keeps the main pass's own casing/wording for anything it already
 * found; only genuinely new items come from `extra`.
 */
function mergeSkills(primary: readonly string[], extra: readonly string[]): string[] {
  const seen = new Set(primary.map((s) => s.trim().toLowerCase()));
  const merged = [...primary];
  for (const skill of extra) {
    const key = skill.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(skill);
    }
  }
  return merged;
}

export interface ProcessedJob {
  sanitized: SanitizedJob;
  anchorDocument: string;
}

export interface ProcessedCandidate {
  sanitized: SanitizedCandidate;
  anchorDocument: string;
}

export async function processJobOpening(
  pipeline: SemanticPipeline,
  jobOpeningId: string,
  rawText: string,
): Promise<ProcessedJob> {
  // Sequential, not Promise.all: firing both calls concurrently at the same
  // local Ollama instance stalled it indefinitely on real hardware (2026-09-
  // 25) - a single-model local server doesn't handle two concurrent chat
  // completions against the same model safely, it just hangs. Neither call
  // depends on the other's result, so this only costs latency, not
  // correctness.
  const sanitizedJob = await pipeline.sanitizer.sanitizeJob(rawText);
  const extraSkills = await pipeline.sanitizer.extractSkills(rawText);
  const sanitized = {
    ...sanitizedJob,
    requiredSkills: mergeSkills(sanitizedJob.requiredSkills, extraSkills),
  };
  warnIfSuspiciouslyEmpty('job opening', jobOpeningId, rawText, sanitized);
  const anchorDocument = buildAnchorDocument(sanitized);
  const embedding = await pipeline.sanitizer.embed(anchorDocument);
  await pipeline.vectorStore.upsertJob(jobOpeningId, embedding, anchorDocument);
  return { sanitized, anchorDocument };
}

export async function processCandidate(
  pipeline: SemanticPipeline,
  candidateId: string,
  rawText: string,
): Promise<ProcessedCandidate> {
  // The CV is rewritten for ATS-friendly clarity before extraction (see
  // refactor.ts) - but that rewrite must never deduplicate or drop a
  // tool/technology mention (see ADR 0014); deduplication is the job of
  // `createSkillCanonicalizer` downstream, which resolves skills to
  // canonical ids in a `Set` when they're stored. sanitizeCandidate always
  // runs against the rewritten text, not the raw extraction.
  const refactoredText = await pipeline.cvRefactor.refactorCv(rawText);
  // Sequential for the same reason as processJobOpening above.
  const sanitizedCandidate = await pipeline.sanitizer.sanitizeCandidate(refactoredText);
  const extraSkills = await pipeline.sanitizer.extractSkills(refactoredText);
  const sanitized = {
    ...sanitizedCandidate,
    requiredSkills: mergeSkills(sanitizedCandidate.requiredSkills, extraSkills),
  };
  warnIfSuspiciouslyEmpty('candidate', candidateId, rawText, sanitized);
  // The candidate's name is metadata only - never embedded, see anchor.ts.
  const { candidateName: _candidateName, ...profile } = sanitized;
  const anchorDocument = buildAnchorDocument(profile);
  const embedding = await pipeline.sanitizer.embed(anchorDocument);
  await pipeline.vectorStore.upsertCandidate(candidateId, embedding, anchorDocument);
  return { sanitized, anchorDocument };
}

export async function matchJobsForCandidate(
  pipeline: SemanticPipeline,
  candidateId: string,
  topK?: number,
): Promise<Array<{ id: string; similarity: number }>> {
  const embedding = await pipeline.vectorStore.getCandidateEmbedding(candidateId);
  if (!embedding) return [];
  return pipeline.vectorStore.queryJobsForCandidate(embedding, topK);
}

/** Symmetric counterpart of `matchJobsForCandidate`, used to find a freshly-ingested job's shortlist of candidates for Laya evaluation (see Docs/laya-integration-plan.md). */
export async function matchCandidatesForJob(
  pipeline: SemanticPipeline,
  jobOpeningId: string,
  topK?: number,
): Promise<Array<{ id: string; similarity: number }>> {
  const embedding = await pipeline.vectorStore.getJobEmbedding(jobOpeningId);
  if (!embedding) return [];
  return pipeline.vectorStore.queryCandidatesForJob(embedding, topK);
}
