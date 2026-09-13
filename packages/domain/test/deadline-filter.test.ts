import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { isJobEligible } from '../src/deadline-filter';

const FIXED_NOW = DateTime.fromISO('2026-09-11T10:00:00.000Z', {
  zone: 'Europe/Stockholm',
}).toJSDate();

function deadlineAt(daysFromNow: number): Date {
  return DateTime.fromJSDate(FIXED_NOW, { zone: 'Europe/Stockholm' })
    .plus({ days: daysFromNow })
    .toJSDate();
}

describe('deadline filter (deterministic clock)', () => {
  it('includes future deadlines', () => {
    expect(isJobEligible(deadlineAt(1), 'active', FIXED_NOW).isEligible).toBe(
      true,
    );
  });

  it("includes today's deadline", () => {
    expect(isJobEligible(FIXED_NOW, 'active', FIXED_NOW).isEligible).toBe(true);
  });

  it('includes a deadline exactly 7 days in the past', () => {
    expect(isJobEligible(deadlineAt(-7), 'active', FIXED_NOW).isEligible).toBe(
      true,
    );
  });

  it('excludes a deadline more than 7 days in the past', () => {
    expect(isJobEligible(deadlineAt(-8), 'active', FIXED_NOW).isEligible).toBe(
      false,
    );
  });

  it('excludes closed jobs regardless of deadline', () => {
    expect(isJobEligible(deadlineAt(1), 'closed', FIXED_NOW).isEligible).toBe(
      false,
    );
  });

  it('includes active jobs with no deadline', () => {
    expect(isJobEligible(null, 'active', FIXED_NOW).isEligible).toBe(true);
  });

  it('respects Europe/Stockholm timezone at UTC offset boundaries', () => {
    const now = new Date('2026-09-11T20:00:00.000Z'); // 22:00 Stockholm (CEST)
    // 2026-09-03T23:30Z = 01:30 Stockholm Sep 4 → still within 7-day grace
    expect(
      isJobEligible(new Date('2026-09-03T23:30:00.000Z'), 'active', now)
        .isEligible,
    ).toBe(true);
    // 2026-09-03T21:00Z = 23:00 Stockholm Sep 3 → already 8 calendar days back
    expect(
      isJobEligible(new Date('2026-09-03T21:00:00.000Z'), 'active', now)
        .isEligible,
    ).toBe(false);
  });
});
