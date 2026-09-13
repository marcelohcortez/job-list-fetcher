import type { Kysely } from 'kysely';
import type { CvProfileTable, JobDb } from '../schema';

export type CvProfileSummary = {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  textLength: number;
  wordCount: number;
  updatedAt: Date;
};

export async function getCvProfile(
  db: Kysely<JobDb>,
): Promise<CvProfileTable | undefined> {
  return db
    .selectFrom('cv_profile')
    .selectAll()
    .where('id', '=', 'current')
    .executeTakeFirst();
}

export async function upsertCvProfile(
  db: Kysely<JobDb>,
  input: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    pdfBytes: Uint8Array;
    extractedText: string;
  },
): Promise<CvProfileTable> {
  const now = new Date().toISOString();
  await db
    .insertInto('cv_profile')
    .values({
      id: 'current',
      file_name: input.fileName,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
      pdf_bytes: input.pdfBytes,
      extracted_text: input.extractedText,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column('id').doUpdateSet((eb) => ({
        file_name: eb.ref('excluded.file_name'),
        content_type: eb.ref('excluded.content_type'),
        size_bytes: eb.ref('excluded.size_bytes'),
        pdf_bytes: eb.ref('excluded.pdf_bytes'),
        extracted_text: eb.ref('excluded.extracted_text'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();

  const row = await getCvProfile(db);
  if (!row) throw new Error('cv_profile row missing after upsert');
  return row;
}

export async function deleteCvProfile(db: Kysely<JobDb>): Promise<boolean> {
  const result = await db
    .deleteFrom('cv_profile')
    .where('id', '=', 'current')
    .execute();
  return result.length > 0;
}

export function toCvProfileSummary(row: CvProfileTable): CvProfileSummary {
  const words = row.extracted_text.trim().split(/\s+/).filter(Boolean).length;
  return {
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    textLength: row.extracted_text.length,
    wordCount: words,
    updatedAt: new Date(row.updated_at),
  };
}
