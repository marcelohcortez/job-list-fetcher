export type JobStatus =
  'active' | 'expired_grace_period' | 'closed' | 'unknown';
export type WorkModel = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export type CanonicalKey = string;

export interface JobOpening {
  id: string;
  canonicalKey: CanonicalKey;
  title: string;
  companyName: string | null;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  locationText: string | null;
  normalizedLocation: string | null;
  countryCode: string | null;
  workModel: WorkModel;
  employmentType: string | null;
  seniority: string | null;
  contractType: string | null;
  contractDuration: string | null;
  salaryText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  publishedAt: Date | null;
  deadlineAt: Date | null;
  status: JobStatus;
  sourceName: string;
  sourceJobId: string | null;
  sourceUrl: string;
  applicationUrl: string | null;
  rawPayload: unknown;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastVerifiedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceRecord {
  id: string;
  jobOpeningId?: string | null;
  sourceName: string;
  sourceJobId: string | null;
  title: string;
  company: string;
  location: string;
  description: string | null;
  url: string;
  applicationUrl?: string | null;
  deadline?: Date | null;
  status: JobStatus;
  rawPayload: unknown;
  fetchedAt: Date;
  sourcePublishedAt?: Date | null;
}

export interface IngestionRun {
  id: string;
  startTime: Date;
  endTime?: Date | null;
  status: 'running' | 'success' | 'failed';
  sources: string[];
  counts: {
    fetched: number;
    accepted: number;
    rejected: number;
    created: number;
    updated: number;
    deduplicated: number;
    failed: number;
  };
  error?: string;
}
