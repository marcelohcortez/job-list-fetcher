import type { Migration } from 'kysely/migration';
import { initialMigration } from './001-initial';
import { userJobMarksMigration } from './002-user-job-marks';
import { cvProfileMigration } from './003-cv-profile';
import { semanticMatchingMigration } from './004-semantic-matching';
import { targetRolePhrasesMigration } from './005-target-role-phrases';
import { candidateDuplicatesMigration } from './006-candidate-duplicates';
import { skillTaxonomyMigration } from './007-skill-taxonomy';
import { skillRelationsMigration } from './008-skill-relations';
import { roleCategoriesMigration } from './009-role-categories';
import { seenJobsMigration } from './010-seen-jobs';
import { jobSentCvsMigration } from './011-job-sent-cvs';
import { seniorityLevelMigration } from './012-seniority-level';
import { candidateTitleMigration } from './013-candidate-title';
import { appConfigMigration } from './014-app-config';

export const migrations: Record<string, Migration> = {
  '001-initial': initialMigration,
  '002-user-job-marks': userJobMarksMigration,
  '003-cv-profile': cvProfileMigration,
  '004-semantic-matching': semanticMatchingMigration,
  '005-target-role-phrases': targetRolePhrasesMigration,
  '006-candidate-duplicates': candidateDuplicatesMigration,
  '007-skill-taxonomy': skillTaxonomyMigration,
  '008-skill-relations': skillRelationsMigration,
  '009-role-categories': roleCategoriesMigration,
  '010-seen-jobs': seenJobsMigration,
  '011-job-sent-cvs': jobSentCvsMigration,
  '012-seniority-level': seniorityLevelMigration,
  '013-candidate-title': candidateTitleMigration,
  '014-app-config': appConfigMigration,
};

export const migrationProvider = {
  getMigrations: () => Promise.resolve(migrations),
};
