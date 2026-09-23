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
  DEFAULT_LOCATION_SYNONYMS,
  getLocationSynonyms,
  setLocationSynonyms,
} from './location-matcher';
export { normalizeSkillLabel } from './skill-normalizer';
export { DEFAULT_TARGET_ROLES, getTargetRoles, setTargetRoles } from './target-roles';
export {
  matchesTargetTitle,
  matchesTargetLocation,
  isJobInScope,
  DEFAULT_GENERIC_TITLE_SUFFIXES,
  getGenericTitleSuffixes,
  setGenericTitleSuffixes,
  DEFAULT_NON_EMEA_LOCATION_PATTERN,
  getNonEmeaLocationPattern,
  setNonEmeaLocationPattern,
  recompileTargetTitlePatterns,
} from './target-filter';
export { isJobEligible, JOB_TIMEZONE } from './deadline-filter';
export {
  ROLE_CATEGORIES,
  categorizeRoleTitle,
  areRoleCategoriesCompatible,
  DEFAULT_CATEGORY_PATTERN_SOURCES,
  getCategoryPatternSources,
  setCategoryPatterns,
} from './role-categories';
export type { RoleCategory } from './role-categories';
export {
  SENIORITY_LEVELS,
  categorizeSeniority,
  areSeniorityLevelsCompatible,
  DEFAULT_TITLE_LEVEL_PATTERN_SOURCES,
  getTitleLevelPatternSources,
  setTitleLevelPatterns,
} from './seniority';
export type { SeniorityLevel } from './seniority';
export type { JobEligibilityResult } from './deadline-filter';
export {
  calculateCanonicalKey,
  deduplicateSourceRecords,
  normalizeUrl,
  exactKey,
} from './deduplication';
export type { MatchConfidence, MatchResult } from './deduplication';
