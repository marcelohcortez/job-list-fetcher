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
  mark: UserMark | null;
  seen_at: string | null;
  updated_at: string;
}

export type SanitizeStatus = 'pending' | 'sanitized' | 'failed';

export type CandidateStatus = SanitizeStatus | 'duplicate';

export interface CandidateTable {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  pdf_bytes: Uint8Array | null;
  extracted_text: string;
  candidate_name: string | null;
  candidate_title: string | null;
  sanitized_json: string | null;
  anchor_document: string | null;
  role_category: string | null;
  seniority_level: string | null;
  status: CandidateStatus;
  error: string | null;
  duplicate_of_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobEmbeddingTable {
  job_opening_id: string;
  status: SanitizeStatus;
  anchor_document: string | null;
  sanitized_json: string | null;
  role_category: string | null;
  seniority_level: string | null;
  error: string | null;
  updated_at: string;
}

export type TargetRolePhraseSource = 'seed' | 'learned';

export interface TargetRolePhraseTable {
  id: string;
  phrase: string;
  normalized_phrase: string;
  source: TargetRolePhraseSource;
  created_at: string;
}

export interface SkillTable {
  id: string;
  canonical_label: string;
  normalized_label: string;
  created_at: string;
}

export interface JobRequiredSkillTable {
  job_opening_id: string;
  skill_id: string;
}

export interface CandidateSkillTable {
  candidate_id: string;
  skill_id: string;
}

export type SkillRelationType = 'equivalent' | 'related';

export interface SkillRelationTable {
  id: string;
  skill_id_a: string;
  skill_id_b: string;
  relation_type: SkillRelationType;
  weight: number;
  created_at: string;
}

export interface JobSentCvTable {
  job_opening_id: string;
  candidate_id: string;
  sent_at: string;
}

export interface JobDb {
  job_openings: JobOpeningsTable;
  source_records: SourceRecordsTable;
  ingestion_runs: IngestionRunsTable;
  user_job_marks: UserJobMarksTable;
  candidates: CandidateTable;
  job_embeddings: JobEmbeddingTable;
  target_role_phrases: TargetRolePhraseTable;
  skills: SkillTable;
  job_required_skills: JobRequiredSkillTable;
  candidate_skills: CandidateSkillTable;
  skill_relations: SkillRelationTable;
  job_sent_cvs: JobSentCvTable;
}
