import type {
  JobOpening,
  JobStatus,
  SourceRecord,
  WorkModel,
} from '@job-fetcher/domain';
import type { JobOpeningsTable, SourceRecordsTable } from './schema';

export function parseDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

export function parseJson(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function toJobOpening(row: JobOpeningsTable): JobOpening {
  return {
    id: row.id,
    canonicalKey: row.canonical_key,
    title: row.title,
    companyName: row.company_name,
    description: row.description,
    requirements: row.requirements,
    benefits: row.benefits,
    locationText: row.location_text,
    normalizedLocation: row.normalized_location,
    countryCode: row.country_code,
    workModel: (row.work_model as WorkModel | null) ?? 'unknown',
    employmentType: row.employment_type,
    seniority: row.seniority,
    contractType: row.contract_type,
    contractDuration: row.contract_duration,
    salaryText: row.salary_text,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryCurrency: row.salary_currency,
    publishedAt: parseDate(row.published_at),
    deadlineAt: parseDate(row.deadline_at),
    status: row.status as JobStatus,
    sourceName: row.source_name,
    sourceJobId: row.source_job_id,
    sourceUrl: row.source_url,
    applicationUrl: row.application_url,
    rawPayload: parseJson(row.raw_payload),
    firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
    lastVerifiedAt: new Date(row.last_verified_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function toSourceRecord(row: SourceRecordsTable): SourceRecord {
  return {
    id: row.id,
    jobOpeningId: row.job_opening_id,
    sourceName: row.source_name,
    sourceJobId: row.source_job_id,
    title: row.title,
    company: row.company ?? '',
    location: row.location ?? '',
    description: row.description,
    url: row.url,
    applicationUrl: row.application_url,
    deadline: parseDate(row.deadline),
    status: row.status as JobStatus,
    rawPayload: parseJson(row.raw_payload),
    fetchedAt: new Date(row.fetched_at),
    sourcePublishedAt: parseDate(row.source_published_at),
  };
}
