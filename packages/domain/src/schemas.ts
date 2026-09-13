import { z } from 'zod';

export const jobStatusSchema = z.enum([
  'active',
  'expired_grace_period',
  'closed',
  'unknown',
]);
export const workModelSchema = z.enum([
  'remote',
  'hybrid',
  'onsite',
  'unknown',
]);

export const JobOpeningSchema = z.object({
  id: z.string(),
  canonicalKey: z.string().min(1),
  title: z.string(),
  companyName: z.string().nullable(),
  description: z.string().nullable(),
  requirements: z.string().nullable(),
  benefits: z.string().nullable(),
  locationText: z.string().nullable(),
  normalizedLocation: z.string().nullable(),
  countryCode: z.string().nullable(),
  workModel: workModelSchema,
  employmentType: z.string().nullable(),
  seniority: z.string().nullable(),
  contractType: z.string().nullable(),
  contractDuration: z.string().nullable(),
  salaryText: z.string().nullable(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  publishedAt: z.date().nullable(),
  deadlineAt: z.date().nullable(),
  status: jobStatusSchema,
  sourceName: z.string(),
  sourceJobId: z.string().nullable(),
  sourceUrl: z.string().url(),
  applicationUrl: z.string().url().nullable(),
  rawPayload: z.unknown(),
  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  lastVerifiedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const SourceRecordSchema = z.object({
  id: z.string(),
  jobOpeningId: z.string().nullable().optional(),
  sourceName: z.string(),
  sourceJobId: z.string().nullable(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  description: z.string().nullable(),
  url: z.string().url(),
  applicationUrl: z.string().url().nullable().optional(),
  deadline: z.date().nullable().optional(),
  status: jobStatusSchema,
  rawPayload: z.unknown(),
  fetchedAt: z.date(),
  sourcePublishedAt: z.date().nullable().optional(),
});

export const CanonicalKeySchema = z.string().min(1);

export const IngestionRunSchema = z.object({
  id: z.string(),
  startTime: z.date(),
  endTime: z.date().nullable().optional(),
  status: z.enum(['running', 'success', 'failed']),
  sources: z.array(z.string()),
  counts: z.object({
    fetched: z.number(),
    accepted: z.number(),
    rejected: z.number(),
    created: z.number(),
    updated: z.number(),
    deduplicated: z.number(),
    failed: z.number(),
  }),
  error: z.string().optional(),
});
