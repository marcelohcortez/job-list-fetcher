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
  const sanitized = await pipeline.sanitizer.sanitizeJob(rawText);
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
  const sanitized = await pipeline.sanitizer.sanitizeCandidate(refactoredText);
  warnIfSuspiciouslyEmpty('candidate', candidateId, rawText, sanitized);
  // The candidate's name is metadata only - never embedded, see anchor.ts.
  const { candidateName: _candidateName, ...profile } = sanitized;
  const anchorDocument = buildAnchorDocument(profile);
  const embedding = await pipeline.sanitizer.embed(anchorDocument);
  await pipeline.vectorStore.upsertCandidate(
    candidateId,
    embedding,
    anchorDocument,
  );
  return { sanitized, anchorDocument };
}

export async function matchJobsForCandidate(
  pipeline: SemanticPipeline,
  candidateId: string,
  topK?: number,
): Promise<Array<{ id: string; similarity: number }>> {
  const embedding = await pipeline.vectorStore.getCandidateEmbedding(
    candidateId,
  );
  if (!embedding) return [];
  return pipeline.vectorStore.queryJobsForCandidate(embedding, topK);
}
