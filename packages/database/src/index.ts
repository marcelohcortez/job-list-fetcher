export type {
  JobDb,
  JobOpeningsTable,
  SourceRecordsTable,
  IngestionRunsTable,
  UserMark,
  UserJobMarksTable,
  CandidateTable,
  JobEmbeddingTable,
  SanitizeStatus,
  TargetRolePhraseTable,
  TargetRolePhraseSource,
  SkillTable,
  JobRequiredSkillTable,
  CandidateSkillTable,
  SkillRelationTable,
  SkillRelationType,
  JobSentCvTable,
} from './schema';
export {
  openSqlite,
  createKysely,
  runMigrations,
  rollbackMigrations,
  createMigratedDb,
} from './db';
export { toJobOpening, toSourceRecord, parseDate, parseJson } from './mappers';
export {
  listJobs,
  getJobById,
  getSourcesForJob,
  countJobs,
  updateJobDescription,
  ingestSourceRecord,
} from './repositories/jobs';
export type { JobFilter, IngestResult } from './repositories/jobs';
export {
  createIngestionRun,
  finishIngestionRun,
  listIngestionRuns,
} from './repositories/ingestion-runs';
export { setUserMark, setJobSeen, getUserMarks } from './repositories/job-marks';
export type { UserJobState } from './repositories/job-marks';
export { setSentCvs, getSentCvIds } from './repositories/sent-cvs';
export {
  insertCandidate,
  markCandidateSanitized,
  markCandidateFailed,
  markCandidateDuplicate,
  resolveCandidateDuplicate,
  getCandidate,
  findSanitizedCandidateByName,
  listCandidates,
  deleteCandidate,
  toCandidateSummary,
} from './repositories/candidates';
export type { CandidateSummary } from './repositories/candidates';
export {
  markJobSanitized,
  markJobEmbeddingFailed,
  getJobEmbeddingStatus,
  getJobRoleCategories,
  getJobSeniorityLevels,
} from './repositories/job-embeddings';
export {
  listTargetRolePhrases,
  insertTargetRolePhraseIfNew,
} from './repositories/target-role-phrases';
export type { NewTargetRolePhrase } from './repositories/target-role-phrases';
export {
  insertSkillIfNew,
  findSkillByNormalizedLabel,
  skillExists,
  replaceJobRequiredSkills,
  replaceCandidateSkills,
  getJobRequiredSkillIds,
  getJobRequiredSkillLabels,
  getCandidateSkillIds,
} from './repositories/skills';
export type { NewSkill, JobRequiredSkillLabel } from './repositories/skills';
export {
  insertSkillRelationIfNew,
  getSkillRelationsFor,
} from './repositories/skill-relations';
export type {
  NewSkillRelation,
  SkillRelationPartner,
} from './repositories/skill-relations';
