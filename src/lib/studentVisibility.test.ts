import { describe, expect, it } from 'vitest';
import {
  formatAcademicYear,
  getStudentDateBounds,
  matchesStudentDateFilter,
  getStudentDateFilterLabel,
} from './studentVisibility';

describe('student date filters', () => {
  it('defaults to all time and keeps an older learner visible', () => {
    expect(matchesStudentDateFilter({ created_at: '2026-03-30T12:00:00Z' }, { mode: 'all' })).toBe(true);
    expect(getStudentDateFilterLabel({ mode: 'all' })).toBe('Added: All time');
  });

  it('uses inclusive August 1 through exclusive August 1 academic-year bounds', () => {
    const filter = { mode: 'academic_year' as const, startYear: 2025 };
    expect(formatAcademicYear(2025)).toBe('2025–2026');
    expect(getStudentDateBounds(filter)).toEqual({
      start: '2025-08-01T00:00:00.000Z',
      endExclusive: '2026-08-01T00:00:00.000Z',
    });
    expect(matchesStudentDateFilter({ created_at: '2025-08-01T00:00:00Z' }, filter)).toBe(true);
    expect(matchesStudentDateFilter({ created_at: '2026-07-31T23:59:59.999Z' }, filter)).toBe(true);
    expect(matchesStudentDateFilter({ created_at: '2026-08-01T00:00:00Z' }, filter)).toBe(false);
  });

  it('treats custom end dates as inclusive UTC calendar days', () => {
    const filter = { mode: 'custom' as const, startDate: '2026-03-30', endDate: '2026-03-30' };
    expect(matchesStudentDateFilter({ created_at: '2026-03-30T23:59:59.999Z' }, filter)).toBe(true);
    expect(matchesStudentDateFilter({ created_at: '2026-03-31T00:00:00Z' }, filter)).toBe(false);
    expect(getStudentDateBounds({ mode: 'custom', startDate: '2026-04-01', endDate: '2026-03-31' })).toBeNull();
  });

  it('does not infer enrollment cohort from account creation', () => {
    expect(matchesStudentDateFilter({ created_at: null }, { mode: 'all' })).toBe(true);
  });
});
