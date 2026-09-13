export interface JobOpeningsTable {
  id: string;
  canonical_key: string;
  title: string;
  company_name: string | null;
  description: string | null;
  requirements: string | null;
  benefits: string | null;
  location_text: string | null;
  normalized_location: string | null;
  country_code: string | null;
  work_model: string | null;
  employment_type: string | null;
  seniority: string | null;
  contract_type: string | null;
  contract_duration: string | null;
  salary_text: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  published_at: string | null;
  deadline_at: string | null;
  status: string;
  source_name: string;
  source_job_id: string | null;
  source_url: string;
  application_url: string | null;
  raw_payload: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_verified_at: string;
  created_at: string;
  updated_at: string;
}

export interface SourceRecordsTable {
  id: string;
  job_opening_id: string | null;
  source_name: string;
  source_job_id: string | null;
  title: string;
  company: string | null;
  location: string | null;
  description: string | null;
  url: string;
  application_url: string | null;
  deadline: string | null;
  status: string;
  raw_payload: string | null;
  fetched_at: string;
  source_published_at: string | null;
}

export interface IngestionRunsTable {
  id: string;
  start_time: string;
  end_time: string | null;
  status: string;
  sources: string;
  counts: string | null;
  error: string | null;
}

export type UserMark = 'applied' | 'not_interested';

export interface UserJobMarksTable {
  job_opening_id: string;
  mark: UserMark;
  updated_at: string;
}

export interface CvProfileTable {
  id: 'current';
  file_name: string;
  content_type: string;
  size_bytes: number;
  pdf_bytes: Uint8Array | null;
  extracted_text: string;
  created_at: string;
  updated_at: string;
}

export interface JobDb {
  job_openings: JobOpeningsTable;
  source_records: SourceRecordsTable;
  ingestion_runs: IngestionRunsTable;
  user_job_marks: UserJobMarksTable;
  cv_profile: CvProfileTable;
}
