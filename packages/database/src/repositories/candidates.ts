import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { CandidateStatus, CandidateTable, JobDb } from '../schema';

export type CandidateSummary = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  wordCount: number;
  candidateName: string | null;
  candidateTitle: string | null;
  status: CandidateStatus;
  error: string | null;
  duplicateOfId: string | null;
  updatedAt: Date;
};

export async function insertCandidate(
  db: Kysely<JobDb>,
  input: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    pdfBytes: Uint8Array;
    extractedText: string;
  },
): Promise<CandidateTable> {
  const now = new Date().toISOString();
  const id = randomUUID();
  await db
    .insertInto('candidates')
    .values({
      id,
      file_name: input.fileName,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
      pdf_bytes: input.pdfBytes,
      extracted_text: input.extractedText,
      candidate_name: null,
      candidate_title: null,
      sanitized_json: null,
      anchor_document: null,
      role_category: null,
      seniority_level: null,
      status: 'pending',
      error: null,
      duplicate_of_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  const row = await getCandidate(db, id);
  if (!row) throw new Error('candidate row missing after insert');
  return row;
}

export async function markCandidateSanitized(
  db: Kysely<JobDb>,
  id: string,
  input: {
    candidateName: string;
    candidateTitle: string;
    sanitizedJson: string;
    anchorDocument: string;
    roleCategory: string | null;
    seniorityLevel: string | null;
  },
): Promise<void> {
  await db
    .updateTable('candidates')
    .set({
      candidate_name: input.candidateName,
      candidate_title: input.candidateTitle,
      sanitized_json: input.sanitizedJson,
      anchor_document: input.anchorDocument,
      role_category: input.roleCategory,
      seniority_level: input.seniorityLevel,
      status: 'sanitized',
      error: null,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .execute();
}

export async function markCandidateFailed(
  db: Kysely<JobDb>,
  id: string,
  error: string,
): Promise<void> {
  await db
    .updateTable('candidates')
    .set({ status: 'failed', error, updated_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute();
}

export async function markCandidateDuplicate(
  db: Kysely<JobDb>,
  id: string,
  input: {
    candidateName: string;
    candidateTitle: string;
    sanitizedJson: string;
    anchorDocument: string;
    roleCategory: string | null;
    seniorityLevel: string | null;
    duplicateOfId: string;
  },
): Promise<void> {
  await db
    .updateTable('candidates')
    .set({
      candidate_name: input.candidateName,
      candidate_title: input.candidateTitle,
      sanitized_json: input.sanitizedJson,
      anchor_document: input.anchorDocument,
      role_category: input.roleCategory,
      seniority_level: input.seniorityLevel,
      duplicate_of_id: input.duplicateOfId,
      status: 'duplicate',
      error: null,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .execute();
}

export async function resolveCandidateDuplicate(
  db: Kysely<JobDb>,
  id: string,
): Promise<void> {
  await db
    .updateTable('candidates')
    .set({
      status: 'sanitized',
      duplicate_of_id: null,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .execute();
}

export async function getCandidate(
  db: Kysely<JobDb>,
  id: string,
): Promise<CandidateTable | undefined> {
  return db
    .selectFrom('candidates')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

/**
 * A second CV only counts as a duplicate of an existing one when both the
 * name AND the sanitized title match - e.g. two CVs for "Fredrik Carlsson"
 * are distinct candidates if one is a "Backend Developer" profile and the
 * other a "Solutions Architect" profile, and should both be kept rather
 * than the second silently overwriting the first via
 * `markCandidateDuplicate`.
 */
export async function findSanitizedCandidateByNameAndTitle(
  db: Kysely<JobDb>,
  candidateName: string,
  candidateTitle: string,
  excludeId: string,
): Promise<CandidateTable | undefined> {
  return db
    .selectFrom('candidates')
    .selectAll()
    .where('status', '=', 'sanitized')
    .where('id', '!=', excludeId)
    .where(sql`lower(candidate_name)`, '=', candidateName.trim().toLowerCase())
    .where(sql`lower(candidate_title)`, '=', candidateTitle.trim().toLowerCase())
    .executeTakeFirst();
}

export async function listCandidates(
  db: Kysely<JobDb>,
): Promise<CandidateTable[]> {
  return db
    .selectFrom('candidates')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();
}

export async function deleteCandidate(
  db: Kysely<JobDb>,
  id: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom('candidates')
    .where('id', '=', id)
    .execute();
  return result.length > 0;
}

export function toCandidateSummary(row: CandidateTable): CandidateSummary {
  const words = row.extracted_text.trim()
    ? row.extracted_text.trim().split(/\s+/).filter(Boolean).length
    : 0;
  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    wordCount: words,
    candidateName: row.candidate_name,
    candidateTitle: row.candidate_title,
    status: row.status,
    error: row.error,
    duplicateOfId: row.duplicate_of_id,
    updatedAt: new Date(row.updated_at),
  };
}
