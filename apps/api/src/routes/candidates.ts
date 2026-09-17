import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { JobDb } from '@job-fetcher/database';
import {
  deleteCandidate,
  findSanitizedCandidateByName,
  getCandidate,
  insertCandidate,
  listCandidates,
  markCandidateDuplicate,
  markCandidateFailed,
  markCandidateSanitized,
  replaceCandidateSkills,
  resolveCandidateDuplicate,
  toCandidateSummary,
} from '@job-fetcher/database';
import {
  processCandidate,
  type SemanticPipeline,
} from '@job-fetcher/semantic-match';
import { categorizeRoleTitle } from '@job-fetcher/domain';
import { extractPdfText } from '../cv/pdf';
import type { SkillCanonicalizer } from '../skill-taxonomy';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const BATCH_DELAY_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readPdfFile(
  value: unknown,
): Promise<{ bytes: Uint8Array; name: string; type: string } | null> {
  if (!value || typeof value !== 'object' || !('arrayBuffer' in value)) {
    return null;
  }
  const file = value as File;
  if (file.type !== 'application/pdf') return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES) return null;
  return { bytes, name: file.name, type: file.type };
}

async function sanitizeCandidate(
  db: Kysely<JobDb>,
  pipeline: SemanticPipeline,
  canonicalizeSkills: SkillCanonicalizer,
  candidateId: string,
  extractedText: string,
): Promise<void> {
  try {
    const { sanitized, anchorDocument } = await processCandidate(
      pipeline,
      candidateId,
      extractedText,
    );
    const skillIds = await canonicalizeSkills(sanitized.requiredSkills);
    await replaceCandidateSkills(db, candidateId, skillIds);
    const roleCategory = categorizeRoleTitle(sanitized.title);

    const existing = await findSanitizedCandidateByName(
      db,
      sanitized.candidateName,
      candidateId,
    );
    if (existing) {
      await markCandidateDuplicate(db, candidateId, {
        candidateName: sanitized.candidateName,
        sanitizedJson: JSON.stringify(sanitized),
        anchorDocument,
        roleCategory,
        duplicateOfId: existing.id,
      });
    } else {
      await markCandidateSanitized(db, candidateId, {
        candidateName: sanitized.candidateName,
        sanitizedJson: JSON.stringify(sanitized),
        anchorDocument,
        roleCategory,
      });
    }
  } catch (err) {
    await markCandidateFailed(db, candidateId, (err as Error).message);
  }
}

export function candidatesRoutes(
  db: Kysely<JobDb>,
  pipeline: SemanticPipeline,
  canonicalizeSkills: SkillCanonicalizer,
) {
  const app = new Hono();

  app.get('/', async (c) => {
    const candidates = await listCandidates(db);
    return c.json({ data: candidates.map(toCandidateSummary) });
  });

  app.get('/:id', async (c) => {
    const candidate = await getCandidate(db, c.req.param('id'));
    if (!candidate) return c.json({ error: 'not_found' }, 404);
    return c.json({ data: toCandidateSummary(candidate) });
  });

  app.post('/', async (c) => {
    const body = await c.req.parseBody();
    const file = await readPdfFile(body['file']);
    if (!file) return c.json({ error: 'invalid_file' }, 400);

    let extractedText: string;
    try {
      extractedText = await extractPdfText(file.bytes);
    } catch {
      return c.json({ error: 'unreadable_pdf' }, 400);
    }

    const candidate = await insertCandidate(db, {
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.bytes.length,
      pdfBytes: file.bytes,
      extractedText,
    });
    await sanitizeCandidate(db, pipeline, canonicalizeSkills, candidate.id, extractedText);

    const stored = await getCandidate(db, candidate.id);
    return c.json({ data: toCandidateSummary(stored!) });
  });

  app.post('/batch', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const rawFiles = body['files'];
    const files = Array.isArray(rawFiles) ? rawFiles : [rawFiles];

    const results = [];
    for (const rawFile of files) {
      const file = await readPdfFile(rawFile);
      if (!file) {
        results.push({ fileName: 'unknown', error: 'invalid_file' });
        continue;
      }

      let extractedText: string;
      try {
        extractedText = await extractPdfText(file.bytes);
      } catch {
        results.push({ fileName: file.name, error: 'unreadable_pdf' });
        continue;
      }

      const candidate = await insertCandidate(db, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.bytes.length,
        pdfBytes: file.bytes,
        extractedText,
      });
      await sanitizeCandidate(db, pipeline, canonicalizeSkills, candidate.id, extractedText);
      const stored = await getCandidate(db, candidate.id);
      results.push({ data: toCandidateSummary(stored!) });

      // Avoid overloading local hardware when a folder of CVs is dropped at once.
      await sleep(BATCH_DELAY_MS);
    }

    return c.json({ data: results });
  });

  app.post('/:id/resolve-duplicate', async (c) => {
    const id = c.req.param('id');
    const candidate = await getCandidate(db, id);
    if (!candidate || candidate.status !== 'duplicate' || !candidate.duplicate_of_id) {
      return c.json({ error: 'not_a_duplicate' }, 400);
    }

    const body = await c.req.json().catch(() => null);
    const action = body?.action;
    if (action !== 'ignore' && action !== 'replace') {
      return c.json({ error: 'invalid_action' }, 400);
    }

    if (action === 'ignore') {
      await deleteCandidate(db, id);
      await pipeline.vectorStore.deleteCandidate(id).catch(() => {});
      return c.json({ data: { deleted: id } });
    }

    const existingId = candidate.duplicate_of_id;
    await deleteCandidate(db, existingId);
    await pipeline.vectorStore.deleteCandidate(existingId).catch(() => {});
    await resolveCandidateDuplicate(db, id);
    const stored = await getCandidate(db, id);
    return c.json({ data: toCandidateSummary(stored!) });
  });

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await deleteCandidate(db, id);
    if (deleted) {
      await pipeline.vectorStore.deleteCandidate(id).catch(() => {});
    }
    return c.json({ data: { deleted } });
  });

  return app;
}
