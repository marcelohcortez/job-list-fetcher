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
  seenAt: string | null;
  sentCvIds: string[];
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
  warnings: string[];
}

export interface IngestionRunRecord {
  id: string;
  startTime: string;
  endTime: string | null;
  status: 'running' | 'success' | 'failed';
  sources: string[];
  counts: IngestionCounts;
  error?: string;
}

export type CandidateStatus = 'pending' | 'sanitized' | 'failed' | 'duplicate';

export interface Candidate {
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
  updatedAt: string;
}

export interface MatchedJob extends JobOpening {
  similarity: number;
  semanticSimilarity: number;
  skillCoverage: number | null;
  matchedSkillCount: number;
  requiredSkillCount: number;
  matchedSkills: string[];
  missingSkills: string[];
}

export interface CandidateMatches {
  candidateId: string;
  candidateName: string | null;
  fileName: string;
  matches: MatchedJob[];
}

export async function fetchSources(): Promise<string[]> {
  const res = await fetch('/api/sources');
  if (!res.ok) throw new Error(`Failed to load sources (HTTP ${res.status})`);
  const body = await res.json();
  return body.data;
}

export async function fetchJobs(query?: string): Promise<JobsResponse> {
  const params = new URLSearchParams({ limit: '250' });
  if (query) params.set('query', query);
  const res = await fetch(`/api/jobs?${params}`);
  if (!res.ok) throw new Error(`Failed to load jobs (HTTP ${res.status})`);
  return res.json();
}

export async function fetchIngestionRuns(): Promise<IngestionRunRecord[]> {
  const res = await fetch('/api/ingestion/runs');
  if (!res.ok) throw new Error(`Failed to load ingestion runs (HTTP ${res.status})`);
  const body = await res.json();
  return body.data;
}

export async function triggerIngestion(): Promise<IngestionRun> {
  const res = await fetch('/api/ingestion/run', { method: 'POST' });
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
  const res = await fetch(`/api/jobs/${id}/mark`, {
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

export async function setJobSeen(
  id: string,
  seen: boolean,
): Promise<string | null> {
  const res = await fetch(`/api/jobs/${id}/seen`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seen }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error ?? `Failed to update seen status (HTTP ${res.status})`,
    );
  }
  return body.data.seenAt;
}

export async function setJobSentCvs(
  id: string,
  candidateIds: string[],
): Promise<string[]> {
  const res = await fetch(`/api/jobs/${id}/sent-cvs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidateIds }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error ?? `Failed to update sent CVs (HTTP ${res.status})`,
    );
  }
  return body.data.sentCvIds;
}

export async function fetchCandidates(): Promise<Candidate[]> {
  const res = await fetch('/api/candidates');
  if (!res.ok) throw new Error(`Failed to load candidates (HTTP ${res.status})`);
  const body = await res.json();
  return body.data;
}

export async function uploadCandidate(file: File): Promise<Candidate> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/candidates', { method: 'POST', body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `Failed to upload CV (HTTP ${res.status})`);
  }
  return body.data;
}

export async function uploadCandidates(files: File[]): Promise<Candidate[]> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const res = await fetch('/api/candidates/batch', { method: 'POST', body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error ?? `Failed to upload CVs (HTTP ${res.status})`,
    );
  }
  return body.data
    .filter((r: { data?: Candidate }) => r.data)
    .map((r: { data: Candidate }) => r.data);
}

export async function deleteCandidate(id: string): Promise<void> {
  const res = await fetch(`/api/candidates/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to remove candidate (HTTP ${res.status})`);
}

export async function resolveDuplicateCandidate(
  id: string,
  action: 'ignore' | 'replace',
): Promise<Candidate | null> {
  const res = await fetch(`/api/candidates/${id}/resolve-duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error ?? `Failed to resolve duplicate CV (HTTP ${res.status})`,
    );
  }
  return body.data?.deleted ? null : body.data;
}

export type ConfigFieldType =
  | 'string_list'
  | 'regex'
  | 'kv_map'
  | 'ordered_pattern_list'
  | 'relation_list';

export interface SkillRelationSeed {
  a: string;
  b: string;
  type: 'equivalent' | 'related';
  weight: number;
}

export type ConfigFieldValue =
  | string[]
  | string
  | Record<string, string>
  | [string, string][]
  | SkillRelationSeed[];

export interface ConfigField {
  key: string;
  label: string;
  description: string;
  type: ConfigFieldType;
  allowedKeys?: string[];
  value: ConfigFieldValue;
  defaultValue: ConfigFieldValue;
  isDefault: boolean;
}

export async function fetchConfig(): Promise<ConfigField[]> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`Failed to load configuration (HTTP ${res.status})`);
  const body = await res.json();
  return body.data;
}

export async function updateConfig(
  key: string,
  value: ConfigFieldValue,
): Promise<ConfigField> {
  const res = await fetch(`/api/config/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.message ?? body?.error ?? `Failed to save configuration (HTTP ${res.status})`,
    );
  }
  return body.data;
}

export async function resetConfig(key: string): Promise<ConfigField> {
  const res = await fetch(`/api/config/${key}/reset`, { method: 'POST' });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `Failed to reset configuration (HTTP ${res.status})`);
  }
  return body.data;
}

export async function fetchAllMatches(): Promise<CandidateMatches[]> {
  const res = await fetch('/api/matches');
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      body?.error ?? `Failed to load matches (HTTP ${res.status})`,
    );
  }
  return body.data;
}
