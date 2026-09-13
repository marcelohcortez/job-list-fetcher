import { DateTime } from 'luxon';
import type { JobStatus } from './types';

export const JOB_TIMEZONE = 'Europe/Stockholm';

export interface JobEligibilityResult {
  isEligible: boolean;
  reason?: string;
}

export function isJobEligible(
  deadline: Date | null | undefined,
  status: JobStatus,
  now?: Date,
): JobEligibilityResult {
  const current = DateTime.fromJSDate(now ?? new Date(), {
    zone: JOB_TIMEZONE,
  });
  const jobDeadline =
    deadline === null || deadline === undefined
      ? null
      : DateTime.fromJSDate(deadline, { zone: JOB_TIMEZONE });

  if (status === 'closed') {
    return { isEligible: false, reason: 'Job status is closed' };
  }

  if (!jobDeadline) {
    return status === 'active'
      ? { isEligible: true, reason: 'Active job with no deadline' }
      : {
          isEligible: false,
          reason: 'Job has no deadline but status is not active',
        };
  }

  const cutoff = current.minus({ days: 7 }).startOf('day');

  if (jobDeadline >= cutoff) {
    return {
      isEligible: true,
      reason:
        jobDeadline <= current
          ? 'Deadline within 7-day grace period'
          : 'Deadline in the future or today',
    };
  }

  return { isEligible: false, reason: 'Deadline more than 7 days in the past' };
}
