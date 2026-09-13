import type { Migration } from 'kysely/migration';
import { initialMigration } from './001-initial';
import { userJobMarksMigration } from './002-user-job-marks';
import { cvProfileMigration } from './003-cv-profile';

export const migrations: Record<string, Migration> = {
  '001-initial': initialMigration,
  '002-user-job-marks': userJobMarksMigration,
  '003-cv-profile': cvProfileMigration,
};

export const migrationProvider = {
  getMigrations: () => Promise.resolve(migrations),
};
