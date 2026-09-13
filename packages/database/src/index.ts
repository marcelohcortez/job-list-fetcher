export type {
  JobDb,
  JobOpeningsTable,
  SourceRecordsTable,
  IngestionRunsTable,
  UserMark,
  UserJobMarksTable,
  CvProfileTable,
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
  ingestSourceRecord,
} from './repositories/jobs';
export type { JobFilter, IngestResult } from './repositories/jobs';
export {
  createIngestionRun,
  finishIngestionRun,
  listIngestionRuns,
} from './repositories/ingestion-runs';
export { setUserMark, getUserMarks } from './repositories/job-marks';
export {
  getCvProfile,
  upsertCvProfile,
  deleteCvProfile,
  toCvProfileSummary,
} from './repositories/cv-profile';
export type { CvProfileSummary } from './repositories/cv-profile';
