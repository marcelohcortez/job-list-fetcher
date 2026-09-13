export type {
  CanonicalKey,
  JobOpening,
  SourceRecord,
  IngestionRun,
  JobStatus,
  WorkModel,
} from './types';
export {
  JobOpeningSchema,
  SourceRecordSchema,
  IngestionRunSchema,
  jobStatusSchema,
  workModelSchema,
  CanonicalKeySchema,
} from './schemas';
export {
  normalizeLocation,
  canonicalizeLocation,
  matchLocations,
} from './location-matcher';
export { TARGET_ROLES } from './target-roles';
export {
  matchesTargetTitle,
  matchesTargetLocation,
  isJobInScope,
} from './target-filter';
export { isJobEligible, JOB_TIMEZONE } from './deadline-filter';
export type { JobEligibilityResult } from './deadline-filter';
export {
  calculateCanonicalKey,
  deduplicateSourceRecords,
  normalizeUrl,
  exactKey,
} from './deduplication';
export type { MatchConfidence, MatchResult } from './deduplication';
