import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { JobDb } from '@job-fetcher/database';
import { extractPdfText } from '../cv/pdf';

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export function cvsRoutes(db: Kysely<JobDb>) {
  const app = new Hono();
  
  app.get('/', async (c) => {
    try {
      const profiles = await db.selectFrom('cv_profiles')
        .selectAll()
        .orderBy('updatedAt', 'desc')
        .execute();
      
      return c.json({
        data: profiles.map(profile => ({
          id: profile.id,
          fileName: profile.fileName,
          contentType: profile.contentType,
          sizeBytes: profile.sizeBytes,
          wordCount: profile.wordCount,
          updatedAt: profile.updatedAt.toISOString()
        }))
      });
    } catch (error) {
      return c.json({ error: 'Failed to fetch CVs' }, 500);
    }
  });

  app.post('/', async (c) => {
    try {
      const formData = await c.req.parseBody();
      const file = formData.file as File;
      
      if (!file || !(file instanceof File)) {
        return c.json({ error: 'Invalid file' }, 400);
      }
      
      const bytes = new Uint8Array(await file.arrayBuffer());
      
      let extractedText: string;
      try {
        extractedText = await extractPdfText(bytes);
      } catch (error) {
        return c.json({ error: 'Failed to read PDF text' }, 400);
      }
      
      // Calculate word count
      const wordCount = extractedText.trim() ? extractedText.trim().split(/\s+/).length : 0;
      
      // Store in database
      const result = await db.transaction(async (tx) => {
        const profile = await tx.insertInto('cv_profiles')
          .values({
            fileName: file.name,
            contentType: file.type,
            sizeBytes: bytes.length,
            pdfBytes: bytes,
            extractedText,
            wordCount,
            updatedAt: new Date(),
          })
          .returningAll()
          .executeTake(1);
        
        return profile;
      });
      
      if (!result) {
        return c.json({ error: 'Failed to store CV' }, 500);
      }

      return c.json({
        data: {
          id: result.id,
          fileName: result.fileName,
          contentType: result.contentType,
          sizeBytes: result.sizeBytes,
          wordCount: result.wordCount,
          updatedAt: result.updatedAt.toISOString()
        }
      });
    } catch (error) {
      console.error('Error uploading CV:', error);
      return c.json({ error: 'Failed to upload CV' }, 500);
    }
  });

  app.delete('/:id', async (c) => {
    try {
      const { id } = c.req.param();
      
      await db.deleteFrom('cv_profiles')
        .where('id', '=', id)
        .execute();
        
      return c.json({ data: { deleted: true } });
    } catch (error) {
      console.error('Error deleting CV:', error);
      return c.json({ error: 'Failed to delete CV' }, 500);
    }
  });

  // API for finding matches between jobs and all CVs
  app.get('/matches', async (c) => {
    try {
      // This is a simplified version that would integrate with vector DB in production
      const [jobs, cvs] = await Promise.all([
        db.selectFrom('jobs')
          .selectAll()
          .execute(),
        db.selectFrom('cv_profiles')
          .selectAll()
          .execute()
      ]);
      
      return c.json({
        data: {
          jobs: jobs.map(job => ({
            id: job.id,
            title: job.title,
            description: job.description?.substring(0, 100) || '',
            publishedAt: job.publishedAt?.toISOString() || null
          })),
          cvs: cvs.map(cv => ({
            id: cv.id,
            fileName: cv.fileName,
            wordCount: cv.wordCount,
            updatedAt: cv.updatedAt.toISOString()
          })),
          // Mock match data - in production this would use vector DB
          matches: jobs.slice(0, 3).map(job => ({
            jobId: job.id,
            cvIds: ['cv1', 'cv2'] // mock connections
          }))
        }
      });
    } catch (error) {
      console.error('Error getting matches:', error);
      return c.json({ error: 'Failed to get matches' }, 500);
    }
  });

  return app;
}