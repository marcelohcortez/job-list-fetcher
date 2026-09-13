export type JobMark = 'applied' | 'not_interested';

export interface JobOpening {
  id: string;
  canonicalKey: string | null;
  title: string;
  companyName: string;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  locationText: string | null;
  normalizedLocation: string | null;
  countryCode: string | null;
  workModel: string | null;
  employmentType: string | null;
  seniority: string | null;
  contractType: string | null;
  contractDuration: string | null;
  salaryText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  publishedAt: string | null;
  deadlineAt: string | null;
  status: string;
  sourceName: string;
  sourceJobId: string | null;
  sourceUrl: string | null;
  applicationUrl: string | null;
  userMark: JobMark | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastVerifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobsResponse {
  data: JobOpening[];
  count: number;
}

export interface IngestionCounts {
  fetched: number;
  accepted: number;
  rejected: number;
  created: number;
  updated: number;
  deduplicated: number;
  failed: number;
}

export interface IngestionRun {
  runId: string;
  status: 'success' | 'failed';
  counts: IngestionCounts;
}

export interface CvSummary {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  textLength: number;
  wordCount: number;
  updatedAt: string;
}

export interface CvMatchDetails {
  score: number;
  titleHits: number;
  bodyMatches: number;
  matchedTerms: string[];
  matchedPhrases: string[];
}

export interface CvMatch extends JobOpening {
  match: CvMatchDetails;
}

export interface CvMatchesResponse {
  data: CvMatch[];
  count: number;
}

export async function fetchJobs(query?: string): Promise<JobsResponse> {
  const params = new URLSearchParams({ limit: '250' });
  if (query) params.set('query', query);
  const res = await fetch(`/jobs?${params}`);
  if (!res.ok) throw new Error(`Failed to load jobs (HTTP ${res.status})`);
  return res.json();
}

export async function triggerIngestion(): Promise<IngestionRun> {
  const res = await fetch('/ingestion/run', { method: 'POST' });
  const body = await res.json();
  if (!res.ok || body.data?.status === 'failed') {
    throw new Error(
      body.data?.counts
        ? `Ingestion run failed`
        : `Failed to trigger ingestion (HTTP ${res.status})`,
    );
  }
  return body.data;
}

export async function setJobMark(
  id: string,
  mark: JobMark | null,
): Promise<JobMark | null> {
  const res = await fetch(`/jobs/${id}/mark`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mark }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error ?? `Failed to update mark (HTTP ${res.status})`,
    );
  }
  return body.data.userMark;
}

export async function fetchCv(): Promise<CvSummary | null> {
  const res = await fetch('/cv');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load CV (HTTP ${res.status})`);
  const body = await res.json();
  return body.data;
}

export async function uploadCv(file: File): Promise<CvSummary> {
  const form = new FormData();
  form.append('cv', file);
  const res = await fetch('/cv', { method: 'POST', body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `Failed to upload CV (HTTP ${res.status})`);
  }
  return body.data;
}

export async function deleteCv(): Promise<void> {
  const res = await fetch('/cv', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to remove CV (HTTP ${res.status})`);
}

export async function fetchCvMatches(): Promise<CvMatchesResponse> {
  const res = await fetch('/cv/matches');
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error ?? `Failed to load matches (HTTP ${res.status})`,
    );
  }
  return body;
}
